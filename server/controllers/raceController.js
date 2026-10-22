const Race = require('../models/Race');
const RaceResult = require('../models/RaceResult');
const { getRaceStatus } = require('../algorithms/raceValidation');

exports.getAll = async (req, res) => {
  try {
    const races = (await Race.find({}, { _id: 0, __v: 0 }).sort({ id: 1 }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id - b.id);
    const results = await RaceResult.find({}, { raceId: 1 });
    const resultIds = new Set(results.map((r) => r.raceId));

    const enriched = races.map((race) => ({
      ...race.toObject(),
      status: getRaceStatus(race, resultIds.has(race.id))
    }));
    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
