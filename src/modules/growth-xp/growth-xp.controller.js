const xpService = require('./growth-xp.service');
const { success } = require('../../utils/response');
const { validate } = require('../../middleware/validate');
const { getXpLogsSchema, getLeaderboardSchema } = require('./growth-xp.validator');

class XpController {
  async getProfile(req, res, next) {
    try {
      const profile = await xpService.getUserProfile(req.user.id);
      success(res, profile);
    } catch (err) { next(err); }
  }

  async getLogs(req, res, next) {
    try {
      const result = await xpService.getXpLogs(req.user.id, req.query);
      success(res, result.data, 'XP logs fetched');
    } catch (err) { next(err); }
  }

  async getLeaderboard(req, res, next) {
    try {
      const leaderboard = await xpService.getLeaderboard(req.query);
      success(res, leaderboard);
    } catch (err) { next(err); }
  }

  async getStreak(req, res, next) {
    try {
      const streak = await xpService.getStreak(req.user.id);
      success(res, streak);
    } catch (err) { next(err); }
  }

  async getMultipliers(req, res, next) {
    try {
      const multipliers = await xpService.getMultipliers(req.user.id);
      success(res, multipliers);
    } catch (err) { next(err); }
  }
}

module.exports = new XpController();
