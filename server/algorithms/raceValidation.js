/**
 * Predictions close when race day starts (00:00 UTC on the race date), so the
 * deadline is the same for everyone and does not depend on the server's timezone.
 */
function isRaceOpenForPredictions(race, now = Date.now()) {
  if (!race?.date) return true;
  const start = Date.parse(`${race.date}T00:00:00Z`);
  return Number.isNaN(start) ? true : now < start;
}

function getRaceStatus(race, hasResult) {
  if (hasResult) return 'completed';
  if (!isRaceOpenForPredictions(race)) return 'locked';
  return 'upcoming';
}

module.exports = { isRaceOpenForPredictions, getRaceStatus };
