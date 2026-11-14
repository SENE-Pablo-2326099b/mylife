import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const here = (p: string) => new URL(p, import.meta.url).pathname;

/**
 * La coquille de MyLife V5, servie à `/` : la seule PWA installable (manifeste de portée `/`, mêmes identifiant et icônes
 * qu'avant pour que l'app déjà installée se mette à jour sans rien réinstaller). L'ancien accueil reste construit à part
 * et servi à `/ancien/` (sans service worker) le temps que les Sorties rejoignent MyRave.
 * Le kit, le cœur et lumen sont importés depuis `packages/` (plus de copies).
 */
export default defineConfig({
  root: here('.'),
  base: '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'shortcut-*.png'],
      manifest: {
        id: '/',
        name: 'MyLife',
        short_name: 'MyLife',
        description: 'Ton environnement numérique personnel : finances, entraînement, sorties. Un compte, tes données chiffrées.',
        lang: 'fr',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone'],
        orientation: 'portrait',
        background_color: '#05060D',
        theme_color: '#05060D',
        categories: ['finance', 'health', 'lifestyle', 'productivity'],
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Fenêtre d'installation enrichie (Android) : les captures d'avant la V5, à refaire module par module.
        screenshots: [
          { src: '/screenshots/1-accueil.jpg', sizes: '780x1688', type: 'image/jpeg', form_factor: 'narrow', label: 'Aujourd’hui : tes modules et ce qu’ils ont à te dire' },
          { src: '/screenshots/2-finances.jpg', sizes: '780x1688', type: 'image/jpeg', form_factor: 'narrow', label: 'MyFinances : le budget du jour' },
          { src: '/screenshots/3-perf.jpg', sizes: '780x1688', type: 'image/jpeg', form_factor: 'narrow', label: 'MyPerf : la séance du jour' },
          { src: '/screenshots/4-raveloc.jpg', sizes: '780x1688', type: 'image/jpeg', form_factor: 'narrow', label: 'MyRave : retrouver ses amis' },
        ],
        shortcuts: [
          { name: 'MyFinances', short_name: 'Finances', description: 'Budget et patrimoine', url: '/finances/', icons: [{ src: '/shortcut-finances.png', sizes: '96x96', type: 'image/png' }] },
          { name: 'MyPerf', short_name: 'Perf', description: 'Séances et progression', url: '/perf/', icons: [{ src: '/shortcut-perf.png', sizes: '96x96', type: 'image/png' }] },
          { name: 'MyRave', short_name: 'Rave', description: 'Sorties entre amis', url: '/raveloc/', icons: [{ src: '/shortcut-raveloc.png', sizes: '96x96', type: 'image/png' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        // L'ancien accueil et les apps ont leurs propres fichiers : ce service worker ne sert que la coquille.
        globIgnores: ['ancien/**', 'finances/**', 'perf/**', 'raveloc/**', 'screenshots/**'],
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [/^\/(?!finances|perf|raveloc|api|ancien)/],
        navigateFallbackDenylist: [/^\/(finances|perf|raveloc|api|ancien)(\/|$)/],
        runtimeCaching: [],
        // Rappels écrits par l'appareil : réception et clic des notifications (app/public/push-sw.js).
        importScripts: ['/push-sw.js'],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: [
      { find: '@legacy', replacement: here('../web/src') },
      // Le code de l'ancien accueil importe ses copies « vendor » : ici, elles pointent vers les paquets eux-mêmes, pour
      // qu'il n'y ait qu'une seule session et une seule apparence en mémoire (les copies n'auraient pas vu la connexion).
      { find: /^\.{1,2}(?:\/\.\.)*\/vendor\/mylife-sync(\/.*)?$/, replacement: `${here('../packages/sync-client/src')}$1` },
      { find: /^\.{1,2}(?:\/\.\.)*\/vendor\/lumen(\/.*)?$/, replacement: `${here('../packages/lumen/src')}$1` },
      { find: '@mylife/kit/kit.css', replacement: here('../packages/kit/src/kit.css') },
      { find: '@mylife/kit', replacement: here('../packages/kit/src/index.ts') },
      { find: '@mylife/lumen', replacement: here('../packages/lumen/src/index.ts') },
      { find: /^@mylife\/core\/(.*)$/, replacement: `${here('../packages/sync-client/src/')}$1` },
    ],
  },
  server: { port: 4310, proxy: { '/api': 'http://localhost:4300' } },
  // Construite en dernier : elle possède web/dist (l'ancien accueil s'est déjà posé dans web/dist/ancien).
  build: { outDir: here('../web/dist'), emptyOutDir: false, chunkSizeWarningLimit: 700 },
});
