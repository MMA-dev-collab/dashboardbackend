const reportsService = require('./reports.service');

class ReportsController {
  async getTaskSummary(req, res, next) {
    try {
      const range = parseInt(req.query.range) || 30;
      const data = await reportsService.getTaskSummary(range);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  async getWorkload(req, res, next) {
    try {
      const data = await reportsService.getWorkload();
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  async getProjectComparison(req, res, next) {
    try {
      const data = await reportsService.getProjectComparison();
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  async getActiveWorkSummary(req, res, next) {
    try {
      const data = await reportsService.getActiveWorkSummary();
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }
}

module.exports = new ReportsController();
