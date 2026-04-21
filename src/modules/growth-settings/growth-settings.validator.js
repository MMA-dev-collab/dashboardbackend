const Joi = require('joi');

const updateSettingsSchema = Joi.object({
  sleepTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/),
  wakeTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/),
  timezone: Joi.string().max(64),
  totalGamingMinutes: Joi.number().integer().min(30).max(480),
  soloGamingMinutes: Joi.number().integer().min(0),
  collabGamingMinutes: Joi.number().integer().min(0),
}).min(1);

module.exports = { updateSettingsSchema };
