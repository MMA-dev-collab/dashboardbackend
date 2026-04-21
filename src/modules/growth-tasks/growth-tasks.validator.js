const Joi = require('joi');

const createGrowthTaskSchema = Joi.object({
  title: Joi.string().min(1).max(200).required().trim(),
  description: Joi.string().max(2000).allow('', null).optional(),
  duration: Joi.number().integer().min(5).max(480).required(),
  priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH').default('MEDIUM'),
  taskType: Joi.string().valid('FIXED', 'FLEXIBLE').default('FLEXIBLE'),
  scheduledDate: Joi.date().allow(null).optional(),
  scheduledTime: Joi.date().allow(null).optional(),
  scheduledEndTime: Joi.date().allow(null).optional(),
  dueDate: Joi.date().allow(null).optional(),
});

const updateGrowthTaskSchema = Joi.object({
  title: Joi.string().min(1).max(200).trim().optional(),
  description: Joi.string().max(2000).allow('', null).optional(),
  duration: Joi.number().integer().min(5).max(480).optional(),
  priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH').optional(),
  taskType: Joi.string().valid('FIXED', 'FLEXIBLE').optional(),
  status: Joi.string().valid('PENDING', 'ACTIVE').optional(),
  scheduledDate: Joi.date().allow(null).optional(),
  scheduledTime: Joi.date().allow(null).optional(),
  scheduledEndTime: Joi.date().allow(null).optional(),
  dueDate: Joi.date().allow(null).optional(),
});

const listGrowthTasksSchema = Joi.object({
  status: Joi.string().valid('PENDING', 'ACTIVE', 'COMPLETED', 'OVERDUE').optional(),
  priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH').optional(),
  date: Joi.date().optional(),
  page: Joi.number().min(1).default(1),
  limit: Joi.number().min(1).max(100).default(50),
});

module.exports = { createGrowthTaskSchema, updateGrowthTaskSchema, listGrowthTasksSchema };
