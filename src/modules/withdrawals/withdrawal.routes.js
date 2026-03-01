const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/auditLog');
const withdrawalService = require('./withdrawal.service');
const { success, created, paginated } = require('../../utils/response');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');

const router = Router();
router.use(authenticate);
router.use(auditLog('withdrawals'));

// Submit withdrawal request
router.post('/', async (req, res, next) => {
  try {
    const request = await withdrawalService.submitRequest(
      req.user.id,
      req.body.amount,
      req.body.note
    );
    created(res, request, 'Withdrawal request submitted');
  } catch (err) { next(err); }
});

// List requests (Admin: all, Partner: own)
router.get('/', async (req, res, next) => {
  try {
    const pagination = parsePagination(req.query);
    const filters = { status: req.query.status };

    if (!req.user.roles.includes('Admin') && !req.user.roles.includes('Finance Approver')) {
      filters.userId = req.user.id;
    }

    const { requests, total } = await withdrawalService.list(filters, pagination);
    paginated(res, requests, buildPaginationMeta(total, pagination.page, pagination.limit));
  } catch (err) { next(err); }
});

// Approve
router.post('/:id/approve', requireRole('Admin', 'Finance Approver'), async (req, res, next) => {
  try {
    const result = await withdrawalService.approveRequest(req.params.id, req.user.id);
    success(res, result, 'Withdrawal approved');
  } catch (err) { next(err); }
});

// Reject
router.post('/:id/reject', requireRole('Admin', 'Finance Approver'), async (req, res, next) => {
  try {
    const result = await withdrawalService.rejectRequest(req.params.id, req.user.id, req.body.reason);
    success(res, result, 'Withdrawal rejected');
  } catch (err) { next(err); }
});

module.exports = router;
