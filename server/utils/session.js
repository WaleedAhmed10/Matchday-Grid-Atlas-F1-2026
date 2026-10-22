const crypto = require('crypto');

const SESSION_TTL_MS = (Number(process.env.SESSION_DAYS) || 30) * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 10; // devices signed in at once

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** New random session token; only its SHA-256 hash is stored in the database. */
function createSessionToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashToken(token) };
}

const isExpired = (session) => Date.now() - new Date(session.createdAt).getTime() > SESSION_TTL_MS;

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

module.exports = { hashToken, createSessionToken, isExpired, safeEqual, MAX_SESSIONS, SESSION_TTL_MS };
