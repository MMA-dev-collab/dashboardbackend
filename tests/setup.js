/**
 * Global test setup for integration tests.
 */
module.exports = async function () {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-for-testing';
  process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-for-testing';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://root:password@localhost:3306/egycodera_test';
};
