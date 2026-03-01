module.exports = {
  testEnvironment: 'node',
  verbose: true,
  forceExit: true,
  clearMocks: true,
  resetModules: true,
  coverageDirectory: './coverage',
  coveragePathIgnorePatterns: ['/node_modules/', '/prisma/', '/tests/'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/index.js',
  ],
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
      testEnvironment: 'node',
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
      testEnvironment: 'node',
      globalSetup: '<rootDir>/tests/setup.js',
    },
  ],
};
