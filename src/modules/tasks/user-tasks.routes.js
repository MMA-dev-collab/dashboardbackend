const { Router } = require('express');
const reportsService = require('../reports/reports.service');
const { authenticate } = require('../../middleware/auth');
const { success } = require('../../utils/response');

const router = Router();
router.use(authenticate);

// My Tasks - tasks assigned to current user across all projects
router.get('/my-tasks', async (req, res, next) => {
    try {
        const { status } = req.query;
        const data = await reportsService.getMyTasks(req.user.id, status || 'ALL');
        success(res, data);
    } catch (err) { next(err); }
});

module.exports = router;
