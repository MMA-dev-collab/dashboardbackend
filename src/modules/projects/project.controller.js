const projectService = require('./project.service');
const { success, created, paginated } = require('../../utils/response');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');

class ProjectController {
  async list(req, res, next) {
    try {
      const pagination = parsePagination(req.query);
      const filters = {
        status: req.query.status,
        paymentStatus: req.query.paymentStatus,
        search: req.query.search,
      };
      const { projects, total } = await projectService.list(filters, pagination);
      paginated(res, projects, buildPaginationMeta(total, pagination.page, pagination.limit));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const project = await projectService.getById(req.params.id);
      success(res, project);
    } catch (err) { next(err); }
  }

  async create(req, res, next) {
    try {
      const project = await projectService.create(req.body);
      created(res, project, 'Project created successfully');
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const project = await projectService.update(req.params.id, req.body);
      success(res, project, 'Project updated successfully');
    } catch (err) { next(err); }
  }

  async assignPartners(req, res, next) {
    try {
      const project = await projectService.assignPartners(req.params.id, req.body.partners);
      success(res, project, 'Partners assigned successfully');
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await projectService.delete(req.params.id);
      success(res, null, 'Project deleted successfully');
    } catch (err) { next(err); }
  }

  async addMilestone(req, res, next) {
    try {
      const milestone = await projectService.addMilestone(req.params.id, req.body);
      created(res, milestone, 'Milestone added');
    } catch (err) { next(err); }
  }

  async updateMilestone(req, res, next) {
    try {
      const milestone = await projectService.updateMilestone(req.params.milestoneId, req.body);
      success(res, milestone, 'Milestone updated');
    } catch (err) { next(err); }
  }
}

module.exports = new ProjectController();
