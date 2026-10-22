/**
 * Data analytics and insights module
 * Provides statistical analysis and performance metrics
 */
const { getPointsForPosition, getSprintPointsForPosition } = require('./f1Points');

/**
 * Calculate driver statistics
 */
function calculateDriverStats(driver, raceResults) {
  const stats = {
    driverId: driver.id,
    name: driver.name,
    team: driver.team,
    racesCompleted: 0,
    wins: 0,
    podiums: 0,
    points: 0,
    averageFinishPosition: 0,
    averagePointsPerRace: 0,
    bestFinish: 21, // Worst position
    worstFinish: 0,
    consistencyScore: 0,
    retirements: 0
  };

  let totalPosition = 0;

  raceResults.forEach((result) => {
    const position = result.finishingOrder.indexOf(driver.id);

    if (position !== -1) {
      const finishPosition = position + 1;
      stats.racesCompleted++;
      totalPosition += finishPosition;

      if (finishPosition === 1) stats.wins++;
      if (finishPosition <= 3) stats.podiums++;
      stats.points += getPointsForPosition(finishPosition);

      stats.bestFinish = Math.min(stats.bestFinish, finishPosition);
      stats.worstFinish = Math.max(stats.worstFinish, finishPosition);
    } else {
      stats.retirements++; // not classified in this race
    }

    const sprintPosition = (result.sprintOrder || []).indexOf(driver.id);
    if (sprintPosition !== -1) stats.points += getSprintPointsForPosition(sprintPosition + 1);
  });

  if (stats.racesCompleted === 0) stats.bestFinish = null;

  if (stats.racesCompleted > 0) {
    stats.averageFinishPosition = Math.round((totalPosition / stats.racesCompleted) * 100) / 100;
    stats.averagePointsPerRace = Math.round((stats.points / stats.racesCompleted) * 100) / 100;
    stats.consistencyScore = calculateConsistency(raceResults, driver.id);
  }

  return stats;
}

/**
 * Calculate consistency score (0-100)
 * Higher score = more consistent performance
 */
function calculateConsistency(raceResults, driverId) {
  const positions = [];

  raceResults.forEach((result) => {
    const position = result.finishingOrder.indexOf(driverId);
    if (position !== -1) {
      positions.push(position + 1);
    }
  });

  if (positions.length < 2) return 100;

  const mean = positions.reduce((a, b) => a + b, 0) / positions.length;
  const variance = positions.reduce((a, p) => a + Math.pow(p - mean, 2), 0) / positions.length;
  const stdDev = Math.sqrt(variance);

  // Normalize std dev to 0-100 scale
  const consistency = Math.max(0, 100 - (stdDev * 5));
  return Math.round(consistency);
}

/**
 * Calculate team statistics
 */
function calculateTeamStats(team, drivers, raceResults) {
  const teamDrivers = drivers.filter((d) => d.team === team);
  const stats = {
    team,
    drivers: teamDrivers.map((d) => d.name),
    racesCompleted: 0,
    wins: 0,
    podiums: 0,
    points: 0,
    averagePoints: 0
  };

  const teamIds = new Set(teamDrivers.map((d) => d.id));

  raceResults.forEach((result) => {
    let entered = false;
    result.finishingOrder.forEach((driverId, position) => {
      if (!teamIds.has(driverId)) return;
      entered = true;
      stats.points += getPointsForPosition(position + 1);
      if (position === 0) stats.wins++;
      if (position <= 2) stats.podiums++;
    });
    (result.sprintOrder || []).forEach((driverId, position) => {
      if (teamIds.has(driverId)) stats.points += getSprintPointsForPosition(position + 1);
    });
    if (entered) stats.racesCompleted++;
  });

  if (stats.racesCompleted > 0) {
    stats.averagePoints = Math.round((stats.points / stats.racesCompleted) * 100) / 100;
  }

  return stats;
}

/**
 * Calculate head-to-head comparison between two drivers
 */
function compareDrivers(driver1, driver2, raceResults) {
  const stats1 = calculateDriverStats(driver1, raceResults);
  const stats2 = calculateDriverStats(driver2, raceResults);

  let driver1Wins = 0;
  let driver2Wins = 0;

  raceResults.forEach((result) => {
    const pos1 = result.finishingOrder.indexOf(driver1.id);
    const pos2 = result.finishingOrder.indexOf(driver2.id);

    if (pos1 !== -1 && pos2 !== -1) {
      if (pos1 < pos2) driver1Wins++;
      else if (pos2 < pos1) driver2Wins++;
    }
  });

  return {
    driver1: {
      ...stats1,
      headToHeadWins: driver1Wins
    },
    driver2: {
      ...stats2,
      headToHeadWins: driver2Wins
    },
    comparison: {
      pointsDifference: stats1.points - stats2.points,
      winsDifference: stats1.wins - stats2.wins,
      podiumsDifference: stats1.podiums - stats2.podiums,
      headToHeadRecord: `${driver1Wins}-${driver2Wins}`
    }
  };
}

/**
 * Identify streaks (wins, podiums, points-finishes)
 */
function findDriverStreaks(driver, raceResults) {
  const streaks = {
    currentWinStreak: 0,
    longestWinStreak: 0,
    currentPodiumStreak: 0,
    longestPodiumStreak: 0,
    currentPointsStreak: 0,
    longestPointsStreak: 0
  };

  // Each streak is the run of consecutive races (up to the latest) meeting the condition;
  // it resets to 0 as soon as one race breaks it.
  const track = (key, hit) => {
    streaks[`current${key}Streak`] = hit ? streaks[`current${key}Streak`] + 1 : 0;
    streaks[`longest${key}Streak`] = Math.max(streaks[`longest${key}Streak`], streaks[`current${key}Streak`]);
  };

  raceResults.forEach((result) => {
    const position = result.finishingOrder.indexOf(driver.id);
    track('Win', position === 0);
    track('Podium', position !== -1 && position <= 2);
    track('Points', position !== -1 && position <= 9);
  });

  return streaks;
}

/**
 * Calculate pace differential (average qualifying position vs average race position)
 */
function calculatePaceDifferential(driver, raceDataWithQualifying) {
  if (!raceDataWithQualifying || raceDataWithQualifying.length === 0) return 0;

  let totalQualifyingPos = 0;
  let totalRacePos = 0;
  let validRaces = 0;

  raceDataWithQualifying.forEach((race) => {
    if (race.qualifyingOrder && race.raceResult) {
      const qualifyingPos = race.qualifyingOrder.indexOf(driver.id) + 1;
      const racePos = race.raceResult.finishingOrder.indexOf(driver.id) + 1;

      if (qualifyingPos > 0 && racePos > 0) {
        totalQualifyingPos += qualifyingPos;
        totalRacePos += racePos;
        validRaces++;
      }
    }
  });

  if (validRaces === 0) return 0;

  const avgQualifyingPos = totalQualifyingPos / validRaces;
  const avgRacePos = totalRacePos / validRaces;

  // Positive = improves from qualifying to race
  return Math.round((avgQualifyingPos - avgRacePos) * 100) / 100;
}

/**
 * Generate driver insights and recommendations
 */
function generateDriverInsights(driver, stats, streaks) {
  const insights = [];

  if (stats.wins > 0) {
    insights.push(`${driver.name} has ${stats.wins} win${stats.wins > 1 ? 's' : ''}`);
  }

  if (stats.consistencyScore > 80) {
    insights.push(`Highly consistent performer (score: ${stats.consistencyScore})`);
  } else if (stats.consistencyScore < 40) {
    insights.push(`Variable performance - inconsistent results`);
  }

  if (streaks.longestWinStreak > 1) {
    insights.push(`Best win streak: ${streaks.longestWinStreak} races`);
  }

  if (stats.averageFinishPosition <= 5) {
    insights.push('Strong average finish position - likely podium contender');
  }

  if (stats.retirements > stats.racesCompleted * 0.2) {
    insights.push('High retirement rate - reliability concerns');
  }

  return insights;
}

module.exports = {
  calculateDriverStats,
  calculateConsistency,
  calculateTeamStats,
  compareDrivers,
  findDriverStreaks,
  calculatePaceDifferential,
  generateDriverInsights
};
