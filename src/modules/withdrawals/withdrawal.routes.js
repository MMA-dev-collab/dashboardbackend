const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/auditLog');
const withdrawalService = require('./withdrawal.service');
const { success, created, paginated } = require('../../utils/response');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const receiptVerifier = require('../../services/ai/receipt-verifier.service');
const prisma = require('../../config/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = Router();
router.use(authenticate);
router.use(auditLog('withdrawals'));

// Configure multer for local file storage
const uploadsDir = path.join(__dirname, '../../../uploads/receipts');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('File type not allowed. Only PDF and images are accepted.'));
  },
});

// Submit withdrawal request (any authenticated user)
router.post('/', async (req, res, next) => {
  try {
    const request = await withdrawalService.submitRequest(
      req.user.id,
      req.body.amount,
      req.body.note
    );
    created(res, request, 'Withdrawal request submitted and pending admin approval');
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

// Approve (Admin/Finance Approver — cannot approve own)
router.post('/:id/approve', requireRole('Admin', 'Finance Approver'), upload.single('receipt'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Receipt file is required to approve a withdrawal' });
    }

    // Look up the withdrawal to get the expected amount
    const request = await withdrawalService.getRequestById(req.params.id);
    const expectedAmount = Number(request.amount);

    // Look up names for n8n verification context
    // Sender = the admin approving (they are sending/transferring the money)
    // Receiver = the requester (they are receiving the payout)
    const [approver, requester] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true, paymentUsername: true } }),
      prisma.user.findUnique({ where: { id: request.userId }, select: { firstName: true, lastName: true, paymentUsername: true } }),
    ]);
    // Use paymentUsername if set (their actual payment app name), otherwise fall back to dashboard name
    const senderName = approver?.paymentUsername || (approver ? `${approver.firstName} ${approver.lastName}` : '');
    const receiverName = requester?.paymentUsername || (requester ? `${requester.firstName} ${requester.lastName}` : '');

    // Run AI verification on the receipt via n8n webhook
    const verification = await receiptVerifier.verifyReceipt(
      req.file.path,
      req.file.mimetype,
      expectedAmount,
      senderName,
      receiverName
    );

    // Check for verification failure
    if (verification.rejection_reason) {
      // Clean up the uploaded file on rejection
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: verification.rejection_reason,
        verification,
      });
    }

    // Check for duplicate transaction ID reuse
    if (verification.transaction_id) {
      const existing = await prisma.withdrawalRequest.findUnique({
        where: { transactionId: verification.transaction_id },
      });
      if (existing && existing.id !== req.params.id) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({
          success: false,
          message: `This receipt has already been used for another withdrawal (Transaction ID: ${verification.transaction_id}). Each withdrawal requires a unique receipt.`,
          verification,
        });
      }
    }

    // All checks passed — approve with verified data
    const result = await withdrawalService.approveRequest(
      req.params.id,
      req.user.id,
      req.file,
      verification.extracted_amount,
      verification.transaction_id
    );
    success(res, result, 'Withdrawal approved and funds deducted');
  } catch (err) {
    // Clean up uploaded file if anything fails
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    next(err);
  }
});

// Reject (Admin/Finance Approver — cannot reject own)
router.post('/:id/reject', requireRole('Admin', 'Finance Approver'), async (req, res, next) => {
  try {
    const result = await withdrawalService.rejectRequest(req.params.id, req.user.id, req.body.reason);
    success(res, result, 'Withdrawal rejected');
  } catch (err) { next(err); }
});

// Delete own request (only PENDING or REJECTED — not APPROVED)
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await withdrawalService.deleteRequest(req.params.id, req.user.id);
    success(res, result, 'Withdrawal request deleted');
  } catch (err) { next(err); }
});

// Download receipt
router.get('/:id/receipt', async (req, res, next) => {
  try {
    const request = await withdrawalService.getRequestById(req.params.id);
    
    // Access control: Only Admins, Finance Approvers, or the exact requester can view the receipt
    const isAdmin = req.user.roles.includes('Admin') || req.user.roles.includes('Finance Approver');
    if (!isAdmin && request.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    if (!request.receiptPath || !fs.existsSync(request.receiptPath)) {
      return res.status(404).json({ success: false, message: 'Receipt not found on server' });
    }

    res.download(request.receiptPath, request.receiptFileName || 'receipt');
  } catch (err) { next(err); }
});

module.exports = router;
