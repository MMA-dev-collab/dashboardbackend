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
router.use(auditLog('crm'));

const leadSchema = Joi.object({
  companyName: Joi.string().min(2).max(200).required().trim(),
  contactName: Joi.string().min(2).max(200).required().trim(),
  email: Joi.string().email().optional().allow('').trim(),
  phone: Joi.string().max(20).optional().allow('').trim(),
  source: Joi.string().max(100).optional().trim(),
  stage: Joi.string().valid('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON', 'LOST').default('NEW'),
  expectedValue: Joi.number().min(0).precision(2).optional(),
  notes: Joi.string().max(5000).optional().allow('').trim(),
  assignedTo: Joi.string().uuid().optional().allow(null),
});

// List leads
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = {};
    if (req.query.stage) where.stage = req.query.stage;
    if (req.query.search) {
      where.OR = [
        { companyName: { contains: req.query.search } },
        { contactName: { contains: req.query.search } },
      ];
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip,
        take: limit,
        include: {
          assignee: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { proposals: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.lead.count({ where }),
    ]);

    paginated(res, leads, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// Get lead by ID
router.get('/:id', async (req, res, next) => {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true } },
        proposals: true,
      },
    });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
    success(res, lead);
  } catch (err) { next(err); }
});

// Create lead
router.post('/', validate(leadSchema), async (req, res, next) => {
  try {
    const lead = await prisma.lead.create({ data: req.body });
    created(res, lead, 'Lead created');
  } catch (err) { next(err); }
});

// Update lead
router.put('/:id', async (req, res, next) => {
  try {
    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: req.body,
    });
    success(res, lead, 'Lead updated');
  } catch (err) { next(err); }
});

// Convert lead to project
router.post('/:id/convert', requireRole('Admin', 'Partner'), async (req, res, next) => {
  try {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    const result = await prisma.$transaction(async (tx) => {
      // Create project from lead
      const project = await tx.project.create({
        data: {
          name: lead.companyName + ' Project',
          clientName: lead.contactName,
          clientEmail: lead.email,
          totalValue: lead.expectedValue || 0,
          description: lead.notes,
        },
      });

      // Update lead stage
      await tx.lead.update({
        where: { id: lead.id },
        data: { stage: 'WON' },
      });

      return project;
    });

    created(res, result, 'Lead converted to project');
  } catch (err) { next(err); }
});

// Delete lead
router.delete('/:id', requireRole('Admin'), async (req, res, next) => {
  try {
    await prisma.lead.delete({ where: { id: req.params.id } });
    success(res, null, 'Lead deleted');
  } catch (err) { next(err); }
});

module.exports = router;
