import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { enableBankingBridge } from './server/vitePlugin';

export default defineConfig(({ mode }) => {
  // Variables sans préfixe VITE_ : elles restent côté serveur et ne sont jamais injectées dans le bundle.
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  return {
    // Servie sous MyLife (même origine que les autres apps) : https://…/finances/
    base: '/finances/',
    // Date du build, affichée dans Réglages : pour vérifier que l'app installée est à jour.
    define: { __APP_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
    plugins: [
      react(),
      enableBankingBridge(env),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        // Une seule app installable : MyLife (manifeste de l'accueil, portée /), que cette page relie.
        manifest: false,
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
          navigateFallback: '/finances/index.html',
          // Le relais bancaire et les pages statiques (confidentialité) ne passent pas par index.html.
          navigateFallbackDenylist: [/^\/api\//, /\.html$/],
          runtimeCaching: [],
          cleanupOutdatedCaches: true,
        },
        devOptions: { enabled: false },
      }),
    ],
    build: { outDir: 'dist/finances', chunkSizeWarningLimit: 900 },
  };
});
