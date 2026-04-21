const scheduleService = require('./growth-schedule.service');
const { success, created } = require('../../utils/response');

class GrowthScheduleController {
  async list(req, res, next) {
    try {
      const schedules = await scheduleService.list(req.user.id, req.query.from, req.query.to);
      success(res, schedules);
    } catch (err) { next(err); }
  }

  async getByDate(req, res, next) {
    try {
      const schedule = await scheduleService.getByDate(req.user.id, req.params.date);
      success(res, schedule);
    } catch (err) { next(err); }
  }

  async createSchedule(req, res, next) {
    try {
      const schedule = await scheduleService.createSchedule(req.user.id, req.body.date);
      created(res, schedule, 'Schedule created');
    } catch (err) { next(err); }
  }

  async addBlock(req, res, next) {
    try {
      const block = await scheduleService.addBlock(req.params.id, req.user.id, req.body);
      created(res, block, 'Block added');
    } catch (err) { next(err); }
  }

  async updateBlock(req, res, next) {
    try {
      const block = await scheduleService.updateBlock(req.params.id, req.params.blockId, req.user.id, req.body);
      success(res, block, 'Block updated');
    } catch (err) { next(err); }
  }

  async removeBlock(req, res, next) {
    try {
      const result = await scheduleService.removeBlock(req.params.id, req.params.blockId, req.user.id);
      success(res, result, 'Block removed');
    } catch (err) { next(err); }
  }

  async getFreeTime(req, res, next) {
    try {
      const result = await scheduleService.calculateFreeTime(req.user.id, req.params.date);
      success(res, result);
    } catch (err) { next(err); }
  }

  async setGamingTime(req, res, next) {
    try {
      const schedule = await scheduleService.setGamingTime(req.user.id, req.params.date, req.body);
      success(res, schedule, 'Gaming time updated');
    } catch (err) { next(err); }
  }

  async getEffectiveGamingTime(req, res, next) {
    try {
      const result = await scheduleService.getEffectiveGamingMinutes(req.user.id, req.params.date);
      success(res, result);
    } catch (err) { next(err); }
  }

  async detectConflicts(req, res, next) {
    try {
      const result = await scheduleService.detectConflicts(req.user.id, req.body.scheduleId);
      success(res, result);
    } catch (err) { next(err); }
  }

  async optimize(req, res, next) {
    try {
      const result = await scheduleService.optimizeSchedule(req.user.id, req.body.date);
      success(res, result);
    } catch (err) { next(err); }
  }
}

module.exports = new GrowthScheduleController();
