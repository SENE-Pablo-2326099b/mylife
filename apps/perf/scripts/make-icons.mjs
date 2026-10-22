#!/usr/bin/env node
// Icônes MyPerf à partir de assets/brand/icon.svg (Chrome headless via playwright-core).
// Usage : node scripts/make-icons.mjs   (PLAYWRIGHT_CORE = chemin du module si absent, CHROME_PATH pour un autre navigateur)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const svg = readFileSync(join(ROOT, 'assets/brand/icon.svg'), 'utf8');
// Variantes : carré plein (les systèmes arrondissent eux-mêmes), motif seul, fond seul.
const BG = /<rect width="64" height="64"[^>]*\/>/g;
const full = svg.replace(/rx="14"/g, 'rx="0"');
const markOnly = svg.replace(BG, '');
const bgOnly = full.replace(/<rect x=[^>]*\/>/g, '');
const white = markOnly.replace(/fill="url\(#[ab]\)"/g, 'fill="#FFFFFF"');

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome' });
const page = await browser.newPage();
async function render(file, size, source, { scale = 1 } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * scale);
  await page.setContent(
    `<html><body style="margin:0;background:transparent;display:grid;place-items:center;width:${size}px;height:${size}px">${source.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</body></html>`,
  );
  await page.screenshot({ path: join(ROOT, file), omitBackground: true });
  console.log('✓', file);
}
// App native (Expo)
await render('assets/images/icon.png', 1024, full);
await render('assets/images/android-icon-background.png', 512, bgOnly);
await render('assets/images/android-icon-foreground.png', 512, markOnly, { scale: 0.62 }); // zone sûre de l'icône adaptative
await render('assets/images/android-icon-monochrome.png', 432, white, { scale: 0.62 });
await render('assets/images/splash-icon.png', 228, markOnly);
await render('assets/images/favicon.png', 48, svg);
// PWA (web/static)
await render('web/static/pwa-192x192.png', 192, svg);
await render('web/static/pwa-512x512.png', 512, svg);
await render('web/static/maskable-512x512.png', 512, full.replace(/<rect x=/g, '<rect transform="translate(32 32) scale(0.8) translate(-32 -32)" x='));
await render('web/static/apple-touch-icon.png', 180, full);
await browser.close();
