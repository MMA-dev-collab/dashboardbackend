const automationService = require('./automations.service');

class AutomationController {
  async getRules(req, res, next) {
    try {
      const rules = await automationService.getRules();
      res.json({ success: true, data: rules });
    } catch (error) {
      next(error);
    }
  }

  async createRule(req, res, next) {
    try {
      const rule = await automationService.createRule(req.user.id, req.body);
      res.status(201).json({ success: true, data: rule });
    } catch (error) {
      next(error);
    }
  }

  async updateRule(req, res, next) {
    try {
      const { id } = req.params;
      const rule = await automationService.updateRule(id, req.body);
      res.json({ success: true, data: rule });
    } catch (error) {
      next(error);
    }
  }

  async deleteRule(req, res, next) {
    try {
      const { id } = req.params;
      await automationService.deleteRule(id);
      res.json({ success: true, message: 'Rule deleted successfully' });
    } catch (error) {
      next(error);
    }
  }

  async getRuleLogs(req, res, next) {
    try {
      const { id } = req.params;
      const logs = await automationService.getRuleLogs(id);
      res.json({ success: true, data: logs });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AutomationController();
