const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const tasksController = require('./growth-tasks.controller');
const { validate } = require('../../middleware/validate');
const { createGrowthTaskSchema, updateGrowthTaskSchema, listGrowthTasksSchema } = require('./growth-tasks.validator');

const router = Router();

router.use(authenticate);

router.get('/', validate(listGrowthTasksSchema, 'query'), tasksController.list);
router.get('/today', tasksController.getToday);
router.post('/', validate(createGrowthTaskSchema), tasksController.create);
router.post('/carry-over', tasksController.carryOver);
router.get('/:id', tasksController.getById);
router.put('/:id', validate(updateGrowthTaskSchema), tasksController.update);
router.delete('/:id', tasksController.delete);
router.patch('/:id/start', tasksController.startTask);
router.patch('/:id/complete', tasksController.completeTask);

module.exports = router;
