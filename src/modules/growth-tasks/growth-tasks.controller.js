const tasksService = require('./growth-tasks.service');
const { success, created } = require('../../utils/response');

class GrowthTasksController {
  async list(req, res, next) {
    try {
      const result = await tasksService.list(req.user.id, req.query);
      success(res, result.data, 'Tasks fetched').json({ success: true, data: result.data, pagination: result.pagination });
    } catch (err) { next(err); }
  }

  async getToday(req, res, next) {
    try {
      const result = await tasksService.getTodayTasks(req.user.id);
      success(res, result);
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const task = await tasksService.getById(req.params.id, req.user.id);
      success(res, task);
    } catch (err) { next(err); }
  }

  async create(req, res, next) {
    try {
      const task = await tasksService.create(req.user.id, req.body);
      created(res, task, 'Task created');
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const task = await tasksService.update(req.params.id, req.user.id, req.body);
      success(res, task, 'Task updated');
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await tasksService.delete(req.params.id, req.user.id);
      success(res, null, 'Task deleted');
    } catch (err) { next(err); }
  }

  async startTask(req, res, next) {
    try {
      const task = await tasksService.startTask(req.params.id, req.user.id);
      success(res, task, 'Task started');
    } catch (err) { next(err); }
  }

  async completeTask(req, res, next) {
    try {
      const result = await tasksService.completeTask(req.params.id, req.user.id);
      success(res, result, 'Task completed');
    } catch (err) { next(err); }
  }

  async carryOver(req, res, next) {
    try {
      const result = await tasksService.runCarryOver();
      success(res, result, 'Carry-over processed');
    } catch (err) { next(err); }
  }
}

module.exports = new GrowthTasksController();
