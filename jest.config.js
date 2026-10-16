// Unit tests live next to the code (src/**/*.spec.ts); e2e tests in test/**/*.e2e-spec.ts.
// SWC compiles the TypeScript and emits decorator metadata, which NestJS dependency injection needs.
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: {
    '^.+\\.ts$': [
      '@swc/jest',
      {
        jsc: {
          target: 'es2023',
          parser: { syntax: 'typescript', decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
        },
        module: { type: 'commonjs' },
      },
    ],
  },
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  clearMocks: true,
  // e2e tests share one database and truncate it between tests.
  maxWorkers: 1,
};
