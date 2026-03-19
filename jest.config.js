/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    // stub playwright — too heavy to load in unit tests
    '^playwright$': '<rootDir>/tests/__mocks__/playwright.ts',
    '^playwright/.*$': '<rootDir>/tests/__mocks__/playwright.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        esModuleInterop: true,
        strict: true,
      },
    }],
  },
};
