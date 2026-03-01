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
router.use(auditLog('expenses'));

const expenseSchema = Joi.object({
  projectId: Joi.string().uuid().optional().allow(null),
  category: Joi.string().valid('SOFTWARE', 'HARDWARE', 'HOSTING', 'MARKETING', 'SALARY', 'OFFICE', 'TRAVEL', 'OTHER').default('OTHER'),
  description: Joi.string().min(3).max(1000).required().trim(),
  amount: Joi.number().positive().precision(2).required(),
  date: Joi.date().optional(),
});

// List expenses
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = {};
    if (req.query.projectId) where.projectId = req.query.projectId;
    if (req.query.category) where.category = req.query.category;

    const [expenses, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        skip,
        take: limit,
        include: {
          project: { select: { id: true, name: true } },
          user: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { date: 'desc' },
      }),
      prisma.expense.count({ where }),
    ]);

    paginated(res, expenses, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// Create expense
router.post('/', validate(expenseSchema), async (req, res, next) => {
  try {
    const expense = await prisma.expense.create({
      data: { ...req.body, userId: req.user.id },
      include: {
        project: { select: { id: true, name: true } },
      },
    });
    created(res, expense, 'Expense recorded');
  } catch (err) { next(err); }
});

// Update expense
router.put('/:id', async (req, res, next) => {
  try {
    const expense = await prisma.expense.update({
      where: { id: req.params.id },
      data: req.body,
    });
    success(res, expense, 'Expense updated');
  } catch (err) { next(err); }
});

// Delete expense
router.delete('/:id', requireRole('Admin'), async (req, res, next) => {
  try {
    await prisma.expense.delete({ where: { id: req.params.id } });
    success(res, null, 'Expense deleted');
  } catch (err) { next(err); }
});

module.exports = router;
