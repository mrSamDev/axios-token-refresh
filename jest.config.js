// jest.config.js
module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+\\.js$": "babel-jest",
  },
  collectCoverageFrom: ["src/**/*.js", "!src/**/*.test.js", "!src/integration.test.js"],
  testMatch: ["**/src/**/*.test.js", "!**/src/integration.test.js"],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  // Force exit after tests complete
  forceExit: true,
  // Detect open handles for debugging
  detectOpenHandles: false,
};
