const { Router } = require('express');
const sprintsController = require('./sprints.controller');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');

const router = Router({ mergeParams: true });

router.use(authenticate);

router.get('/', sprintsController.listSprints);
router.post('/', requireRole('Admin', 'Partner'), sprintsController.createSprint);
router.patch('/:sprintId/start', requireRole('Admin', 'Partner'), sprintsController.startSprint);
router.patch('/:sprintId/complete', requireRole('Admin', 'Partner'), sprintsController.completeSprint);

module.exports = router;
