import { defineConfig } from 'vitest/config';

const here = (p: string) => new URL(p, import.meta.url).pathname;

// Tests du serveur, des paquets partagés et de la coquille V5 ; chaque app (apps/*) a les siens.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      { find: '@mylife/kit', replacement: here('./packages/kit/src/index.ts') },
      { find: '@mylife/lumen', replacement: here('./packages/lumen/src/index.ts') },
      { find: /^@mylife\/core\/(.*)$/, replacement: `${here('./packages/sync-client/src/')}$1` },
    ],
  },
  test: { include: ['tests/*.test.ts'] },
});
