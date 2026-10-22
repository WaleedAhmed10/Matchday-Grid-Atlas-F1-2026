const User = require('../models/User');
const { hashToken, isExpired } = require('../utils/session');

const adminNames = () => (process.env.ADMIN_USERNAMES || '')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);

const isAdmin = (username) => !!username && adminNames().includes(String(username).toLowerCase());

const authenticate = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '').trim();
  if (!token) {
    return res.status(401).json({ error: 'Token required' });
  }
  try {
    const hash = hashToken(token);
    let user = await User.findOne({ 'sessions.hash': hash });

    if (user) {
      const session = user.sessions.find((s) => s.hash === hash);
      if (!session || isExpired(session)) {
        return res.status(401).json({ error: 'Session expired' });
      }
    } else {
      // Pre-password accounts keep working with their old token until they set a password
      user = await User.findOne({ token });
      if (user && user.passwordHash) user = null;
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.user = { id: user._id, username: user.username, displayName: user.displayName, sessionHash: hash };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

/**
 * Admin-only guard (use after `authenticate`).
 * Admins are listed in the ADMIN_USERNAMES env var (comma separated).
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || !isAdmin(req.user.username)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

module.exports = authenticate;
module.exports.requireAdmin = requireAdmin;
module.exports.isAdmin = isAdmin;
