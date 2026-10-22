import { defineConfig } from 'vitest/config';

// Tests du serveur et des paquets partagés ; chaque app (apps/*) a les siens.
export default defineConfig({
  test: { include: ['tests/*.test.ts'] },
});
