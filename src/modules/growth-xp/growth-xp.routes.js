const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const xpController = require('./growth-xp.controller');
const { validate } = require('../../middleware/validate');
const { getXpLogsSchema, getLeaderboardSchema } = require('./growth-xp.validator');

const router = Router();

router.use(authenticate);

router.get('/profile', xpController.getProfile);
router.get('/logs', validate(getXpLogsSchema, 'query'), xpController.getLogs);
router.get('/leaderboard', validate(getLeaderboardSchema, 'query'), xpController.getLeaderboard);
router.get('/streak', xpController.getStreak);
router.get('/multipliers', xpController.getMultipliers);

module.exports = router;
