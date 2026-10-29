require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const seedDatabase = require('./seed');
const { PORT } = require('./config/constants');

// Import new middleware and utilities
const { errorHandler, asyncHandler } = require('./middleware/errorHandler');
const { requestLogger, logger } = require('./utils/logger');
const { responseFormatter } = require('./utils/response');
const { apiRateLimit } = require('./middleware/rateLimiter');

// Import routes
const authRoutes = require('./routes/authRoutes');
const driverRoutes = require('./routes/driverRoutes');
const raceRoutes = require('./routes/raceRoutes');
const predictionRoutes = require('./routes/predictionRoutes');
const leaderboardRoutes = require('./routes/leaderboardRoutes');
const championshipRoutes = require('./routes/championshipRoutes');
const championshipController = require('./controllers/championshipController');
const authenticate = require('./middleware/auth');
const { startResultsSync, syncOnRead } = require('./services/resultsSync');
const { recalculateLeaderboard } = require('./services/leaderboardService');

const app = express();

// Behind a reverse proxy (Render, Railway, Heroku, nginx...) set TRUST_PROXY=1 so the
// rate limiter sees the real client IP instead of the proxy's.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

// Middleware setup
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Logging middleware
app.use(requestLogger(logger));

// Response formatting middleware
app.use(responseFormatter);

// Rate limiting
app.use(apiRateLimit());

// Health check endpoint
app.get('/api/health', asyncHandler((req, res) => {
  res.json({ status: 'ok', service: 'Matchday Atlas Grid', timestamp: new Date().toISOString() });
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/races', raceRoutes);
app.use('/api/predictions', predictionRoutes);
app.use('/api/leaderboard', syncOnRead, leaderboardRoutes);
app.use('/api/championship', championshipRoutes);

app.get('/api/export', authenticate, asyncHandler(championshipController.exportData));

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    statusCode: 404,
    success: false,
    error: 'Endpoint not found',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
connectDB()
  .then(() => {
    logger.info('Database connected successfully');
    return seedDatabase();
  })
  .then(() => {
    logger.info('Database seeded successfully');
    return recalculateLeaderboard();
  })
  .then(() => {
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`, { port: PORT });
      startResultsSync();
    });
  })
  .catch((err) => {
    logger.error('Failed to start server', { error: err.message });
    process.exit(1);
  });
