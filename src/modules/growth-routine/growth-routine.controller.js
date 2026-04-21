const routineService = require('./growth-routine.service');
const { success } = require('../../utils/response');

class GrowthRoutineController {
  async getStatus(req, res, next) {
    try {
      const data = await routineService.getStatus(req.user.id);
      success(res, data);
    } catch (err) { next(err); }
  }

  async checkin(req, res, next) {
    try {
      const data = await routineService.checkin(req.user.id, req.body.type);
      success(res, data, req.body.type === 'SLEEP' ? 'Sleep check-in recorded' : 'Wake check-in recorded');
    } catch (err) { next(err); }
  }
}

module.exports = new GrowthRoutineController();
