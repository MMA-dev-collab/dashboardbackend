const express = require('express');
const router = express.Router();
const analyticsController = require('./analytics.controller');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');

// Apply auth middleware to all analytics routes
router.use(authenticate);

// Analytics endpoints - Only admins/managers should see these typically
router.get(
  '/revenue',
  requireRole('Admin', 'Manager'),
  analyticsController.getRevenueTrends.bind(analyticsController)
);

router.get(
  '/projects',
  requireRole('Admin', 'Manager'),
  analyticsController.getProjectPerformance.bind(analyticsController)
);

router.get(
  '/workload',
  requireRole('Admin', 'Manager'),
  analyticsController.getTeamWorkload.bind(analyticsController)
);

module.exports = router;
