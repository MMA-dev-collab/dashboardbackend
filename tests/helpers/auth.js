const jwt = require('jsonwebtoken');

const TEST_SECRET = 'test-jwt-secret-for-testing';

/**
 * Generate a valid JWT token for testing.
 */
function generateTestToken(userId, roles = ['Partner']) {
  return jwt.sign({ userId, roles }, TEST_SECRET, { expiresIn: '1h' });
}

function generateAdminToken(userId = 'test-admin-id') {
  return generateTestToken(userId, ['Admin']);
}

function generatePartnerToken(userId = 'test-partner-id') {
  return generateTestToken(userId, ['Partner']);
}

module.exports = { generateTestToken, generateAdminToken, generatePartnerToken };
