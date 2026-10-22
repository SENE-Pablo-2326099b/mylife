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
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'myRaveLoc',
        short_name: 'myRaveLoc',
        description: 'Retrouver ses amis en festival : une flèche, une distance, des positions chiffrées.',
        lang: 'fr',
        start_url: '/raveloc/',
        scope: '/raveloc/',
        id: '/raveloc/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0B0719',
        theme_color: '#0B0719',
        categories: ['navigation', 'social'],
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
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
