const { Router } = require('express');
const columnsController = require('./columns.controller');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');

const router = Router({ mergeParams: true });

router.use(authenticate);

// Get columns for a project
router.get('/', columnsController.listColumns);

// Create custom column
router.post('/', requireRole('Admin', 'Partner'), columnsController.createColumn);

// Update/Reorder
router.put('/:columnId', requireRole('Admin', 'Partner'), columnsController.updateColumn);
router.delete('/:columnId', requireRole('Admin'), columnsController.deleteColumn);

module.exports = router;
