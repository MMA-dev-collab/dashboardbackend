const Joi = require('joi');

const loginSchema = Joi.object({
  email: Joi.string().email().required().trim().lowercase(),
  password: Joi.string().min(6).required(),
});

const registerSchema = Joi.object({
  email: Joi.string().email().required().trim().lowercase(),
  password: Joi.string().min(8).required()
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .message('Password must contain uppercase, lowercase, and a number'),
  firstName: Joi.string().min(1).max(50).required().trim(),
  lastName: Joi.string().min(1).max(50).required().trim(),
  roles: Joi.array().items(Joi.string()).optional(),
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

module.exports = { loginSchema, registerSchema, refreshSchema };
