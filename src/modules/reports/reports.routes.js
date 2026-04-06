const { Router } = require('express');
const reportsController = require('./reports.controller');
const { authenticate } = require('../../middleware/auth');

const router = Router();
router.use(authenticate);

router.get('/task-summary', reportsController.getTaskSummary);
router.get('/workload', reportsController.getWorkload);
router.get('/project-comparison', reportsController.getProjectComparison);
router.get('/active-work-summary', reportsController.getActiveWorkSummary);

module.exports = router;
