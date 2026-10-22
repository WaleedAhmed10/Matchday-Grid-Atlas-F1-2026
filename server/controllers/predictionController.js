const Prediction = require('../models/Prediction');
const Race = require('../models/Race');
const Driver = require('../models/Driver');
const { isRaceOpenForPredictions } = require('../algorithms/raceValidation');
const { getRaceResultsMap } = require('../services/leaderboardService');
const { scorePrediction } = require('../algorithms/predictionScoring');
const { recalculateLeaderboard } = require('../services/leaderboardService');

exports.getMine = async (req, res) => {
  try {
    const predictions = await Prediction.find({ userName: req.user.username }, { _id: 0, __v: 0 });
    const raceResultsMap = await getRaceResultsMap();
    const drivers = await Driver.find({});

    const enriched = predictions.map((p) => {
      const result = raceResultsMap.get(p.raceId);
      const scored = scorePrediction(p, result);
      const driver = drivers.find((d) => d.id === p.driverId);
      return {
        ...p.toObject(),
        driverName: driver?.name,
        driverCode: driver?.code,
        scored: scored.total,
        actualPosition: scored.actualPosition
      };
    });
    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createOrUpdate = async (req, res) => {
  try {
    const { raceId, driverId } = req.body;
    const userName = req.user.username;

    if (!Number.isInteger(raceId) || typeof driverId !== 'string') {
      return res.status(400).json({ error: 'raceId must be a number and driverId a string' });
    }

    const race = await Race.findOne({ id: raceId });
    if (!race) return res.status(404).json({ error: 'Race not found' });
    if (!isRaceOpenForPredictions(race)) {
      return res.status(403).json({ error: 'Predictions closed — race has started' });
    }

    const driver = await Driver.findOne({ id: driverId });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    let prediction = await Prediction.findOne({ userName, raceId });
    const isUpdate = !!prediction;

    if (prediction) {
      prediction.driverId = driverId;
      prediction.updatedAt = new Date();
      await prediction.save();
    } else {
      prediction = await Prediction.create({ userName, raceId, driverId });
    }

    await recalculateLeaderboard();

    res.json({ success: true, prediction, updated: isUpdate });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteAll = async (req, res) => {
  try {
    const result = await Prediction.deleteMany({ userName: req.user.username });
    await recalculateLeaderboard();
    res.json({ success: true, count: result.deletedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getByRace = async (req, res) => {
  try {
    const raceId = parseInt(req.params.raceId, 10);
    const predictions = await Prediction.find({ raceId }, { _id: 0, __v: 0 });
    res.json(predictions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
