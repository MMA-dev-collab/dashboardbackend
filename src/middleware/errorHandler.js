const { AppError } = require('../utils/errors');
const env = require('../config/env');

/**
 * Global error handler middleware.
 * Does not leak sensitive info in production.
 */
const errorHandler = (err, req, res, _next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let details = err.details || null;

  // Prisma errors
  if (err.code === 'P2002') {
    statusCode = 409;
    message = 'A record with this data already exists';
    details = err.meta?.target;
  } else if (err.code === 'P2025') {
    statusCode = 404;
    message = 'Record not found';
  } else if (err.code === 'P2003') {
    statusCode = 400;
    message = 'Invalid reference - related record not found';
  }

  // Don't leak internal error details in production
  if (statusCode === 500 && env.NODE_ENV === 'production') {
    message = 'Internal server error';
    details = null;
  }

  if (env.NODE_ENV !== 'test') {
    console.error(`[Error] ${statusCode} - ${err.message}`, err.stack);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(details && { details }),
    ...(env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = { errorHandler };
