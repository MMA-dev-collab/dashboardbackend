const { Router } = require('express');
const sprintsController = require('./sprints.controller');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');

const router = Router({ mergeParams: true });

router.use(authenticate);

router.get('/', sprintsController.listSprints);
router.post('/', requireRole('Admin', 'Partner'), sprintsController.createSprint);
router.patch('/:sprintId', requireRole('Admin', 'Partner'), sprintsController.updateSprint);
router.patch('/:sprintId/start', requireRole('Admin', 'Partner'), sprintsController.startSprint);
router.patch('/:sprintId/complete', requireRole('Admin', 'Partner'), sprintsController.completeSprint);
router.patch('/:sprintId/reopen', requireRole('Admin', 'Partner'), sprintsController.reopenSprint);
router.patch('/:sprintId/members', requireRole('Admin', 'Partner'), sprintsController.assignMembers);
router.get('/:sprintId/metrics', sprintsController.getSprintMetrics);

module.exports = router;
