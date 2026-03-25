const tagsService = require('./tags.service');
const { success, created } = require('../../utils/response');

class TagsController {
  async listByProject(req, res, next) {
    try {
      const tags = await tagsService.listByProject(req.params.projectId);
      success(res, tags);
    } catch (err) { next(err); }
  }

  async createTag(req, res, next) {
    try {
      const tag = await tagsService.createTag(req.params.projectId, req.body);
      created(res, tag, 'Tag created');
    } catch (err) { next(err); }
  }

  async deleteTag(req, res, next) {
    try {
      await tagsService.deleteTag(req.params.tagId);
      success(res, null, 'Tag deleted');
    } catch (err) { next(err); }
  }

  async assignTagToTask(req, res, next) {
    try {
      const result = await tagsService.assignTagToTask(req.params.taskId, req.body.tagId);
      created(res, result, 'Tag assigned');
    } catch (err) { next(err); }
  }

  async removeTagFromTask(req, res, next) {
    try {
      await tagsService.removeTagFromTask(req.params.taskId, req.params.tagId);
      success(res, null, 'Tag removed');
    } catch (err) { next(err); }
  }
}

module.exports = new TagsController();
