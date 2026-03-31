const { AppError } = require('../utils/errors');
const logger = require('../config/logger');
const env = require('../config/env');

/**
 * Global error handler middleware.
 *
 * Improvements:
 *  - Uses Winston logger (structured, leveled) instead of console.error
 *  - Logs request context: method, path, userId, statusCode
 *  - Handles additional Prisma error codes
 *  - Does not leak stack traces or sensitive info in production
 */
const errorHandler = (err, req, res, _next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let details = err.details || null;

  // ── Prisma error mapping ──────────────────────────────────────
  if (err.code === 'P2002') {
    statusCode = 409;
    message = 'A record with this data already exists';
    details = err.meta?.target;
  } else if (err.code === 'P2025') {
    statusCode = 404;
    message = 'Record not found';
  } else if (err.code === 'P2003') {
    statusCode = 400;
    message = 'Invalid reference — related record not found';
  } else if (err.code === 'P2014') {
    statusCode = 400;
    message = 'The operation violates a required relation constraint';
  }

  // ── Don't leak internals in production ────────────────────────
  if (statusCode === 500 && env.NODE_ENV === 'production') {
    message = 'Internal server error';
    details = null;
  }

  // ── Structured logging ────────────────────────────────────────
  const logContext = {
    method: req.method,
    path: req.originalUrl,
    statusCode,
    userId: req.user?.id ?? 'unauthenticated',
    errorName: err.name || 'UnknownError',
    ...(err.code ? { prismaCode: err.code } : {}),
  };

  if (statusCode >= 500) {
    logger.error(err.message, { ...logContext, stack: err.stack });
  } else if (statusCode >= 400) {
    logger.warn(err.message, logContext);
  }

  // ── HTTP response ─────────────────────────────────────────────
  res.status(statusCode).json({
    success: false,
    message,
    ...(details && { details }),
    ...(env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = { errorHandler };
