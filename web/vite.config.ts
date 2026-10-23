import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const root = new URL('.', import.meta.url).pathname;

/**
 * L'accueil MyLife (`/`) et la seule PWA installable de l'écosystème : son manifeste (portée `/`)
 * couvre MyFinances, MyPerf et myRaveLoc, qui le relient au lieu d'avoir le leur. Une app installée,
 * des raccourcis vers chaque app (appui long sur l'icône).
 */
export default defineConfig({
  root,
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
        description: 'Tes finances, ton entraînement et tes sorties dans une seule app. Un compte, tes données chiffrées.',
        lang: 'fr',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone'],
        orientation: 'portrait',
        background_color: '#0B0719',
        theme_color: '#0B0719',
        categories: ['finance', 'health', 'lifestyle', 'productivity'],
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Fenêtre d'installation enrichie (Android) : à quoi ressemble MyLife.
        screenshots: [
          { src: '/screenshots/1-accueil.jpg', sizes: '780x1688', type: 'image/jpeg', form_factor: 'narrow', label: 'Accueil : tes apps et ce qu’elles ont à te dire' },
          { src: '/screenshots/2-finances.jpg', sizes: '780x1688', type: 'image/jpeg', form_factor: 'narrow', label: 'MyFinances : le budget du jour' },
          { src: '/screenshots/3-perf.jpg', sizes: '780x1688', type: 'image/jpeg', form_factor: 'narrow', label: 'MyPerf : la séance du jour' },
          { src: '/screenshots/4-raveloc.jpg', sizes: '780x1688', type: 'image/jpeg', form_factor: 'narrow', label: 'myRaveLoc : retrouver ses amis' },
        ],
        shortcuts: [
          { name: 'MyFinances', short_name: 'Finances', description: 'Budget du jour, opérations, patrimoine', url: '/finances/', icons: [{ src: '/shortcut-finances.png', sizes: '96x96', type: 'image/png' }] },
          { name: 'MyPerf', short_name: 'Perf', description: 'Séance du jour, planning, progression', url: '/perf/', icons: [{ src: '/shortcut-perf.png', sizes: '96x96', type: 'image/png' }] },
          { name: 'myRaveLoc', short_name: 'RaveLoc', description: 'Retrouver tes amis en festival', url: '/raveloc/', icons: [{ src: '/shortcut-raveloc.png', sizes: '96x96', type: 'image/png' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        globIgnores: ['screenshots/**'],
        navigateFallback: '/index.html',
        // Les apps ont leur propre service worker et leurs propres pages : celui-ci ne sert que l'accueil.
        // Toutes les pages de l'accueil s'ouvrent hors ligne (Personnage, bilans, Crew, Sorties, MyMusique…).
        navigateFallbackAllowlist: [/^\/(?!finances|perf|raveloc|api)/],
        navigateFallbackDenylist: [/^\/(finances|perf|raveloc|api)(\/|$)/],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 4310, proxy: { '/api': 'http://localhost:4300' } },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 700 },
});
