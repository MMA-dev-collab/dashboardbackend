const { Router } = require('express');
const financeController = require('./finance.controller');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/auditLog');

const router = Router();
router.use(authenticate);
router.use(auditLog('finance'));

router.get('/overview', requireRole('Admin', 'Finance Approver'), financeController.getOverview);
router.get('/projects/:projectId', financeController.getProjectFinance);
router.post('/projects/:projectId/payments', requireRole('Admin', 'Finance Approver'), financeController.recordPayment);

module.exports = router;
