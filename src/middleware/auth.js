/**
 * JWT Authentication Middleware
 *
 * Improvements:
 *  - In-memory permission cache (node-cache, 5-minute TTL)
 *    → skips DB query on cache HIT, cutting latency significantly
 *  - Cache is invalidated automatically via TTL
 *  - Cache key: userId (from decoded JWT)
 */
const jwt = require('jsonwebtoken');
const NodeCache = require('node-cache');
const env = require('../config/env');
const prisma = require('../config/database');
const { UnauthorizedError } = require('../utils/errors');
const logger = require('../config/logger');

// ── Permission cache: 5-minute TTL, pruned every 2 minutes ───────
const permissionCache = new NodeCache({ stdTTL: 300, checkperiod: 120 });

/**
 * Invalidate cached permissions for a user.
 * Call this after role/permission changes.
 *
 * @param {string} userId
 */
function invalidateUserCache(userId) {
  permissionCache.del(userId);
  logger.debug(`[Auth] Cache invalidated for user ${userId}`);
}

/**
 * JWT authentication middleware.
 * Validates Bearer token, attaches user + roles + permissions to req.
 * Uses in-memory cache to avoid DB round-trip on every request.
 */
const authenticate = async (req, res, next) => {
  try {
    // ── 1. Extract token ────────────────────────────────────────
    let token;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query.token) {
      token = req.query.token;
    } else {
      throw new UnauthorizedError('No token provided');
    }

    // ── 2. Verify JWT ───────────────────────────────────────────
    const decoded = jwt.verify(token, env.JWT_SECRET);
    const userId = decoded.userId;

    // ── 3. Check cache ───────────────────────────────────────────
    const cached = permissionCache.get(userId);
    if (cached) {
      req.user = cached;
      logger.debug(`[Auth] Cache HIT for user ${userId}`);
      return next();
    }

    // ── 4. Cache MISS → fetch from DB ────────────────────────────
    logger.debug(`[Auth] Cache MISS for user ${userId} — querying DB`);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        userRoles: {
          select: {
            role: {
              select: {
                id: true,
                name: true,
                permissions: {
                  select: {
                    permission: {
                      select: { module: true, action: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedError('User not found or inactive');
    }

    // ── 5. Build flat user object ─────────────────────────────────
    const userPayload = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: user.userRoles.map((ur) => ur.role.name),
      permissions: user.userRoles.flatMap((ur) =>
        ur.role.permissions.map(
          (rp) => `${rp.permission.module}:${rp.permission.action}`
        )
      ),
    };

    // ── 6. Store in cache ────────────────────────────────────────
    permissionCache.set(userId, userPayload);

    req.user = userPayload;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      next(new UnauthorizedError('Invalid or expired token'));
    } else {
      next(err);
    }
  }
};

module.exports = { authenticate, invalidateUserCache };
