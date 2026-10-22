const Driver = require('../models/Driver');
const RaceResult = require('../models/RaceResult');
const { sortDrivers } = require('../seed/data');
const { calculateDriverStandings } = require('../algorithms/f1Points');

exports.getAll = async (req, res) => {
  try {
    const drivers = await Driver.find({}, { _id: 0, __v: 0 });
    const results = await RaceResult.find({}).sort({ raceId: 1 });

    // Until the first result is recorded keep the dataset snapshot (datasets/drivers.csv);
    // afterwards seasonPoints / seasonPosition follow the real results.
    let live = drivers.map((d) => d.toObject());
    if (results.length) {
      const standings = calculateDriverStandings(drivers, results);
      const byId = new Map(standings.map((s, index) => [s.driverId, { points: s.points, position: index + 1 }]));
      live = live.map((d) => {
        const s = byId.get(d.id);
        return s ? { ...d, seasonPoints: s.points, seasonPosition: s.position } : d;
      });
    }
    res.json(sortDrivers(live));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
