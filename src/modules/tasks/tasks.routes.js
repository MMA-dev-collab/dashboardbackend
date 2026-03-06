const { Router } = require('express');
const tasksController = require('./tasks.controller');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');
const multer = require('multer');
const { createCloudinaryStorage } = require('../../config/cloudinary');

const router = Router({ mergeParams: true });

// Configure multer with Cloudinary storage
const storage = createCloudinaryStorage('egycodera/tasks', [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'png', 'jpg', 'jpeg', 'gif', 'zip', 'txt', 'csv', 'md',
]);

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit for task attachments
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
