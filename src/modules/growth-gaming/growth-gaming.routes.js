const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const gamingController = require('./growth-gaming.controller');
const { validate } = require('../../middleware/validate');
const { createSessionSchema } = require('./growth-gaming.validator');

const router = Router();

router.use(authenticate);

router.get('/status', gamingController.getStatus);
router.get('/lock-status', gamingController.getLockStatus);
router.get('/sessions', gamingController.listSessions);
router.post('/sessions', validate(createSessionSchema), gamingController.createSession);
router.patch('/sessions/:id/start', gamingController.startSession);
router.patch('/sessions/:id/end', gamingController.endSession);
router.delete('/sessions/:id', gamingController.cancelSession);
router.get('/suggestions', gamingController.getSuggestions);

module.exports = router;
