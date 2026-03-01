const { ForbiddenError } = require('../utils/errors');

/**
 * Role-based access control middleware.
 * Usage: rbac.requireRole('Admin', 'Finance Approver')
 *        rbac.requirePermission('projects', 'create')
 */

/**
 * Require user to have at least one of the specified roles.
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ForbiddenError('Authentication required'));
    }
    const hasRole = req.user.roles.some((r) => roles.includes(r));
    if (!hasRole) {
      return next(new ForbiddenError(`Requires one of roles: ${roles.join(', ')}`));
    }
    next();
  };
};

/**
 * Require user to have a specific permission (module:action).
 */
const requirePermission = (module, action) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ForbiddenError('Authentication required'));
    }
    const permission = `${module}:${action}`;
    if (!req.user.permissions.includes(permission)) {
      return next(new ForbiddenError(`Missing permission: ${permission}`));
    }
    next();
  };
};

module.exports = { requireRole, requirePermission };
