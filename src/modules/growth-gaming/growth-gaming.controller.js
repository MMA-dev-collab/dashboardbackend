const gamingService = require('./growth-gaming.service');
const { success, created } = require('../../utils/response');

class GamingController {
  async getStatus(req, res, next) {
    try {
      const status = await gamingService.getGamingStatus(req.user.id);
      success(res, status);
    } catch (err) { next(err); }
  }

  async getLockStatus(req, res, next) {
    try {
      const lockStatus = await gamingService.getLockStatus(req.user.id);
      success(res, lockStatus);
    } catch (err) { next(err); }
  }

  async listSessions(req, res, next) {
    try {
      const sessions = await gamingService.listSessions(req.user.id, req.query);
      success(res, sessions);
    } catch (err) { next(err); }
  }

  async createSession(req, res, next) {
    try {
      const session = await gamingService.createSoloSession(req.user.id, req.body);
      created(res, session, 'Gaming session created');
    } catch (err) { next(err); }
  }

  async startSession(req, res, next) {
    try {
      const session = await gamingService.startSession(req.params.id, req.user.id);
      success(res, session, 'Gaming session started');
    } catch (err) { next(err); }
  }

  async endSession(req, res, next) {
    try {
      const session = await gamingService.endSession(req.params.id, req.user.id);
      success(res, session, 'Gaming session ended');
    } catch (err) { next(err); }
  }

  async cancelSession(req, res, next) {
    try {
      const session = await gamingService.cancelSession(req.params.id, req.user.id);
      success(res, session, 'Gaming session cancelled');
    } catch (err) { next(err); }
  }

  async getSuggestions(req, res, next) {
    try {
      const suggestions = await gamingService.getSuggestions(req.user.id);
      success(res, suggestions);
    } catch (err) { next(err); }
  }
}

module.exports = new GamingController();
