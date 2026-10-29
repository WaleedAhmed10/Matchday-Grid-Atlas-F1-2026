const User = require('../models/User');
const Leaderboard = require('../models/Leaderboard');
const {
  asyncHandler,
  ConflictError,
  ValidationError,
  AuthenticationError
} = require('../middleware/errorHandler');
const { sendSuccess } = require('../utils/response');
const { hashPassword, verifyPassword } = require('../utils/password');
const { createSessionToken, safeEqual, MAX_SESSIONS, SESSION_TTL_MS } = require('../utils/session');

const MIN_PASSWORD = 6;
const MAX_PASSWORD = 128; // scrypt cost grows with input size, so cap it
const MAX_DISPLAY_NAME = 30;
// Used to spend the same time on unknown usernames as on real ones (no username probing by timing)
const DUMMY_HASH = 'scrypt$00000000000000000000000000000000$' + '00'.repeat(64);

// Usernames are matched case-insensitively ("Max" and "max" are the same person).
const findByUsername = (username) =>
  User.findOne({ username }).collation({ locale: 'en', strength: 2 });

function cleanCredentials(body = {}) {
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  return { username, password };
}

function validatePassword(password) {
  if (password.length < MIN_PASSWORD) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD} characters`);
  }
  if (password.length > MAX_PASSWORD) {
    throw new ValidationError(`Password must be at most ${MAX_PASSWORD} characters`);
  }
}

const publicUser = (user) => ({ username: user.username, displayName: user.displayName });

/**
 * Start a session for a NEW (unsaved) user document; returns the (unhashed) token.
 */
function startSession(user) {
  const { token, hash } = createSessionToken();
  user.sessions = [{ hash, createdAt: new Date() }];
  return token;
}

/**
 * Add a session to an existing user with one atomic update, so two sign-ins at the same
 * moment (two devices) cannot overwrite each other or fail with a version conflict.
 * Expired sessions are dropped first, then only the newest MAX_SESSIONS are kept.
 */
async function addSession(user) {
  const { token, hash } = createSessionToken();
  const cutoff = new Date(Date.now() - SESSION_TTL_MS);
  await User.updateOne({ _id: user._id }, { $pull: { sessions: { createdAt: { $lt: cutoff } } } });
  await User.updateOne(
    { _id: user._id },
    { $push: { sessions: { $each: [{ hash, createdAt: new Date() }], $slice: -MAX_SESSIONS } } }
  );
  return token;
}

/**
 * User signup - username + password
 */
exports.signup = asyncHandler(async (req, res) => {
  const { username, password } = cleanCredentials(req.body);
  const rawDisplay = typeof req.body.displayName === 'string' ? req.body.displayName.trim() : '';
  const displayName = (rawDisplay || username).slice(0, MAX_DISPLAY_NAME);

  if (username.length < 3) {
    throw new ValidationError('Username must be at least 3 characters');
  }
  if (username.length > 30) {
    throw new ValidationError('Username must be at most 30 characters');
  }
  validatePassword(password);

  if (await findByUsername(username)) {
    throw new ConflictError('Username already taken');
  }

  const user = new User({
    username,
    displayName,
    passwordHash: await hashPassword(password)
  });
  const token = startSession(user);
  await user.save();

  try {
    await Leaderboard.create({ user: user.username, points: 0, correctWinners: 0, displayName });
  } catch (err) {
    // Don't leave a half-created account behind that can't be signed up again
    await User.deleteOne({ _id: user._id });
    throw err;
  }

  sendSuccess(res, { token, user: publicUser(user) }, 'Account created', 201);
});

/**
 * User signin - username + password
 */
exports.signin = asyncHandler(async (req, res) => {
  const { username, password } = cleanCredentials(req.body);

  if (!username || !password) {
    throw new ValidationError('Username and password are required');
  }

  const user = await findByUsername(username);
  if (!user) {
    await verifyPassword(password, DUMMY_HASH);
    throw new AuthenticationError('Invalid username or password');
  }

  let message = 'Logged in';

  if (!user.passwordHash) {
    // Account created before passwords existed. Only its owner may set the first password:
    // the browser it was created in still holds the old token. (The site owner can allow
    // anyone to claim old accounts with ALLOW_LEGACY_CLAIM=true.)
    const ownsAccount = typeof req.body.legacyToken === 'string' && user.token && safeEqual(req.body.legacyToken, user.token);
    if (!ownsAccount && process.env.ALLOW_LEGACY_CLAIM !== 'true') {
      throw new AuthenticationError(
        'This older account has no password yet. Sign in from the browser you created it on, or ask the site owner to reset it.'
      );
    }
    validatePassword(password);
    user.passwordHash = await hashPassword(password);
    user.token = undefined; // retire the old plain-text token
    message = 'Password set for your account';
  } else if (!(await verifyPassword(password, user.passwordHash))) {
    throw new AuthenticationError('Invalid username or password');
  }

  if (user.isModified()) await user.save();
  const token = await addSession(user);

  sendSuccess(res, { token, user: publicUser(user) }, message);
});

/**
 * Get current user information
 */
exports.me = asyncHandler((req, res) => {
  if (!req.user) {
    throw new AuthenticationError();
  }

  sendSuccess(res, { user: { username: req.user.username, displayName: req.user.displayName } }, 'User information retrieved');
});

/**
 * Sign out this device (invalidates its token on the server)
 */
exports.signout = asyncHandler(async (req, res) => {
  const user = await User.findOne({ username: req.user.username }).collation({ locale: 'en', strength: 2 });
  if (user) {
    user.sessions = (user.sessions || []).filter((s) => s.hash !== req.user.sessionHash);
    await user.save();
  }
  sendSuccess(res, {}, 'Signed out');
});
