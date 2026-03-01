const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');
const prisma = require('../../config/database');
const { success, paginated } = require('../../utils/response');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');

const router = Router();
router.use(authenticate);

// Get my wallet
router.get('/me', async (req, res, next) => {
  try {
    let wallet = await prisma.wallet.findUnique({
      where: { userId: req.user.id },
    });

    if (!wallet) {
      wallet = await prisma.wallet.create({ data: { userId: req.user.id } });
    }

    success(res, wallet);
  } catch (err) { next(err); }
});

// Get all wallets (Admin only)
router.get('/', requireRole('Admin', 'Finance Approver'), async (req, res, next) => {
  try {
    const wallets = await prisma.wallet.findMany({
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    success(res, wallets);
  } catch (err) { next(err); }
});

// Get wallet by user ID (Admin or self)
router.get('/:userId', async (req, res, next) => {
  try {
    if (req.params.userId !== req.user.id && !req.user.roles.includes('Admin')) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.params.userId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!wallet) return res.status(404).json({ success: false, message: 'Wallet not found' });
    success(res, wallet);
  } catch (err) { next(err); }
});

// Get wallet transactions
router.get('/:userId/transactions', async (req, res, next) => {
  try {
    if (req.params.userId !== req.user.id && !req.user.roles.includes('Admin')) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId: req.params.userId } });
    if (!wallet) return paginated(res, [], buildPaginationMeta(0, 1, 10));

    const { page, limit, skip } = parsePagination(req.query);
    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
    ]);

    paginated(res, transactions, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

module.exports = router;
