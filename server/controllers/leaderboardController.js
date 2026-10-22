const Leaderboard = require('../models/Leaderboard');
const { rankLeaderboard } = require('../algorithms/predictionScoring');

// Points are recalculated when something changes (prediction saved/reset, result synced),
// so reading the leaderboard is a plain query.
exports.getTop = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const entries = await Leaderboard.find({});
    const ranked = rankLeaderboard(entries.map((e) => ({
      user: e.user,
      points: e.points,
      correctWinners: e.correctWinners,
      displayName: e.displayName
    })));
    res.json(ranked.slice(0, limit));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
