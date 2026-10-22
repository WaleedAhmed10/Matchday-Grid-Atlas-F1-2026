const Prediction = require('../models/Prediction');
const Leaderboard = require('../models/Leaderboard');
const RaceResult = require('../models/RaceResult');
const { calculateUserTotalPoints, rankLeaderboard } = require('../algorithms/predictionScoring');

async function getRaceResultsMap() {
  const results = await RaceResult.find({});
  return new Map(results.map((r) => [r.raceId, r]));
}

async function recalculateLeaderboard() {
  const raceResultsMap = await getRaceResultsMap();
  const allPredictions = await Prediction.find({});
  const leaderboardEntries = await Leaderboard.find({});

  const byUser = new Map();
  allPredictions.forEach((p) => {
    if (!byUser.has(p.userName)) byUser.set(p.userName, []);
    byUser.get(p.userName).push(p);
  });

  for (const entry of leaderboardEntries) {
    const userPreds = byUser.get(entry.user) || [];
    const { total, correctWinners } = calculateUserTotalPoints(userPreds, raceResultsMap);
    if (entry.points !== total || entry.correctWinners !== correctWinners) {
      entry.points = total;
      entry.correctWinners = correctWinners;
      await entry.save();
    }
  }

  return rankLeaderboard(
    leaderboardEntries.map((e) => ({
      user: e.user,
      points: e.points,
      correctWinners: e.correctWinners,
      displayName: e.displayName
    }))
  );
}

module.exports = { recalculateLeaderboard, getRaceResultsMap };
