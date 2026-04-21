const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const scheduleController = require('./growth-schedule.controller');
const { validate } = require('../../middleware/validate');
const { createScheduleSchema, createBlockSchema, updateBlockSchema, detectConflictsSchema, optimizeSchema, setGamingTimeSchema } = require('./growth-schedule.validator');

const router = Router();

router.use(authenticate);

router.get('/', scheduleController.list);
router.get('/:date', scheduleController.getByDate);
router.post('/', validate(createScheduleSchema), scheduleController.createSchedule);
router.post('/:id/blocks', validate(createBlockSchema), scheduleController.addBlock);
router.put('/:id/blocks/:blockId', validate(updateBlockSchema), scheduleController.updateBlock);
router.delete('/:id/blocks/:blockId', scheduleController.removeBlock);
router.get('/:date/free-time', scheduleController.getFreeTime);
router.put('/:date/gaming-time', validate(setGamingTimeSchema), scheduleController.setGamingTime);
router.get('/:date/gaming-time', scheduleController.getEffectiveGamingTime);
router.post('/detect-conflicts', validate(detectConflictsSchema), scheduleController.detectConflicts);
router.post('/optimize', validate(optimizeSchema), scheduleController.optimize);

module.exports = router;
