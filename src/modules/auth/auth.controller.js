const authService = require('./auth.service');
const { success, created } = require('../../utils/response');

class AuthController {
  async register(req, res, next) {
    try {
      const user = await authService.register(req.body);
      created(res, user, 'User registered successfully');
    } catch (err) {
      next(err);
    }
  }

  async login(req, res, next) {
    try {
      const result = await authService.login(req.body.email, req.body.password);
      success(res, result, 'Login successful');
    } catch (err) {
      next(err);
    }
  }

  async refresh(req, res, next) {
    try {
      const result = await authService.refresh(req.body.refreshToken);
      success(res, result, 'Token refreshed');
    } catch (err) {
      next(err);
    }
  }

  async logout(req, res, next) {
    try {
      await authService.logout(req.body.refreshToken);
      success(res, null, 'Logged out successfully');
    } catch (err) {
      next(err);
    }
  }

  async getProfile(req, res, next) {
    try {
      const profile = await authService.getProfile(req.user.id);
      success(res, profile);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AuthController();
