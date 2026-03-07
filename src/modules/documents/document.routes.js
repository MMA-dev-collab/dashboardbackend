const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const { auditLog } = require('../../middleware/auditLog');
const prisma = require('../../config/database');
const { success, created, paginated } = require('../../utils/response');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const multer = require('multer');
const { cloudinary, createCloudinaryStorage, getSignedUrl } = require('../../config/cloudinary');

const router = Router();
router.use(authenticate);
router.use(auditLog('documents'));

// Configure multer with Cloudinary storage
const storage = createCloudinaryStorage('egycodera/documents', [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'png', 'jpg', 'jpeg', 'gif', 'zip', 'txt', 'csv', 'md',
]);

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
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
        filePath: req.file.path,       // Cloudinary URL
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

// Download document — proxy from Cloudinary to avoid CORS issues
router.get('/:id/download', async (req, res, next) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
    if (!doc.filePath) return res.status(404).json({ success: false, message: 'File not available' });

    const originalUrl = doc.filePath;
    const signedUrl = getSignedUrl(originalUrl);

    // ADD THIS TEMPORARILY
    console.log('=== CLOUDINARY DEBUG ===');
    console.log('Original URL:', originalUrl);
    console.log('Signed URL:', signedUrl);
    console.log('Resource type detected:', originalUrl.includes('/raw/') ? 'raw' : 'image');

    const cloudResponse = await fetch(signedUrl);
    console.log('Cloudinary response status:', cloudResponse.status);
    console.log('Cloudinary response headers:', Object.fromEntries(cloudResponse.headers));
    // END DEBUG

    if (!cloudResponse.ok) {
      const errorText = await cloudResponse.text();
      console.error('[Download] Error body:', errorText.substring(0, 500));
      return res.status(502).json({ success: false, message: 'Failed to fetch file from storage' });
    }

    const buffer = Buffer.from(await cloudResponse.arrayBuffer());
    res.set('Content-Type', doc.mimeType || cloudResponse.headers.get('content-type') || 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.fileName)}"`);
    res.set('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) { next(err); }
});

// Delete document
router.delete('/:id', async (req, res, next) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    // Remove from Cloudinary if possible
    if (doc.filePath) {
      try {
        const parts = doc.filePath.split('/');
        const uploadIdx = parts.indexOf('upload');
        if (uploadIdx !== -1) {
          const publicIdWithExt = parts.slice(uploadIdx + 2).join('/');
          const publicId = publicIdWithExt.replace(/\.[^/.]+$/, '');
          await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
        }
      } catch (cloudErr) {
        console.warn('Could not delete file from Cloudinary:', cloudErr.message);
      }
    }

    await prisma.document.delete({ where: { id: req.params.id } });
    success(res, null, 'Document deleted');
  } catch (err) { next(err); }
});

module.exports = router;
