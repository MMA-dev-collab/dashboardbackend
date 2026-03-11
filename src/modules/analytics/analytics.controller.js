const analyticsService = require('./analytics.service');

class AnalyticsController {
  /**
   * Get Revenue Trends
   * GET /api/analytics/revenue
   */
  async getRevenueTrends(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const data = await analyticsService.getRevenueTrends(startDate, endDate);
      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Project Performance
   * GET /api/analytics/projects
   */
  async getProjectPerformance(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const data = await analyticsService.getProjectPerformance(startDate, endDate);
      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get Team Workload
   * GET /api/analytics/workload
   */
  async getTeamWorkload(req, res, next) {
    try {
      const data = await analyticsService.getTeamWorkload();
      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AnalyticsController();
