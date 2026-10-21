import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { enableBankingBridge } from './server/vitePlugin';

export default defineConfig(({ mode }) => {
  // Variables sans préfixe VITE_ : elles restent côté serveur et ne sont jamais injectées dans le bundle.
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  return {
    plugins: [
      react(),
      enableBankingBridge(env),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'MyFinances',
          short_name: 'MyFinances',
          description: 'Budget au jour près, patrimoine et placements. Les données restent sur ton appareil.',
          lang: 'fr',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#0B0719',
          theme_color: '#0B0719',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
          navigateFallback: '/index.html',
          // Le relais bancaire et les pages statiques (confidentialité) ne passent pas par index.html.
          navigateFallbackDenylist: [/^\/api\//, /\.html$/],
          runtimeCaching: [],
          cleanupOutdatedCaches: true,
        },
        devOptions: { enabled: false },
      }),
    ],
    build: { chunkSizeWarningLimit: 900 },
  };
});
