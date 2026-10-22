import { defineConfig } from 'vitest/config';

// Parcours de bout en bout de tout MyLife : l'accueil et les trois apps construites, dans Chrome,
// contre le serveur local (vraies API, base en mémoire).
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 240_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
