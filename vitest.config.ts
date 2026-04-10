import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 1,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/assistant/**/*.ts', 'src/lib/**/*.ts'],
      exclude: ['node_modules', 'dist', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
    },
    projects: [
      {
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          fileParallelism: false,
          pool: 'forks',
          poolOptions: {
            forks: {
              maxForks: 1,
            },
          },
          include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/unit/**/*.{test,spec}.{ts,tsx}', 'tests/pipeline/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx}'],
          exclude: ['node_modules', 'dist', 'src/**/*.integration.test.ts', 'src/**/*.semantic.test.ts', 'tests/**/*.integration.test.ts', 'tests/**/*.semantic.test.ts', 'test/**/*.integration.test.ts', 'test/**/*.semantic.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          globals: true,
          environment: 'node',
          fileParallelism: false,
          pool: 'forks',
          poolOptions: {
            forks: {
              maxForks: 1,
            },
          },
          include: ['src/**/*.integration.test.ts', 'tests/integration/**/*.{test,spec}.{ts,tsx}'],
          exclude: ['node_modules', 'dist'],
        },
      },
      {
        test: {
          name: 'semantic',
          globals: true,
          environment: 'node',
          fileParallelism: false,
          pool: 'forks',
          poolOptions: {
            forks: {
              maxForks: 1,
            },
          },
          include: ['src/**/*.semantic.test.ts'],
          exclude: ['node_modules', 'dist'],
        },
      },
    ],
  },
});
