const Joi = require('joi');

const createSessionSchema = Joi.object({
  sessionType: Joi.string().valid('SOLO', 'TEAM').default('SOLO'),
  teamId: Joi.string().when('sessionType', { is: 'TEAM', then: Joi.required() }),
  startTime: Joi.date().required(),
  plannedDuration: Joi.number().integer().min(15).max(300).required(),
});

const respondInviteSchema = Joi.object({
  status: Joi.string().valid('ACCEPTED', 'DECLINED').required(),
});

module.exports = { createSessionSchema, respondInviteSchema };
