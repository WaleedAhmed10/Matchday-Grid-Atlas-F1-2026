const { F1_POINTS_TABLE, SPRINT_POINTS_TABLE } = require('../config/constants');

/**
 * Official F1 points allocation (positions 1-10).
 * Uses lookup table — O(1) per position.
 */
function getPointsForPosition(position) {
  if (position < 1 || position > F1_POINTS_TABLE.length) return 0;
  return F1_POINTS_TABLE[position - 1];
}

function getSprintPointsForPosition(position) {
  if (position < 1 || position > SPRINT_POINTS_TABLE.length) return 0;
  return SPRINT_POINTS_TABLE[position - 1];
}

/**
 * Build driver championship standings from race results.
 * Greedy accumulation: sum points per driver across all completed races.
 * Tie-break: count of race wins, then count of podiums.
 */
function calculateDriverStandings(drivers, raceResults) {
  const standings = new Map();

  drivers.forEach((d) => {
    standings.set(d.id, {
      driverId: d.id,
      name: d.name,
      code: d.code,
      number: d.number,
      flag: d.flag,
      team: d.team,
      teamColor: d.teamColor,
      points: 0,
      wins: 0,
      podiums: 0,
      races: 0
    });
  });

  raceResults.forEach((result) => {
    result.finishingOrder.forEach((driverId, index) => {
      const entry = standings.get(driverId);
      if (!entry) return;
      const position = index + 1;
      const pts = getPointsForPosition(position);
      entry.points += pts;
      entry.races += 1;
      if (position === 1) entry.wins += 1;
      if (position <= 3) entry.podiums += 1;
    });

    // Sprint weekends also award points (8-7-6-5-4-3-2-1); they don't count as wins/podiums
    (result.sprintOrder || []).forEach((driverId, index) => {
      const entry = standings.get(driverId);
      if (entry) entry.points += getSprintPointsForPosition(index + 1);
    });
  });

  return Array.from(standings.values()).sort(compareDriverStandings);
}

/**
 * FIA tie-break: higher points, then more wins, then more podiums, then name.
 */
function compareDriverStandings(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (b.podiums !== a.podiums) return b.podiums - a.podiums;
  return a.name.localeCompare(b.name);
}

/**
 * Constructor championship: aggregate driver points by team.
 */
function calculateConstructorStandings(drivers, raceResults) {
  const driverStandings = calculateDriverStandings(drivers, raceResults);
  const teamMap = new Map();

  driverStandings.forEach((d) => {
    if (!teamMap.has(d.team)) {
      teamMap.set(d.team, { team: d.team, teamColor: d.teamColor, points: 0, wins: 0, podiums: 0 });
    }
    const team = teamMap.get(d.team);
    team.points += d.points;
    team.wins += d.wins;
    team.podiums += d.podiums;
  });

  return Array.from(teamMap.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.team.localeCompare(b.team);
  });
}

module.exports = {
  getPointsForPosition,
  getSprintPointsForPosition,
  calculateDriverStandings,
  calculateConstructorStandings,
  compareDriverStandings,
  F1_POINTS_TABLE
};
