const { BadRequestError } = require('../utils/errors');

/**
 * Joi validation middleware factory.
 * @param {import('joi').ObjectSchema} schema - Joi schema
 * @param {string} source - 'body' | 'query' | 'params'
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message.replace(/"/g, ''),
      }));
      return next(new BadRequestError('Validation failed', details));
    }

    req[source] = value;
    next();
  };
};

module.exports = { validate };
