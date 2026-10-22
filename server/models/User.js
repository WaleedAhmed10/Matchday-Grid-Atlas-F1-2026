const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true },
  displayName: { type: String, required: true },
  // Absent on accounts created before passwords existed; see authController.signin
  passwordHash: { type: String },
  // One entry per signed-in device. Only the SHA-256 of the token is stored.
  sessions: [{
    _id: false,
    hash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  // Legacy plain-text token of pre-password accounts. Removed once the account sets a password.
  token: { type: String },
  joined: { type: Date, default: Date.now }
});

userSchema.index({ 'sessions.hash': 1 });
// "Max" and "max" are the same username (matches the case-insensitive lookups in authController)
userSchema.index({ username: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

module.exports = mongoose.model('User', userSchema);
