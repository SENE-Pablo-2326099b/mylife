import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Servie sous MyLife (même origine que les autres apps, donc même session) : https://…/raveloc/
  base: '/raveloc/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      // Une seule app installable : MyLife (manifeste de l'accueil, portée /), que cette page relie.
      manifest: false,
      workbox: {
        // Coquille de l'app seulement. Aucune réponse d'API n'est mise en cache : une position doit
        // venir du réseau ou être affichée comme ancienne, jamais ressortie d'un cache.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: '/raveloc/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    // Développement : l'API (et /api/auth de MyLife) tournent dans `npm run local` (base en mémoire).
    proxy: { '/api': 'http://localhost:4320' },
  },
  build: { outDir: 'dist/raveloc', chunkSizeWarningLimit: 600 },
});
