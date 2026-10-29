# Matchday Atlas Grid

F1 2026 predictor, part of the **Matchday Atlas** family (sister app: Matchday Atlas Cup for the World Cup). Unofficial fan project, not affiliated with Formula 1 or the FIA.


A full-stack web app for predicting Formula 1 2026 race outcomes and championship standings, with a weighted prediction model and Monte Carlo championship simulation.

## Features

- Submit race-by-race predictions (winner + top 3) with a username + password account
- Live driver and constructor championship standings
- Weighted race-outcome predictor (historical performance, form, circuit fit, weather, qualifying)
- Monte Carlo simulation (10,000 runs) for championship win probabilities
- Prediction scoring and accuracy tracking
- Player leaderboard
- Driver stats: win rate, points average, form trend, consistency, head-to-head

## Datasets

Driver and race data are maintained in `datasets/drivers.csv` and `datasets/races.csv`.
The backend imports these files when seeding MongoDB, and the frontend reads the driver
CSV for its offline fallback. Driver standings are a snapshot from 2026-10-04. Restart the
backend after editing either CSV and rebuild the frontend to refresh its bundled fallback.
Keep the CSV headers unchanged.

## Tech Stack

**Frontend:** React, Vite

**Backend:** Node.js, Express, MongoDB, Mongoose

Auth: username + password (hashed with Node's built-in scrypt, no extra dependency). Every sign-in creates a random session token for that device (sent as `Authorization: Bearer <token>`); only its SHA-256 hash is stored, it expires after 30 days (`SESSION_DAYS`) and signing out invalidates it on the server. Accounts created before passwords existed can set their password by signing in from the browser they were created in; the site owner can allow anyone to claim old accounts with `ALLOW_LEGACY_CLAIM=true`.

## Project Structure

```
Matchday-Atlas-Grid/
├── server/     Backend (Node.js/Express)
├── client/     Frontend (React)
└── README.md
```

### server/
- `index.js` — app entry point: middleware, DB connection, seeding, listen on port 5000
- `config/` — DB connection (`db.js`), constants (`constants.js`)
- `models/` — Mongoose schemas: `User`, `Race`, `Driver`, `Prediction`, `Leaderboard`, `RaceResult`
- `middleware/` — `auth.js` (token check), `errorHandler.js`, `validation.js`, `rateLimiter.js`
- `controllers/` — request handling for auth, drivers, races, predictions, leaderboard, championship
- `algorithms/`
  - `f1Points.js` — position → points (25/18/15/12/10/8/6/4/2/1)
  - `advancedPredictor.js` — weighted race-outcome score (historical 30%, form 25%, circuit 20%, weather 15%, qualifying 10%)
  - `monteCarlo.js` — 10,000-run championship simulation
  - `analytics.js` — win rate, points average, form trend, consistency (std. dev.), head-to-head
  - `predictionScoring.js` — +10 correct winner, +5 top-3 pick, accuracy %
  - `raceValidation.js` — validates race results before saving
- `routes/` — REST endpoints for auth, drivers, races, predictions, leaderboard, championship
- `services/leaderboardService.js` — leaderboard update logic
- `utils/` — `logger.js`, `cache.js` (5–10 min in-memory cache), `response.js` (standard response format)
- `seed/` — initial driver/race data and loader

### client/src/
- `App.jsx` — root component: auth state, panel switching, toasts
- `components/`
  - `AuthModal.jsx` — login/signup form
  - `Header.jsx` — nav bar
  - `ErrorBoundary.jsx` — catches render errors
  - `LoadingSpinner.jsx` — loading state
  - `PredictionPanel.jsx` — submit predictions
  - `StandingsPanel.jsx` — championship standings
  - `LeaderboardPanel.jsx` — player leaderboard
  - `MyPredictions.jsx` — your prediction history
  - `SimulationPanel.jsx` — championship win probabilities
- `hooks/useToast.js` — toast notifications
- `services/api.js` — API client with token header, retries (exponential backoff), 30s timeout

## API Endpoints

```
POST /api/auth/signup
POST /api/auth/signin
POST /api/auth/signout
GET  /api/auth/me

GET  /api/drivers

GET  /api/races

GET    /api/predictions
POST   /api/predictions
DELETE /api/predictions

GET /api/leaderboard

POST /api/championship/results      (admin: enter/correct a result by hand)
POST /api/championship/sync         (admin: pull the latest results now)

GET /api/championship/drivers
GET /api/championship/constructors
GET /api/championship/simulation
GET /api/championship/races/:id/predictions[?weather=rain|clear]
GET /api/championship/drivers/:id/stats
GET /api/championship/drivers/:id/compare/:id2
GET /api/championship/teams/:team/stats
GET /api/export                     (your data; admins also get the user list)
```

## Installation

### Backend
```bash
cd server
npm install
cp .env.example .env      # add MONGODB_URI
npm run dev                # starts on port 5000
```

### Frontend
```bash
cd client
npm install
npm start                  # starts on port 5173
```

## Automatic points updates

Everything that shows points (driver & constructor standings, the simulation, the Predict tab's
driver list and the player leaderboard) is calculated from the stored race results. The backend
pulls the official classification, including sprints, from the free Jolpica F1 API:

- when the server starts and then every 30 minutes (`RESULTS_SYNC_INTERVAL_MIN`)
- whenever standings/leaderboard are requested (throttled to once per 10 minutes), so it also
  works on hosts that put idle servers to sleep
- on demand: `POST /api/championship/sync` as an admin

`datasets/races.csv` follows the real 2026 calendar (23 rounds, in date order). Predictions close at 00:00 UTC on race day.
Races are matched to `datasets/races.csv` by circuit (then by date). A round that isn't in the CSV
is added automatically so its points are not lost. Drivers are matched by their 3-letter code, so
keep `code` in `datasets/drivers.csv` identical to the official one.
The frontend re-reads the data every 5 minutes and when you return to the tab.

Set `ADMIN_USERNAMES=yourname` to allow yourself to enter results by hand if the API is down.
Set `RESULTS_SYNC=off` to disable the sync.

## Deploying

`vercel.json` only builds the frontend. The Express API must be hosted somewhere that can run
Node (Render, Railway, Fly.io...) with `MONGODB_URI` set. Then build the frontend with
`VITE_API_URL=https://<your-api-host>/api`; without it the site calls `/api` on its own domain
and sign-in cannot work.

## Prediction Algorithm

Each driver's race-outcome score is a weighted sum:

```
Score = (Historical × 0.30) + (Form × 0.25) + (Circuit Fit × 0.20)
      + (Weather × 0.15) + (Qualifying × 0.10)
```

Each factor is scored 0–100; the result is a 0–100 confidence score.

## Championship Simulation

The Monte Carlo simulation runs the remaining season 10,000 times, using the predictor's win probabilities to randomly determine each race outcome and award points, then reports the percentage of simulations each driver wins.

## Security

- Token-based auth on protected routes
- Input validation and sanitization
- Rate limiting (10 req/min on sign-in/sign-up, 100 req/min general; set `TRUST_PROXY=1` behind a reverse proxy)
- Centralized error handling with typed errors (`ValidationError`, `AuthenticationError`, `ConflictError`)
- CORS restricted to the frontend origin

## License

See [LICENSE](LICENSE).

## Disclaimer

This tool is for entertainment and analytical purposes. Predictions are based on historical data and statistical models — actual results may differ. Refer to official F1 channels for real standings and results.