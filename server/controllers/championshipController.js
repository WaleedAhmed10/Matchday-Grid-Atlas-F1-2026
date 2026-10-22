const Driver = require('../models/Driver');
const Race = require('../models/Race');
const RaceResult = require('../models/RaceResult');
const Prediction = require('../models/Prediction');
const Leaderboard = require('../models/Leaderboard');
const User = require('../models/User');
const {
  calculateDriverStandings,
  calculateConstructorStandings
} = require('../algorithms/f1Points');
const { simulateChampionship } = require('../algorithms/monteCarlo');
const { recalculateLeaderboard } = require('../services/leaderboardService');
const { asyncHandler, NotFoundError, ValidationError } = require('../middleware/errorHandler');
const { maybeSync, getSyncStatus } = require('../services/resultsSync');
const { isAdmin } = require('../middleware/auth');
const { sendSuccess, sendPaginated } = require('../utils/response');
const { cache, cacheKeys, invalidationPatterns } = require('../utils/cache');
const { logger } = require('../utils/logger');
const {
  calculateDriverStats,
  calculateTeamStats,
  compareDrivers,
  findDriverStreaks,
  generateDriverInsights
} = require('../algorithms/analytics');
const { predictRaceOutcome } = require('../algorithms/advancedPredictor');

/**
 * Get driver championship standings with caching
 */
exports.getDriverStandings = asyncHandler(async (req, res) => {
  // Check cache first
  const cachedData = cache.get(cacheKeys.driverStandings());
  if (cachedData) {
    logger.debug('Driver standings from cache');
    return sendSuccess(res, cachedData, 'Driver standings retrieved');
  }

  const drivers = await Driver.find({});
  const raceResults = await RaceResult.find({}).sort({ raceId: 1 });
  const standings = calculateDriverStandings(drivers, raceResults);

  // Cache for 5 minutes
  cache.set(cacheKeys.driverStandings(), standings, 300000);
  logger.debug('Driver standings cached');

  sendSuccess(res, standings, 'Driver standings retrieved');
});

/**
 * Get constructor championship standings with caching
 */
exports.getConstructorStandings = asyncHandler(async (req, res) => {
  const cachedData = cache.get(cacheKeys.constructorStandings());
  if (cachedData) {
    logger.debug('Constructor standings from cache');
    return sendSuccess(res, cachedData, 'Constructor standings retrieved');
  }

  const drivers = await Driver.find({});
  const raceResults = await RaceResult.find({}).sort({ raceId: 1 });
  const standings = calculateConstructorStandings(drivers, raceResults);

  cache.set(cacheKeys.constructorStandings(), standings, 300000);
  logger.debug('Constructor standings cached');

  sendSuccess(res, standings, 'Constructor standings retrieved');
});

/**
 * Get championship simulation with advanced analytics
 */
exports.getChampionshipSimulation = asyncHandler(async (req, res) => {
  const cachedData = cache.get(cacheKeys.simulation());
  if (cachedData) {
    logger.debug('Championship simulation from cache');
    return sendSuccess(res, cachedData);
  }

  const drivers = await Driver.find({});
  const raceResults = await RaceResult.find({});
  const allRaces = await Race.find({}).sort({ id: 1 });
  const completedIds = new Set(raceResults.map((r) => r.raceId));
  const remainingRaceIds = allRaces.filter((r) => !completedIds.has(r.id)).map((r) => r.id);

  const probabilities = simulateChampionship(drivers, raceResults, remainingRaceIds);

  const simulation = {
    remainingRaces: remainingRaceIds.length,
    iterations: 10000,
    probabilities,
    generatedAt: new Date().toISOString()
  };

  cache.set(cacheKeys.simulation(), simulation, 600000); // Cache for 10 minutes
  logger.debug('Championship simulation cached');

  sendSuccess(res, simulation);
});

/**
 * Submit race result and invalidate caches
 */
exports.submitRaceResult = asyncHandler(async (req, res) => {
  const { raceId, finishingOrder } = req.body;

  if (!Array.isArray(finishingOrder) || finishingOrder.length < 1) {
    throw new ValidationError('finishingOrder must be a non-empty array of driver IDs');
  }

  const race = await Race.findOne({ id: raceId });
  if (!race) throw new NotFoundError('Race');

  const knownDrivers = new Set((await Driver.find({}, { id: 1 })).map((d) => d.id));
  const unknown = finishingOrder.filter((id) => !knownDrivers.has(id));
  if (unknown.length || new Set(finishingOrder).size !== finishingOrder.length) {
    throw new ValidationError(
      unknown.length ? `Unknown driver id(s): ${unknown.join(', ')}` : 'finishingOrder contains duplicate drivers'
    );
  }

  const result = await RaceResult.findOneAndUpdate(
    { raceId },
    { finishingOrder, source: 'manual', recordedAt: new Date() },
    { upsert: true, new: true }
  );

  // Invalidate all related caches
  invalidationPatterns.onRaceSubmitted();
  logger.info('Race result submitted', { raceId, drivers: finishingOrder.length });

  await recalculateLeaderboard();

  sendSuccess(res, result, 'Race result submitted successfully', 201);
});

/**
 * Pull the latest official results now (admin)
 */
exports.syncResultsNow = asyncHandler(async (req, res) => {
  const summary = await maybeSync({ force: true });
  sendSuccess(res, { summary, status: getSyncStatus() }, summary?.error ? 'Sync failed' : 'Sync complete');
});

/**
 * Get race results
 */
exports.getRaceResults = asyncHandler(async (req, res) => {
  const cachedData = cache.get(cacheKeys.raceResults());
  if (cachedData) {
    logger.debug('Race results from cache');
    return sendSuccess(res, cachedData);
  }

  const results = await RaceResult.find({}, { _id: 0, __v: 0 }).sort({ raceId: 1 });

  cache.set(cacheKeys.raceResults(), results, 300000);
  logger.debug('Race results cached');

  sendSuccess(res, results, 'Race results retrieved');
});

/**
 * Export all data
 */
exports.exportData = asyncHandler(async (req, res) => {
  const startTime = Date.now();

  // Regular users export public data plus their own predictions. Admins also get the user list.
  // Tokens, sessions and password hashes are never exported.
  const admin = isAdmin(req.user?.username);
  const [drivers, races, predictions, leaderboard, users, raceResults] = await Promise.all([
    Driver.find({}, { _id: 0, __v: 0 }),
    Race.find({}, { _id: 0, __v: 0 }),
    Prediction.find(admin ? {} : { userName: req.user.username }, { _id: 0, __v: 0 }),
    Leaderboard.find({}, { _id: 0, __v: 0 }),
    admin ? User.find({}, { _id: 0, username: 1, displayName: 1, joined: 1 }) : Promise.resolve([]),
    RaceResult.find({}, { _id: 0, __v: 0 })
  ]);

  const exportData = {
    drivers,
    races,
    predictions,
    leaderboard,
    users,
    raceResults,
    exportedAt: new Date().toISOString(),
    recordCount: {
      drivers: drivers.length,
      races: races.length,
      predictions: predictions.length,
      users: users.length,
      raceResults: raceResults.length
    }
  };

  const duration = Date.now() - startTime;
  logger.info('Data export completed', { duration, records: Object.values(exportData.recordCount) });

  sendSuccess(res, exportData, 'Data exported successfully');
});

/**
 * Get driver detailed statistics
 */
exports.getDriverStats = asyncHandler(async (req, res) => {
  const { driverId } = req.params;

  const driver = await Driver.findOne({ id: driverId });
  if (!driver) throw new NotFoundError('Driver');

  const raceResults = await RaceResult.find({}).sort({ raceId: 1 });
  const stats = calculateDriverStats(driver, raceResults);
  const streaks = findDriverStreaks(driver, raceResults);
  const insights = generateDriverInsights(driver, stats, streaks);

  const response = {
    ...stats,
    streaks,
    insights
  };

  sendSuccess(res, response, 'Driver statistics retrieved');
});

/**
 * Get team statistics
 */
exports.getTeamStats = asyncHandler(async (req, res) => {
  const { team } = req.params;

  const drivers = await Driver.find({ team });
  if (drivers.length === 0) throw new NotFoundError('Team');

  const raceResults = await RaceResult.find({}).sort({ raceId: 1 });
  const teamStats = calculateTeamStats(team, drivers, raceResults);

  // Calculate individual driver stats for team
  const driverStats = drivers.map((d) => ({
    name: d.name,
    code: d.code,
    stats: calculateDriverStats(d, raceResults)
  }));

  sendSuccess(res, { ...teamStats, drivers: driverStats }, 'Team statistics retrieved');
});

/**
 * Compare two drivers
 */
exports.compareDrivers = asyncHandler(async (req, res) => {
  const { driver1Id, driver2Id } = req.params;

  const driver1 = await Driver.findOne({ id: driver1Id });
  const driver2 = await Driver.findOne({ id: driver2Id });

  if (!driver1 || !driver2) throw new NotFoundError('Driver');

  const raceResults = await RaceResult.find({}).sort({ raceId: 1 });
  const comparison = compareDrivers(driver1, driver2, raceResults);

  sendSuccess(res, comparison, 'Driver comparison retrieved');
});

/**
 * Get race predictions with advanced algorithm
 */
exports.getRacePredictions = asyncHandler(async (req, res) => {
  const { raceId } = req.params;
  const { weather } = req.query;

  const race = await Race.findOne({ id: Number(raceId) });
  if (!race) throw new NotFoundError('Race');

  const drivers = await Driver.find({});
  const raceResults = await RaceResult.find({}).sort({ raceId: 1 });

  const weatherFactor = weather === 'rain' ? 1.2 : weather === 'clear' ? 0.8 : 1.0;
  const raceInfo = weather === 'rain' || weather === 'clear'
    ? { ...race.toObject(), weather: { type: weather } }
    : race;
  const predictions = predictRaceOutcome(drivers, raceResults, raceInfo, weatherFactor);

  const response = {
    raceId: Number(raceId),
    raceName: race.name,
    predictions,
    generatedAt: new Date().toISOString()
  };

  sendSuccess(res, response, 'Race predictions retrieved');
});
