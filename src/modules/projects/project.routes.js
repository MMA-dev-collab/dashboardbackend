const { Router } = require('express');
const projectController = require('./project.controller');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');
const { validate } = require('../../middleware/validate');
const { auditLog } = require('../../middleware/auditLog');
const { createProjectSchema, updateProjectSchema, assignPartnersSchema } = require('./project.validator');

const router = Router();
router.use(authenticate);
router.use(auditLog('projects'));

router.get('/', projectController.list);
router.get('/:id', projectController.getById);
router.post('/', requireRole('Admin', 'Partner'), validate(createProjectSchema), projectController.create);
router.put('/:id', requireRole('Admin', 'Partner'), validate(updateProjectSchema), projectController.update);
router.delete('/:id', requireRole('Admin'), projectController.delete);

// Partner assignment
router.post('/:id/partners', requireRole('Admin'), validate(assignPartnersSchema), projectController.assignPartners);

// Milestones
router.post('/:id/milestones', requireRole('Admin', 'Partner'), projectController.addMilestone);
router.patch('/:id/milestones/:milestoneId', requireRole('Admin', 'Partner'), projectController.updateMilestone);

module.exports = router;
