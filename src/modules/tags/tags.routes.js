const { Router } = require('express');
const tagsController = require('./tags.controller');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');

// Project-level tag routes  (mergeParams from parent project router)
const projectRouter = Router({ mergeParams: true });
projectRouter.use(authenticate);
projectRouter.get('/', tagsController.listByProject);
projectRouter.post('/', requireRole('Admin', 'Partner'), tagsController.createTag);
projectRouter.delete('/:tagId', requireRole('Admin', 'Partner'), tagsController.deleteTag);

// Task-level tag routes (mergeParams from parent task router)
const taskRouter = Router({ mergeParams: true });
taskRouter.use(authenticate);
taskRouter.post('/', tagsController.assignTagToTask);
taskRouter.delete('/:tagId', tagsController.removeTagFromTask);

module.exports = { projectRouter, taskRouter };
