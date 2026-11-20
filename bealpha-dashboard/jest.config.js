/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.json",
        diagnostics: false,
      },
    ],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  testPathIgnorePatterns: ["/node_modules/", "/.next/", "/tests/e2e/"],
  modulePathIgnorePatterns: [
    "<rootDir>/.next/",
    "<rootDir>/.next-codex/",
    "<rootDir>/.next-codex-final/",
    "<rootDir>/.next-final/",
    "<rootDir>/.next-microservices/",
  ],
  coverageDirectory: "coverage",
  collectCoverageFrom: [
    "lib/**/*.ts",
    "!**/*.d.ts",
  ],
  testMatch: [
    "<rootDir>/tests/unit/**/*.test.ts",
    "<rootDir>/tests/integration/**/*.test.ts",
  ],
};

module.exports = config;
