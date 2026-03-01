const financeService = require('./finance.service');
const { success, created } = require('../../utils/response');

class FinanceController {
  async recordPayment(req, res, next) {
    try {
      const { amount, method, note } = req.body;
      const result = await financeService.recordPayment(req.params.projectId, amount, method, note);
      created(res, result, 'Payment recorded successfully');
    } catch (err) { next(err); }
  }

  async getOverview(req, res, next) {
    try {
      const overview = await financeService.getOverview();
      success(res, overview);
    } catch (err) { next(err); }
  }

  async getProjectFinance(req, res, next) {
    try {
      const finance = await financeService.getProjectFinance(req.params.projectId);
      success(res, finance);
    } catch (err) { next(err); }
  }
}

module.exports = new FinanceController();
