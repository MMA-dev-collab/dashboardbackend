const prisma = require('../config/database');

/**
 * Audit log middleware.
 * Automatically logs state-changing operations (POST, PUT, PATCH, DELETE).
 */
const auditLog = (module) => {
  return async (req, res, next) => {
    // Only log mutations
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }

    // Store original json method to intercept response
    const originalJson = res.json.bind(res);

    res.json = async function (body) {
      try {
        // Only log successful mutations
        if (res.statusCode >= 200 && res.statusCode < 300) {
          await prisma.auditLog.create({
            data: {
              userId: req.user?.id || null,
              action: `${req.method} ${req.originalUrl}`,
              module,
              entityId: req.params?.id || body?.data?.id || null,
              entityType: module,
              newData: req.method === 'DELETE' ? undefined : (req.body || undefined),
              ipAddress: req.ip || req.connection?.remoteAddress,
            },
          });
        }
      } catch (err) {
        console.error('Audit log error:', err.message);
      }

      return originalJson(body);
    };

    next();
  };
};

module.exports = { auditLog };
