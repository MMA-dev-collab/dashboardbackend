const columnsService = require('./columns.service');
const { success, created } = require('../../utils/response');

class ColumnsController {
  async listColumns(req, res, next) {
    try {
      const columns = await columnsService.list(req.params.projectId);
      success(res, columns);
    } catch (err) { next(err); }
  }

  async createColumn(req, res, next) {
    try {
      const data = { ...req.body, projectId: req.params.projectId };
      const column = await columnsService.create(data);
      created(res, column, 'Column created');
    } catch (err) { next(err); }
  }

  async updateColumn(req, res, next) {
    try {
      const column = await columnsService.update(req.params.columnId, req.body);
      success(res, column, 'Column updated');
    } catch (err) { next(err); }
  }

  async deleteColumn(req, res, next) {
    try {
      await columnsService.delete(req.params.columnId);
      success(res, null, 'Column removed');
    } catch (err) { next(err); }
  }
}

module.exports = new ColumnsController();
