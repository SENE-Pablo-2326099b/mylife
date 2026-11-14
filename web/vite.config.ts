import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = new URL('.', import.meta.url).pathname;

/**
 * L'ancien accueil, servi à `/ancien/` sans service worker ni manifeste depuis la V5 (la coquille `app/` est à `/`).
 * Il ne reste que pour les Sorties, jusqu'à ce qu'elles rejoignent MyRave (phase 5) ; il sera alors supprimé.
 */
export default defineConfig({
  root,
  base: '/ancien/',
  plugins: [react()],
  server: { port: 4311, proxy: { '/api': 'http://localhost:4300' } },
  build: { outDir: 'dist/ancien', emptyOutDir: true, chunkSizeWarningLimit: 700 },
});
