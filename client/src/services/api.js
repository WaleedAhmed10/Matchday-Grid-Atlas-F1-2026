/**
 * Centralized API service with error handling, interceptors, and retries
 * Handles authentication, response formatting, and error recovery
 */

const API_URL = import.meta.env.VITE_API_URL || '/api';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // ms

/**
 * Retry mechanism with exponential backoff
 */
async function withRetry(fn, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // fetch() rejects with a TypeError when the network/server is unreachable.
      // Only that is retried (never 4xx/5xx responses, never an aborted request).
      if (attempt < retries - 1 && error instanceof TypeError) {
        const delay = RETRY_DELAY * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Main API call function with error handling
 */
export async function apiCall(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  try {
    // Only GETs are retried: re-sending a POST/DELETE could apply it twice
    const retries = (options.method || 'GET').toUpperCase() === 'GET' ? MAX_RETRIES : 1;
    const response = await withRetry(async () => {
      return await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers,
        signal: controller.signal
      });
    }, retries);

    clearTimeout(timeoutId);

    // Handle non-2xx responses
    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = { error: `HTTP ${response.status}` };
      }

      const error = new Error(errorData.error || errorData.data?.error || 'API request failed');
      error.statusCode = response.status;
      error.details = errorData.details;

      // A 401 on a normal request means the saved session is no longer valid:
      // forget it and tell the app to show the signed-out state. (A 401 from
      // sign-in itself just means "wrong username or password".)
      if (response.status === 401 && !endpoint.startsWith('/auth/')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.dispatchEvent(new Event('auth:expired'));
        error.message = 'Authentication required';
      }

      throw error;
    }

    let data;
    try {
      data = await response.json();
    } catch {
      // HTML instead of JSON = the request never reached the API server
      throw new Error('The server returned an unexpected response. Check that the API is running and VITE_API_URL points to it.');
    }

    // Handle success responses (with new format)
    if (data.success === false) {
      const error = new Error(data.error || 'API request failed');
      error.details = data.details;
      throw error;
    }

    // Return data directly if it's old format, or data field if new format
    return data.data !== undefined ? data.data : data;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error('Request timeout - please try again');
    }
    if (error instanceof TypeError) {
      // fetch() rejects with TypeError when the server can't be reached at all
      throw new Error('Cannot reach the server. Check your connection and that the API is running.');
    }

    throw error;
  }
}

/**
 * Handle API errors and return user-friendly message
 */
export function getErrorMessage(error) {
  if (typeof error === 'string') return error;
  if (error.details) return Object.values(error.details)[0] || error.message;
  return error.message || 'An unexpected error occurred';
}

/**
 * API endpoints
 */
export const api = {
  // Drivers
  getDrivers: () => apiCall('/drivers'),
  getDriver: (id) => apiCall(`/drivers/${id}`),
  getDriverStats: (id) => apiCall(`/championship/drivers/${id}/stats`),

  // Races
  getRaces: () => apiCall('/races'),
  getRace: (id) => apiCall(`/races/${id}`),
  getRaceResults: () => apiCall('/championship/results'),
  getPredictions: (raceId) => apiCall(`/championship/races/${raceId}/predictions`),

  // Predictions
  submitPrediction: (raceId, driverId) =>
    apiCall('/predictions', {
      method: 'POST',
      body: JSON.stringify({ raceId, driverId })
    }),
  getUserPredictions: () => apiCall('/predictions'),
  deletePredictions: () => apiCall('/predictions', { method: 'DELETE' }),

  // Leaderboard
  getLeaderboard: (limit = 10) => apiCall(`/leaderboard?limit=${limit}`),

  // Championship
  getDriverStandings: () => apiCall('/championship/drivers'),
  getConstructorStandings: () => apiCall('/championship/constructors'),
  getChampionshipSimulation: () => apiCall('/championship/simulation'),
  submitRaceResult: (raceId, finishingOrder) =>
    apiCall('/championship/results', {
      method: 'POST',
      body: JSON.stringify({ raceId, finishingOrder })
    }),
  getTeamStats: (team) => apiCall(`/championship/teams/${team}/stats`),
  compareDrivers: (driver1Id, driver2Id) =>
    apiCall(`/championship/drivers/${driver1Id}/compare/${driver2Id}`),

  // Authentication
  signup: (username, password, displayName) =>
    apiCall('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName })
    }),
  signin: (username, password) =>
    apiCall('/auth/signin', {
      method: 'POST',
      // Lets an account created before passwords existed prove it is yours (old token in this browser)
      body: JSON.stringify({ username, password, legacyToken: localStorage.getItem('token') || undefined })
    }),
  signout: () => apiCall('/auth/signout', { method: 'POST' }),
  me: () => apiCall('/auth/me'),

  // Export
  exportData: () => apiCall('/export')
};

export default api;

