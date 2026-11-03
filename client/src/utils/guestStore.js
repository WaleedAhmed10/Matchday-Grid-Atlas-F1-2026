// Guest mode: predictions live in this browser only (localStorage), no account needed.
// Shape: { "<raceId>": "<driverId>" }
const KEY = 'guestPredictions';

export function readGuestPicks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeGuestPicks(picks) {
  try {
    if (Object.keys(picks).length) localStorage.setItem(KEY, JSON.stringify(picks));
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked (private mode...): picks just stay in memory for this visit
  }
}
