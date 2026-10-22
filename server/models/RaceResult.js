const mongoose = require('mongoose');

const raceResultSchema = new mongoose.Schema({
  raceId: { type: Number, required: true, unique: true },
  finishingOrder: [{ type: String, required: true }],
  // Sprint classification (driver ids), only on sprint weekends
  sprintOrder: [{ type: String }],
  // 'jolpica' = synced automatically, 'manual' = entered by an admin
  source: { type: String, default: 'manual' },
  recordedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RaceResult', raceResultSchema);
