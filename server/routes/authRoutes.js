const express = require('express');
const authController = require('../controllers/authController');
const authenticate = require('../middleware/auth');
const { authRateLimit } = require('../middleware/rateLimiter');

const router = express.Router();

router.post('/signup', authRateLimit(), authController.signup);
router.post('/signin', authRateLimit(), authController.signin);
router.get('/me', authenticate, authController.me);
router.post('/signout', authenticate, authController.signout);

module.exports = router;
