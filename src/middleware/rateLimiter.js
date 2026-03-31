/**
 * Rate Limiting Middleware
 *
 * Protects against brute-force attacks and API abuse.
 * Uses express-rate-limit with in-memory store (suitable for single-server).
 * Swap to RedisStore for multi-instance deployments.
 */
const rateLimit = require('express-rate-limit');

// ── Helper to build limiter ───────────────────────────────────────
const buildLimiter = ({ windowMs, max, message }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,  // Return RateLimit-* headers
    legacyHeaders: false,
    message: {
      success: false,
      message,
    },
    skip: () => process.env.NODE_ENV === 'test', // Disable in test env
  });

/**
 * Auth limiter — 10 attempts per 15 minutes.
 * Apply to /api/auth (login, register, refresh).
 */
const authLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many authentication attempts. Please try again in 15 minutes.',
});

/**
 * AI limiter — 40 requests per minute.
 * Apply to /api/ai (chat, threads).
 */
const aiLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: 40,
  message: 'AI request limit reached. Please slow down.',
});

/**
 * General limiter — 200 requests per minute globally.
 * Apply as app-level middleware.
 */
const generalLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: 200,
  message: 'Too many requests. Please try again shortly.',
});

module.exports = { authLimiter, aiLimiter, generalLimiter };
