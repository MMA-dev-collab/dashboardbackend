const Joi = require('joi');

const checkinSchema = Joi.object({
  type: Joi.string().valid('SLEEP', 'WAKE').required(),
});

module.exports = { checkinSchema };
