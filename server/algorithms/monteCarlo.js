const { getPointsForPosition, calculateDriverStandings } = require('./f1Points');
const { MONTE_CARLO_ITERATIONS } = require('../config/constants');

/**
 * Monte Carlo simulation for championship probability.
 * For each iteration, randomly assigns finishing positions for remaining races
 * using weighted probabilities based on current standings, then counts titles.
 *
 * Algorithm: Monte Carlo method with inverse-rank weighting (better drivers
 * more likely to finish higher in simulated races).
 */
function simulateChampionship(drivers, raceResults, remainingRaceIds, iterations = MONTE_CARLO_ITERATIONS) {
  const driverIds = drivers.map((d) => d.id);
  const currentPoints = buildCurrentPoints(drivers, raceResults);
  const weights = buildDriverWeights(currentPoints, driverIds);
  const titleCounts = Object.fromEntries(driverIds.map((id) => [id, 0]));

  for (let i = 0; i < iterations; i += 1) {
    const simPoints = { ...currentPoints };

    remainingRaceIds.forEach(() => {
      const order = simulateRaceFinish(weights, driverIds);
      order.forEach((driverId, idx) => {
        simPoints[driverId] = (simPoints[driverId] || 0) + getPointsForPosition(idx + 1);
      });
    });

    const winner = findLeader(simPoints, drivers);
    if (winner) titleCounts[winner] += 1;
  }

  return driverIds
    .map((id) => {
      const driver = drivers.find((d) => d.id === id);
      return {
        driverId: id,
        name: driver?.name,
        code: driver?.code,
        number: driver?.number,
        team: driver?.team,
        teamColor: driver?.teamColor,
        probability: Math.round((titleCounts[id] / iterations) * 1000) / 10
      };
    })
    .sort((a, b) => b.probability - a.probability);
}

function buildCurrentPoints(drivers, raceResults) {
  // Same numbers as the standings table (race + sprint points)
  return Object.fromEntries(calculateDriverStandings(drivers, raceResults).map((s) => [s.driverId, s.points]));
}

/**
 * Weight = 1 / (rank + 1) so P1 in standings gets highest probability.
 */
function buildDriverWeights(currentPoints, driverIds) {
  const sorted = [...driverIds].sort((a, b) => (currentPoints[b] || 0) - (currentPoints[a] || 0));
  const weights = {};
  sorted.forEach((id, rank) => {
    weights[id] = 1 / (rank + 1);
  });
  return weights;
}

/**
 * Weighted random sampling without replacement (Fisher-Yates variant).
 */
function simulateRaceFinish(weights, driverIds) {
  const remaining = [...driverIds];
  const order = [];

  while (remaining.length > 0) {
    const totalWeight = remaining.reduce((sum, id) => sum + (weights[id] || 0.1), 0);
    let roll = Math.random() * totalWeight;
    let picked = remaining[0];

    for (const id of remaining) {
      roll -= weights[id] || 0.1;
      if (roll <= 0) {
        picked = id;
        break;
      }
    }

    order.push(picked);
    remaining.splice(remaining.indexOf(picked), 1);
  }

  return order;
}

function findLeader(points, drivers) {
  let best = null;
  let bestPts = -1;
  drivers.forEach((d) => {
    if ((points[d.id] || 0) > bestPts) {
      bestPts = points[d.id] || 0;
      best = d.id;
    }
  });
  return best;
}

module.exports = { simulateChampionship, buildCurrentPoints };
