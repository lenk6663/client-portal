module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/index.ts",
    "!src/db/migrate.ts"
  ],
  coverageDirectory: "coverage",
  moduleNameMapper: {
    "^@config/(.*)$": "<rootDir>/src/config/$1",
    "^@middleware/(.*)$": "<rootDir>/src/middleware/$1",
    "^@services/(.*)$": "<rootDir>/src/services/$1"
  }
};
