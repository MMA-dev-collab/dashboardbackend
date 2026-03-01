const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const { auditLog } = require('../../middleware/auditLog');
const prisma = require('../../config/database');
const { success, created, paginated } = require('../../utils/response');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const Joi = require('joi');
const { validate } = require('../../middleware/validate');

const router = Router();
router.use(authenticate);
router.use(auditLog('decisions'));

// ==========================================
// DECISION LOG
// ==========================================

const decisionSchema = Joi.object({
  title: Joi.string().min(3).max(300).required().trim(),
  description: Joi.string().min(5).required(),
  context: Joi.string().optional().allow(null, ''),
  outcome: Joi.string().optional().allow(null, ''),
});

router.get('/decisions', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const [decisions, total] = await Promise.all([
      prisma.decisionLog.findMany({
        skip, take: limit,
        include: { author: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.decisionLog.count(),
    ]);
    paginated(res, decisions, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

router.post('/decisions', validate(decisionSchema), async (req, res, next) => {
  try {
    const decision = await prisma.decisionLog.create({
      data: { ...req.body, authorId: req.user.id },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
    created(res, decision, 'Decision logged');
  } catch (err) { next(err); }
});

router.delete('/decisions/:id', async (req, res, next) => {
  try {
    await prisma.decisionLog.delete({ where: { id: req.params.id } });
    success(res, null, 'Decision deleted');
  } catch (err) { next(err); }
});

// ==========================================
// RISK FLAGS
// ==========================================

const riskSchema = Joi.object({
  projectId: Joi.string().uuid().optional().allow(null),
  type: Joi.string().valid('LATE_PAYMENT', 'SCOPE_CREEP', 'BUDGET_OVERRUN', 'RESOURCE_ISSUE', 'TECHNICAL_DEBT', 'CLIENT_ISSUE', 'OTHER').required(),
  severity: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'CRITICAL').default('MEDIUM'),
  title: Joi.string().min(3).max(300).required().trim(),
  description: Joi.string().optional().allow(null, ''),
});

router.get('/risks', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = {};
    if (req.query.severity) where.severity = req.query.severity;
    if (req.query.projectId) where.projectId = req.query.projectId;
    if (req.query.resolved === 'true') where.isResolved = true;
    else if (req.query.resolved === 'false') where.isResolved = false;

    const [risks, total] = await Promise.all([
      prisma.riskFlag.findMany({
        where, skip, take: limit,
        include: {
          project: { select: { id: true, name: true } },
          reporter: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.riskFlag.count({ where }),
    ]);
    paginated(res, risks, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

router.post('/risks', validate(riskSchema), async (req, res, next) => {
  try {
    const risk = await prisma.riskFlag.create({
      data: { ...req.body, reportedBy: req.user.id },
      include: {
        project: { select: { id: true, name: true } },
        reporter: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    created(res, risk, 'Risk flag raised');
  } catch (err) { next(err); }
});

router.patch('/risks/:id/resolve', async (req, res, next) => {
  try {
    const risk = await prisma.riskFlag.update({
      where: { id: req.params.id },
      data: { isResolved: true },
    });
    success(res, risk, 'Risk resolved');
  } catch (err) { next(err); }
});

router.delete('/risks/:id', async (req, res, next) => {
  try {
    await prisma.riskFlag.delete({ where: { id: req.params.id } });
    success(res, null, 'Risk deleted');
  } catch (err) { next(err); }
});

module.exports = router;
