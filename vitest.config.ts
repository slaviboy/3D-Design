import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    environment: 'node',
    benchmark: { include: ['tests/bench/**/*.bench.ts'] },
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'html'],
    },
  },
});
