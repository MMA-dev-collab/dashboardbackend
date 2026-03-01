const { Router } = require('express');
const authController = require('./auth.controller');
const { authenticate } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/rbac');
const { validate } = require('../../middleware/validate');
const { loginSchema, registerSchema, refreshSchema } = require('./auth.validator');

const router = Router();

router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh', validate(refreshSchema), authController.refresh);
router.post('/logout', authController.logout);

// Protected routes
router.post('/register', authenticate, requireRole('Admin'), validate(registerSchema), authController.register);
router.get('/profile', authenticate, authController.getProfile);

module.exports = router;
