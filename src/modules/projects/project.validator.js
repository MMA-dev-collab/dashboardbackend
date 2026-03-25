const Joi = require('joi');

const createProjectSchema = Joi.object({
  name: Joi.string().min(2).max(200).required().trim(),
  clientName: Joi.string().min(2).max(200).required().trim(),
  clientEmail: Joi.string().email().optional().allow('').trim(),
  description: Joi.string().max(5000).optional().allow('').trim(),
  totalValue: Joi.number().min(0).precision(2).required(),
  companyPercentage: Joi.number().min(0).max(100).precision(2).default(30),
  startDate: Joi.date().optional(),
  deadline: Joi.date().optional(),
  partners: Joi.array().items(
    Joi.object({
      userId: Joi.string().uuid().required(),
      percentage: Joi.number().min(0).max(100).precision(2).required(),
      role: Joi.string().max(50).optional(),
    })
  ).optional(),
});

const updateProjectSchema = Joi.object({
  name: Joi.string().min(2).max(200).trim(),
  clientName: Joi.string().min(2).max(200).trim(),
  clientEmail: Joi.string().email().allow('').trim(),
  description: Joi.string().max(5000).allow('').trim(),
  totalValue: Joi.number().min(0).precision(2),
  companyPercentage: Joi.number().min(0).max(100).precision(2),
  status: Joi.string().valid('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'),
  completionPct: Joi.number().integer().min(0).max(100),
  startDate: Joi.date().optional(),
  deadline: Joi.date().optional(),
}).min(1);

const assignPartnersSchema = Joi.object({
  partners: Joi.array().items(
    Joi.object({
      userId: Joi.string().uuid().required(),
      percentage: Joi.number().min(0).max(100).precision(2).required(),
      role: Joi.string().max(50).optional().default('contributor'),
    })
  ).min(1).required(),
});

module.exports = { createProjectSchema, updateProjectSchema, assignPartnersSchema };
