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
router.use(auditLog('knowledge'));

const articleSchema = Joi.object({
  title: Joi.string().min(1).max(300).required().trim(),
  content: Joi.string().min(1).required(),
  category: Joi.string().max(100).optional().allow(null, '').default('general'),
  tags: Joi.string().max(500).optional().allow(null, ''),
});

// List articles
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = {};
    if (req.query.category) where.category = req.query.category;
    if (req.query.search) {
      where.OR = [
        { title: { contains: req.query.search } },
        { content: { contains: req.query.search } },
      ];
    }

    const [articles, total] = await Promise.all([
      prisma.knowledgeArticle.findMany({
        where,
        skip,
        take: limit,
        include: {
          author: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.knowledgeArticle.count({ where }),
    ]);

    paginated(res, articles, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// Get single article
router.get('/:id', async (req, res, next) => {
  try {
    const article = await prisma.knowledgeArticle.findUnique({
      where: { id: req.params.id },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!article) return res.status(404).json({ success: false, message: 'Article not found' });
    success(res, article);
  } catch (err) { next(err); }
});

// Create article
router.post('/', validate(articleSchema), async (req, res, next) => {
  try {
    const article = await prisma.knowledgeArticle.create({
      data: { ...req.body, authorId: req.user.id },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
    created(res, article, 'Article published');
  } catch (err) { next(err); }
});

// Update article
router.put('/:id', async (req, res, next) => {
  try {
    const article = await prisma.knowledgeArticle.update({
      where: { id: req.params.id },
      data: req.body,
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });
    success(res, article, 'Article updated');
  } catch (err) { next(err); }
});

// Delete article
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.knowledgeArticle.delete({ where: { id: req.params.id } });
    success(res, null, 'Article deleted');
  } catch (err) { next(err); }
});

module.exports = router;
