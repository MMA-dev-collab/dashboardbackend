const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const routineController = require('./growth-routine.controller');
const { checkinSchema } = require('./growth-routine.validator');
const { validate } = require('../../middleware/validate');

const router = Router();

router.use(authenticate);

router.get('/status', routineController.getStatus);
router.post('/checkin', validate(checkinSchema), routineController.checkin);

module.exports = router;
