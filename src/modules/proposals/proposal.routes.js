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
router.use(auditLog('proposals'));

const proposalSchema = Joi.object({
  leadId: Joi.string().uuid().optional().allow(null),
  projectId: Joi.string().uuid().optional().allow(null),
  title: Joi.string().min(3).max(200).required().trim(),
  clientName: Joi.string().min(2).max(200).required().trim(),
  totalAmount: Joi.number().min(0).precision(2).default(0),
  validUntil: Joi.date().optional().allow(null),
  content: Joi.object().optional().allow(null),
});

// List proposals
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = {};
    if (req.query.status) where.status = req.query.status;

    const [proposals, total] = await Promise.all([
      prisma.proposal.findMany({
        where,
        skip,
        take: limit,
        include: {
          lead: { select: { id: true, companyName: true } },
          project: { select: { id: true, name: true } },
          creator: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.proposal.count({ where }),
    ]);

    paginated(res, proposals, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// Get single proposal
router.get('/:id', async (req, res, next) => {
  try {
    const proposal = await prisma.proposal.findUnique({
      where: { id: req.params.id },
      include: {
        lead: { select: { id: true, companyName: true, contactName: true, email: true } },
        project: { select: { id: true, name: true } },
        creator: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!proposal) return res.status(404).json({ success: false, message: 'Proposal not found' });
    success(res, proposal);
  } catch (err) { next(err); }
});

// Create proposal
router.post('/', validate(proposalSchema), async (req, res, next) => {
  try {
    const proposal = await prisma.proposal.create({
      data: { ...req.body, createdBy: req.user.id },
      include: {
        lead: { select: { id: true, companyName: true } },
        creator: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    created(res, proposal, 'Proposal created');
  } catch (err) { next(err); }
});

// Update proposal
router.put('/:id', async (req, res, next) => {
  try {
    const proposal = await prisma.proposal.update({
      where: { id: req.params.id },
      data: req.body,
      include: {
        lead: { select: { id: true, companyName: true } },
        creator: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    success(res, proposal, 'Proposal updated');
  } catch (err) { next(err); }
});

// Update proposal status
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const data = { status };
    if (status === 'SENT') data.sentAt = new Date();
    if (status === 'ACCEPTED') data.acceptedAt = new Date();

    const proposal = await prisma.proposal.update({
      where: { id: req.params.id },
      data,
    });
    success(res, proposal, `Proposal marked as ${status}`);
  } catch (err) { next(err); }
});

// Delete proposal
router.delete('/:id', requireRole('Admin'), async (req, res, next) => {
  try {
    await prisma.proposal.delete({ where: { id: req.params.id } });
    success(res, null, 'Proposal deleted');
  } catch (err) { next(err); }
});

module.exports = router;
