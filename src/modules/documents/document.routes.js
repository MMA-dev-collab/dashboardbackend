const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const { auditLog } = require('../../middleware/auditLog');
const prisma = require('../../config/database');
const { success, created, paginated } = require('../../utils/response');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = Router();
router.use(authenticate);
router.use(auditLog('documents'));

// Configure multer for local file storage (swap to S3 later)
const uploadsDir = path.join(__dirname, '../../../uploads');
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
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.txt', '.csv', '.md'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('File type not allowed'));
  },
});

// List documents
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const where = {};
    if (req.query.projectId) where.projectId = req.query.projectId;
    if (req.query.category) where.category = req.query.category;

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        skip,
        take: limit,
        include: {
          project: { select: { id: true, name: true } },
          uploader: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.document.count({ where }),
    ]);

    paginated(res, documents, buildPaginationMeta(total, page, limit));
  } catch (err) { next(err); }
});

// Upload document
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const document = await prisma.document.create({
      data: {
        fileName: req.file.originalname,
        filePath: req.file.path,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        category: req.body.category || 'general',
        description: req.body.description || null,
        projectId: req.body.projectId || null,
        uploadedBy: req.user.id,
      },
      include: {
        project: { select: { id: true, name: true } },
        uploader: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    created(res, document, 'Document uploaded');
  } catch (err) { next(err); }
});

// Download document
router.get('/:id/download', async (req, res, next) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    if (!fs.existsSync(doc.filePath)) return res.status(404).json({ success: false, message: 'File missing from server' });
    res.download(doc.filePath, doc.fileName);
  } catch (err) { next(err); }
});

// Delete document
router.delete('/:id', async (req, res, next) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    // Remove physical file
    if (fs.existsSync(doc.filePath)) fs.unlinkSync(doc.filePath);
    await prisma.document.delete({ where: { id: req.params.id } });
    success(res, null, 'Document deleted');
  } catch (err) { next(err); }
});

module.exports = router;
