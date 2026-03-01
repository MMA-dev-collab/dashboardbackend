const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');
const prisma = require('../../config/database');
const { success, paginated } = require('../../utils/response');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');

const router = Router();
router.use(authenticate);
router.use(requireRole('Admin'));

// List audit logs
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = {};
    if (req.query.module) where.module = req.query.module;
    if (req.query.action) where.action = { contains: req.query.action };
    if (req.query.userId) where.userId = req.query.userId;
    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt.gte = new Date(req.query.from);
      if (req.query.to) where.createdAt.lte = new Date(req.query.to);
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count({ where }),
    ]);

    paginated(res, logs, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

module.exports = router;
