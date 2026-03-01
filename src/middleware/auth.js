const jwt = require('jsonwebtoken');
const env = require('../config/env');
const prisma = require('../config/database');
const { UnauthorizedError } = require('../utils/errors');

/**
 * JWT authentication middleware.
 * Validates Bearer token, attaches user + roles to req.
 */
const authenticate = async (req, res, next) => {
  try {
    let token;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query.token) {
      token = req.query.token;
    } else {
      throw new UnauthorizedError('No token provided');
    }

    const decoded = jwt.verify(token, env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
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

    // Flatten roles and permissions
    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: user.userRoles.map((ur) => ur.role.name),
      permissions: user.userRoles.flatMap((ur) =>
        ur.role.permissions.map((rp) => `${rp.permission.module}:${rp.permission.action}`)
      ),
    };

    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      next(new UnauthorizedError('Invalid or expired token'));
    } else {
      next(err);
    }
  }
};

module.exports = { authenticate };
