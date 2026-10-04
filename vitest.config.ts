import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    fsModuleCache: true,
    env: {
      ALLOW_LOCALHOST_ENDPOINTS: 'true',
    },
  },
});
