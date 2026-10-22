const express = require('express');
const championshipController = require('../controllers/championshipController');
const authenticate = require('../middleware/auth');
const { requireAdmin } = require('../middleware/auth');
const { syncOnRead } = require('../services/resultsSync');

const router = express.Router();

// Reading standings also nudges the (throttled) background result sync
router.get('/drivers', syncOnRead, championshipController.getDriverStandings);
router.get('/constructors', syncOnRead, championshipController.getConstructorStandings);
router.get('/simulation', syncOnRead, championshipController.getChampionshipSimulation);
router.get('/results', syncOnRead, championshipController.getRaceResults);
router.get('/drivers/:driverId/stats', championshipController.getDriverStats);
router.get('/drivers/:driver1Id/compare/:driver2Id', championshipController.compareDrivers);
router.get('/teams/:team/stats', championshipController.getTeamStats);
router.get('/races/:raceId/predictions', championshipController.getRacePredictions);
router.post('/results', authenticate, requireAdmin, championshipController.submitRaceResult);
router.post('/sync', authenticate, requireAdmin, championshipController.syncResultsNow);
router.get('/export', authenticate, championshipController.exportData);

module.exports = router;
