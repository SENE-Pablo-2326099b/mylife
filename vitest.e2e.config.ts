import { defineConfig } from 'vitest/config';

// Parcours de bout en bout : l'app construite (npm run build) dans Chrome, contre le serveur local.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 240_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
