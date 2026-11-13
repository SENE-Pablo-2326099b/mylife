import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = (p: string) => new URL(p, import.meta.url).pathname;

/**
 * La coquille de MyLife V5. Tant qu'elle n'a pas remplacé l'ancien accueil, elle est servie à `/v5/`, dans le même
 * déploiement (sortie dans `web/dist/v5`) : même adresse, donc même compte et mêmes données sur l'appareil.
 * Le kit, le cœur et lumen sont importés depuis `packages/` (plus de copies).
 */
export default defineConfig({
  root: here('.'),
  base: '/v5/',
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@legacy', replacement: here('../web/src') },
      { find: '@mylife/kit/kit.css', replacement: here('../packages/kit/src/kit.css') },
      { find: '@mylife/kit', replacement: here('../packages/kit/src/index.ts') },
      { find: '@mylife/lumen', replacement: here('../packages/lumen/src/index.ts') },
      { find: /^@mylife\/core\/(.*)$/, replacement: `${here('../packages/sync-client/src/')}$1` },
    ],
  },
  server: { port: 4312, proxy: { '/api': 'http://localhost:4300' } },
  build: { outDir: here('../web/dist/v5'), emptyOutDir: true },
});
