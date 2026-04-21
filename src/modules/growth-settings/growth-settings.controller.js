const settingsService = require('./growth-settings.service');
const { success } = require('../../utils/response');

class GrowthSettingsController {
  async getSettings(req, res, next) {
    try {
      const data = await settingsService.getSettings(req.user.id);
      success(res, data);
    } catch (err) { next(err); }
  }

  async updateSettings(req, res, next) {
    try {
      const data = await settingsService.updateSettings(req.user.id, req.body);
      success(res, data, 'Settings updated');
    } catch (err) { next(err); }
  }
}

module.exports = new GrowthSettingsController();
