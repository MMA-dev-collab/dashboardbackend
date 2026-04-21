const Joi = require('joi');

const createScheduleSchema = Joi.object({
  date: Joi.date().required(),
});

const createBlockSchema = Joi.object({
  growthTaskId: Joi.string().allow(null).optional(),
  title: Joi.string().min(1).max(200).required().trim(),
  blockType: Joi.string().valid('TASK', 'FIXED_EVENT', 'GAMING', 'FOCUS_BLOCK', 'BREAK').default('TASK'),
  startTime: Joi.date().required(),
  endTime: Joi.date().greater(Joi.ref('startTime')).required(),
  color: Joi.string().pattern(/^#[0-9a-fA-F]{6}$/).allow(null).optional(),
});

const updateBlockSchema = Joi.object({
  title: Joi.string().min(1).max(200).trim().optional(),
  startTime: Joi.date().optional(),
  endTime: Joi.date().optional(),
  color: Joi.string().pattern(/^#[0-9a-fA-F]{6}$/).allow(null).optional(),
  status: Joi.string().valid('PENDING', 'ACTIVE', 'COMPLETED').optional(),
});

const detectConflictsSchema = Joi.object({
  scheduleId: Joi.string().required(),
});

const setGamingTimeSchema = Joi.object({
  gamingMinutes: Joi.number().integer().min(0).max(1440).optional(),
  soloMinutes: Joi.number().integer().min(0).max(1440).optional(),
  collabMinutes: Joi.number().integer().min(0).max(1440).optional(),
}).min(1);

const optimizeSchema = Joi.object({
  date: Joi.date().required(),
});

module.exports = { createScheduleSchema, createBlockSchema, updateBlockSchema, detectConflictsSchema, optimizeSchema, setGamingTimeSchema };
