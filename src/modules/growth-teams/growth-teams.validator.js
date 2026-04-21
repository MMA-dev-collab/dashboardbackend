const Joi = require('joi');

const createTeamSchema = Joi.object({
  name: Joi.string().min(1).max(100).required().trim(),
  description: Joi.string().max(500).allow('', null).optional(),
});

const updateTeamSchema = Joi.object({
  name: Joi.string().min(1).max(100).trim().optional(),
  description: Joi.string().max(500).allow('', null).optional(),
});

const addMemberSchema = Joi.object({
  userId: Joi.string().required(),
  role: Joi.string().valid('leader', 'member').default('member'),
});

const friendRequestSchema = Joi.object({
  addresseeId: Joi.string().required(),
});

const respondFriendSchema = Joi.object({
  status: Joi.string().valid('ACCEPTED', 'REJECTED').required(),
});

const setAvailabilitySchema = Joi.object({
  slots: Joi.array().items(Joi.object({
    dayOfWeek: Joi.number().min(0).max(6).required(),
    startTime: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
    endTime: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
    isRecurring: Joi.boolean().default(true),
    specificDate: Joi.date().allow(null).optional(),
  })).min(1).required(),
});

const overlapSchema = Joi.object({
  userIds: Joi.array().items(Joi.string()).min(2).max(10).required(),
});

const respondInviteSchema = Joi.object({
  status: Joi.string().valid('ACCEPTED', 'DECLINED').required(),
});

module.exports = {
  createTeamSchema, updateTeamSchema, addMemberSchema,
  friendRequestSchema, respondFriendSchema, setAvailabilitySchema,
  overlapSchema, respondInviteSchema,
};
