/**
 * Automatic race-result sync.
 *
 * Pulls the official classification (race + sprint) from the free Jolpica F1 API
 * (the Ergast successor) and stores it as RaceResult documents. Standings, the
 * Monte Carlo simulation and the player leaderboard are all derived from
 * RaceResult, so once a GP result appears here every point total updates.
 *
 * Triggers:
 *  - once at server start and then every RESULTS_SYNC_INTERVAL_MIN minutes
 *  - lazily (throttled) whenever standings / leaderboard / results are requested,
 *    so it still works on hosts that put idle servers to sleep
 *  - manually through POST /api/championship/sync (admin)
 */
const Driver = require('../models/Driver');
const Race = require('../models/Race');
const RaceResult = require('../models/RaceResult');
const { invalidationPatterns } = require('../utils/cache');
const { logger } = require('../utils/logger');
const { recalculateLeaderboard } = require('./leaderboardService');

const API_BASE = process.env.F1_API_BASE || 'https://api.jolpi.ca/ergast/f1';
const SEASON = process.env.F1_SEASON || '2026';
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const SYNC_ENABLED = process.env.RESULTS_SYNC !== 'off';
const INTERVAL_MS = (Number(process.env.RESULTS_SYNC_INTERVAL_MIN) || 30) * 60 * 1000;
const MIN_GAP_MS = (Number(process.env.RESULTS_SYNC_MIN_GAP_MIN) || 10) * 60 * 1000;

// Jolpica circuitId -> `circuit` column in datasets/races.csv
const CIRCUIT_ALIASES = {
  albert_park: 'Albert Park',
  shanghai: 'Shanghai',
  suzuka: 'Suzuka',
  bahrain: 'Sakhir',
  jeddah: 'Jeddah',
  miami: 'Miami',
  villeneuve: 'Montreal',
  monaco: 'Monte Carlo',
  catalunya: 'Barcelona',
  red_bull_ring: 'Spielberg',
  silverstone: 'Silverstone',
  spa: 'Spa',
  hungaroring: 'Hungaroring',
  zandvoort: 'Zandvoort',
  monza: 'Monza',
  baku: 'Baku',
  marina_bay: 'Marina Bay',
  americas: 'COTA',
  rodriguez: 'Mexico City',
  interlagos: 'Interlagos',
  vegas: 'Las Vegas',
  losail: 'Lusail',
  yas_marina: 'Yas Marina',
  madring: 'Madrid',
  sepang: 'Kuala Lumpur'
};

const norm = (value) => String(value || '').trim().toLowerCase();

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`F1 API ${response.status} for ${url}`);
  return response.json();
}

/**
 * Download every race of the season for `kind` ('results' | 'sprint'), following
 * pagination, and merge rows of the same round back together.
 * Returns Map<round, raceObject>.
 */
async function fetchSeason(kind, fetchImpl = fetch) {
  const rowsKey = kind === 'sprint' ? 'SprintResults' : 'Results';
  const rounds = new Map();
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await fetchJson(`${API_BASE}/${SEASON}/${kind}.json?limit=${PAGE_SIZE}&offset=${offset}`, fetchImpl);
    const races = json?.MRData?.RaceTable?.Races || [];
    const total = Number(json?.MRData?.total) || 0;

    races.forEach((race) => {
      const round = Number(race.round);
      if (!rounds.has(round)) rounds.set(round, { ...race, [rowsKey]: [] });
      rounds.get(round)[rowsKey].push(...(race[rowsKey] || []));
    });

    offset += PAGE_SIZE;
    if (!races.length || offset >= total) break;
  }
  return rounds;
}

/** Classification rows -> ordered array of our driver ids (matched on 3-letter code). */
function toDriverOrder(rows, codeToId) {
  const unknown = [];
  const order = [];
  [...rows]
    .sort((a, b) => Number(a.position) - Number(b.position))
    .forEach((row) => {
      const id = codeToId.get(norm(row.Driver?.code));
      if (id) order.push(id);
      else unknown.push(row.Driver?.code || row.Driver?.driverId);
    });
  return { order, unknown };
}

/** Find our Race for a Jolpica race: same circuit first, then same date. */
function matchRace(apiRace, ourRaces) {
  const circuitId = apiRace.Circuit?.circuitId;
  const wanted = [
    CIRCUIT_ALIASES[circuitId],
    apiRace.Circuit?.Location?.locality,
    apiRace.Circuit?.circuitName
  ].map(norm).filter(Boolean);

  return (
    ourRaces.find((race) => wanted.includes(norm(race.circuit))) ||
    ourRaces.find((race) => race.date === apiRace.date) ||
    null
  );
}

const sameOrder = (a = [], b = []) => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Run one sync. Safe to call at any time; never throws for API problems
 * (they are returned in `error`) so callers can fire-and-forget.
 */
async function syncResults({ fetchImpl = fetch } = {}) {
  const summary = { checked: 0, updated: [], created: [], skipped: [], warnings: [], error: null };

  try {
    const [raceRounds, sprintRounds, drivers, ourRaces, existing] = await Promise.all([
      fetchSeason('results', fetchImpl),
      fetchSeason('sprint', fetchImpl),
      Driver.find({}),
      Race.find({}),
      RaceResult.find({})
    ]);

    const codeToId = new Map(drivers.map((d) => [norm(d.code), d.id]));
    const existingByRace = new Map(existing.map((r) => [r.raceId, r]));
    const usedRaceIds = new Set();
    let maxId = ourRaces.reduce((max, race) => Math.max(max, race.id), -1);

    for (const [round, apiRace] of [...raceRounds.entries()].sort((a, b) => a[0] - b[0])) {
      summary.checked += 1;
      const { order, unknown } = toDriverOrder(apiRace.Results || [], codeToId);
      if (!order.length) {
        summary.skipped.push(`round ${round}: empty classification`);
        continue;
      }
      if (unknown.length) {
        summary.warnings.push(`${apiRace.raceName}: driver(s) not in datasets/drivers.csv: ${unknown.join(', ')}`);
      }

      const sprintRace = sprintRounds.get(round);
      const sprintOrder = sprintRace ? toDriverOrder(sprintRace.SprintResults || [], codeToId).order : [];

      let race = matchRace(apiRace, ourRaces.filter((r) => !usedRaceIds.has(r.id)));
      if (!race) {
        // Round missing from datasets/races.csv: add it so its points are not lost.
        maxId = Math.max(maxId + 1, 100 + round);
        race = await Race.create({
          id: maxId,
          name: String(apiRace.raceName || `Round ${round}`).replace('Grand Prix', 'GP'),
          flag: '🏁',
          date: apiRace.date,
          circuit: apiRace.Circuit?.Location?.locality || apiRace.Circuit?.circuitName || `Round ${round}`
        });
        ourRaces.push(race);
        summary.created.push(race.name);
      }
      usedRaceIds.add(race.id);

      const current = existingByRace.get(race.id);
      if (current && sameOrder(current.finishingOrder, order) && sameOrder(current.sprintOrder, sprintOrder)) {
        continue;
      }

      await RaceResult.findOneAndUpdate(
        { raceId: race.id },
        { finishingOrder: order, sprintOrder, source: 'jolpica', recordedAt: new Date() },
        { upsert: true, new: true }
      );
      summary.updated.push(race.name);
    }

    if (summary.updated.length || summary.created.length) {
      invalidationPatterns.onRaceSubmitted();
      await recalculateLeaderboard();
      logger.info('Race results synced', { updated: summary.updated, created: summary.created });
    }
    summary.warnings.forEach((warning) => logger.warn(warning));
  } catch (err) {
    summary.error = err.message;
    logger.error('Race result sync failed', { error: err.message });
  }

  return summary;
}

// ---- scheduling -------------------------------------------------------------

const state = { running: null, lastRun: 0, lastSummary: null };

/** Run a sync unless one is running or the last one was very recent. */
function maybeSync({ force = false, fetchImpl } = {}) {
  if (!SYNC_ENABLED && !force) return Promise.resolve(state.lastSummary);
  if (state.running) return state.running;
  if (!force && Date.now() - state.lastRun < MIN_GAP_MS) return Promise.resolve(state.lastSummary);

  state.lastRun = Date.now();
  state.running = syncResults({ fetchImpl })
    .then((summary) => {
      state.lastSummary = { ...summary, at: new Date().toISOString() };
      if (summary.error) state.lastRun = Date.now() - MIN_GAP_MS + 60 * 1000; // retry in ~1 min after a failure
      return state.lastSummary;
    })
    .finally(() => { state.running = null; });
  return state.running;
}

/** Express middleware: kick off a throttled background sync, never delays the response. */
function syncOnRead(req, res, next) {
  maybeSync().catch(() => {});
  next();
}

function startResultsSync() {
  if (!SYNC_ENABLED) {
    logger.info('Race result sync disabled (RESULTS_SYNC=off)');
    return;
  }
  maybeSync({ force: true }).catch(() => {});
  setInterval(() => maybeSync({ force: true }).catch(() => {}), INTERVAL_MS).unref();
  logger.info('Race result sync started', { everyMinutes: INTERVAL_MS / 60000, season: SEASON });
}

const getSyncStatus = () => ({ enabled: SYNC_ENABLED, running: !!state.running, last: state.lastSummary });

module.exports = {
  syncResults,
  maybeSync,
  syncOnRead,
  startResultsSync,
  getSyncStatus,
  // exported for tests
  fetchSeason,
  toDriverOrder,
  matchRace
};
