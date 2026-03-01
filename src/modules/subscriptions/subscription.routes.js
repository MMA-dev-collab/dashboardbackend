const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/auditLog');
const prisma = require('../../config/database');
const { success, created, paginated } = require('../../utils/response');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const Joi = require('joi');
const { validate } = require('../../middleware/validate');

const router = Router();
router.use(authenticate);
router.use(auditLog('subscriptions'));

const subscriptionSchema = Joi.object({
  clientName: Joi.string().min(2).max(200).required().trim(),
  serviceName: Joi.string().min(2).max(200).required().trim(),
  projectId: Joi.string().uuid().optional().allow(null),
  amount: Joi.number().positive().precision(2).required(),
  frequency: Joi.string().valid('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY').default('MONTHLY'),
  startDate: Joi.date().required(),
  nextRenewal: Joi.date().required(),
});

// List subscriptions
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = {};
    if (req.query.status) where.status = req.query.status;

    const [subscriptions, total] = await Promise.all([
      prisma.subscription.findMany({
        where,
        skip,
        take: limit,
        include: {
          project: { select: { id: true, name: true } },
          _count: { select: { invoices: true } },
        },
        orderBy: { nextRenewal: 'asc' },
      }),
      prisma.subscription.count({ where }),
    ]);

    paginated(res, subscriptions, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// Get single subscription with invoices
router.get('/:id', async (req, res, next) => {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { id: req.params.id },
      include: {
        project: { select: { id: true, name: true } },
        invoices: { orderBy: { issueDate: 'desc' }, take: 20 },
      },
    });
    if (!subscription) return res.status(404).json({ success: false, message: 'Subscription not found' });
    success(res, subscription);
  } catch (err) { next(err); }
});

// Create subscription
router.post('/', requireRole('Admin'), validate(subscriptionSchema), async (req, res, next) => {
  try {
    const subscription = await prisma.subscription.create({
      data: req.body,
      include: { project: { select: { id: true, name: true } } },
    });
    created(res, subscription, 'Subscription created');
  } catch (err) { next(err); }
});

// Update subscription
router.put('/:id', requireRole('Admin'), async (req, res, next) => {
  try {
    const subscription = await prisma.subscription.update({
      where: { id: req.params.id },
      data: req.body,
    });
    success(res, subscription, 'Subscription updated');
  } catch (err) { next(err); }
});

// Update subscription status (pause / cancel / reactivate)
router.patch('/:id/status', requireRole('Admin'), async (req, res, next) => {
  try {
    const { status } = req.body;
    const subscription = await prisma.subscription.update({
      where: { id: req.params.id },
      data: { status },
    });
    success(res, subscription, `Subscription ${status.toLowerCase()}`);
  } catch (err) { next(err); }
});

// Generate invoice for a subscription
router.post('/:id/invoices', requireRole('Admin'), async (req, res, next) => {
  try {
    const sub = await prisma.subscription.findUnique({ where: { id: req.params.id } });
    if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    const invoice = await prisma.subscriptionInvoice.create({
      data: {
        subscriptionId: sub.id,
        amount: sub.amount,
        dueDate,
      },
    });
    created(res, invoice, 'Invoice generated');
  } catch (err) { next(err); }
});

// Mark invoice as paid
router.patch('/invoices/:invoiceId/pay', requireRole('Admin'), async (req, res, next) => {
  try {
    const invoice = await prisma.subscriptionInvoice.update({
      where: { id: req.params.invoiceId },
      data: { status: 'PAID' },
    });
    success(res, invoice, 'Invoice marked as paid');
  } catch (err) { next(err); }
});

// Delete subscription
router.delete('/:id', requireRole('Admin'), async (req, res, next) => {
  try {
    await prisma.subscription.delete({ where: { id: req.params.id } });
    success(res, null, 'Subscription deleted');
  } catch (err) { next(err); }
});

module.exports = router;
