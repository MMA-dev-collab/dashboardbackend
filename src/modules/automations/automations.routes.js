const express = require('express');
const router = express.Router();
const automationController = require('./automations.controller');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');

// Apply auth middleware to all automation routes
router.use(authenticate);

// Admin / Manager only routes
router.use(requireRole('Admin', 'Partner'));

router.get('/', automationController.getRules.bind(automationController));
router.post('/', automationController.createRule.bind(automationController));
router.put('/:id', automationController.updateRule.bind(automationController));
router.delete('/:id', automationController.deleteRule.bind(automationController));
router.get('/:id/logs', automationController.getRuleLogs.bind(automationController));

module.exports = router;
