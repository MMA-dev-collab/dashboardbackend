const Joi = require('joi');

const getXpLogsSchema = Joi.object({
  page: Joi.number().min(1).default(1),
  limit: Joi.number().min(1).max(100).default(20),
  source: Joi.string().valid(
    'TASK_COMPLETION', 'FOCUS_BLOCK', 'ROUTINE', 'STREAK_BONUS',
    'WELLNESS', 'PENALTY', 'GAMING', 'TEAM_PARTICIPATION'
  ),
});

const getLeaderboardSchema = Joi.object({
  type: Joi.string().valid('global', 'weekly').default('global'),
  limit: Joi.number().min(1).max(100).default(20),
});

module.exports = { getXpLogsSchema, getLeaderboardSchema };
