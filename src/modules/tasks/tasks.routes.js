const { Router } = require('express');
const tasksController = require('./tasks.controller');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = Router({ mergeParams: true }); // Allows accessing /projects/:projectId/tasks

// Configure multer for local file storage (swap to S3 later)
const uploadsDir = path.join(__dirname, '../../../uploads/tasks');
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
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit for task attachments
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.txt', '.csv', '.md'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('File type not allowed'));
  },
});

router.use(authenticate);

// Task CRUD
router.get('/', tasksController.listTasks);
router.post('/', requireRole('Admin', 'Partner'), tasksController.createTask);
router.get('/:taskId', tasksController.getTask);
router.put('/:taskId', requireRole('Admin', 'Partner'), tasksController.updateTask);
router.delete('/:taskId', requireRole('Admin'), tasksController.deleteTask);

// Agile Actions
router.patch('/:taskId/move', tasksController.moveTask);
router.post('/:taskId/comments', tasksController.addComment);

// Attachments
router.post('/:taskId/attachments', upload.single('file'), tasksController.uploadAttachment);
router.get('/:taskId/attachments/:attachmentId/download', tasksController.downloadAttachment);

module.exports = router;
