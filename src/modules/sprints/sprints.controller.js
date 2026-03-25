const sprintsService = require('./sprints.service');
const { success, created } = require('../../utils/response');

class SprintsController {
  async listSprints(req, res, next) {
    try {
      const sprints = await sprintsService.list(req.params.projectId);
      success(res, sprints);
    } catch (err) { next(err); }
  }

  async createSprint(req, res, next) {
    try {
      const data = { ...req.body, projectId: req.params.projectId };
      const sprint = await sprintsService.create(data);
      created(res, sprint, 'Sprint created');
    } catch (err) { next(err); }
  }

  async updateSprint(req, res, next) {
    try {
      const sprint = await sprintsService.update(req.params.sprintId, req.body);
      success(res, sprint, 'Sprint updated');
    } catch (err) { next(err); }
  }

  async startSprint(req, res, next) {
    try {
      const sprint = await sprintsService.updateStatus(req.params.sprintId, 'ACTIVE');
      success(res, sprint, 'Sprint started');
    } catch (err) { next(err); }
  }

  async completeSprint(req, res, next) {
    try {
      const sprint = await sprintsService.updateStatus(req.params.sprintId, 'COMPLETED');
      success(res, sprint, 'Sprint completed');
    } catch (err) { next(err); }
  }

  async reopenSprint(req, res, next) {
    try {
      const sprint = await sprintsService.updateStatus(req.params.sprintId, 'ACTIVE');
      success(res, sprint, 'Sprint reopened');
    } catch (err) { next(err); }
  }

  async getSprintMetrics(req, res, next) {
    try {
      const metrics = await sprintsService.getMetrics(req.params.sprintId);
      success(res, metrics);
    } catch (err) { next(err); }
  }

  async assignMembers(req, res, next) {
    try {
      const members = await sprintsService.assignMembers(req.params.sprintId, req.body.members);
      success(res, members, 'Sprint team updated');
    } catch (err) { next(err); }
  }
}

module.exports = new SprintsController();
