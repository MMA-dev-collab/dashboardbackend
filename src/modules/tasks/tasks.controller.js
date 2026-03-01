const tasksService = require('./tasks.service');
const { success, created } = require('../../utils/response');

class TasksController {
  async listTasks(req, res, next) {
    try {
      const { projectId } = req.params;
      const { sprintId, search } = req.query;
      const tasks = await tasksService.list(projectId, { sprintId, search });
      success(res, tasks);
    } catch (err) { next(err); }
  }

  async createTask(req, res, next) {
    try {
      const { projectId } = req.params;
      const data = { ...req.body, projectId, reporterId: req.user.id };
      const task = await tasksService.create(data);
      created(res, task, 'Task created successfully');
    } catch (err) { next(err); }
  }

  async getTask(req, res, next) {
    try {
      const task = await tasksService.getById(req.params.taskId);
      success(res, task);
    } catch (err) { next(err); }
  }

  async updateTask(req, res, next) {
    try {
      // Inject the current user into the body so the service knows who triggered the update
      const data = { ...req.body, updatedById: req.user.id };
      const task = await tasksService.update(req.params.taskId, data);
      success(res, task, 'Task updated successfully');
    } catch (err) { next(err); }
  }

  async deleteTask(req, res, next) {
    try {
      await tasksService.delete(req.params.taskId);
      success(res, null, 'Task archived successfully');
    } catch (err) { next(err); }
  }

  async moveTask(req, res, next) {
    try {
      const { toColumnId, version } = req.body;
      const task = await tasksService.moveTask(req.params.taskId, toColumnId, req.user.id, version);
      success(res, task, 'Task moved successfully');
    } catch (err) { next(err); }
  }

  async addComment(req, res, next) {
    try {
      const { body, mentions } = req.body;
      const comment = await tasksService.addComment(req.params.taskId, req.user.id, body, mentions);
      created(res, comment, 'Comment added');
    } catch (err) { next(err); }
  }

  async uploadAttachment(req, res, next) {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
      const fileData = {
        fileName: req.file.originalname,
        url: req.file.path
      };
      const attachment = await tasksService.addAttachment(req.params.taskId, req.user.id, fileData);
      created(res, attachment, 'Attachment uploaded');
    } catch (err) { next(err); }
  }

  async downloadAttachment(req, res, next) {
    try {
      const fs = require('fs');
      const attachment = await tasksService.getAttachment(req.params.attachmentId);
      if (!attachment) return res.status(404).json({ success: false, message: 'Attachment not found' });
      if (!fs.existsSync(attachment.url)) return res.status(404).json({ success: false, message: 'File missing' });
      res.download(attachment.url, attachment.fileName);
    } catch (err) { next(err); }
  }
}

module.exports = new TasksController();
