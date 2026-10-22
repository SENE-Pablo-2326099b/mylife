// Génère les icônes PNG de la PWA à partir de public/favicon.svg (Chrome headless via playwright-core),
// comme MyFinances. Usage : npm run icons   (CHROME_PATH pour un autre navigateur)
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const executablePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();

async function render(file, size, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  // Icône « maskable » : fond plein et logo dans la zone de sécurité.
  const inner = maskable ? Math.round(size * 0.78) : size;
  await page.setContent(`<html><body style="margin:0;background:${maskable ? '#0B0719' : 'transparent'};display:grid;place-items:center;width:${size}px;height:${size}px">
    ${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</body></html>`);
  await page.screenshot({ path: `public/${file}`, omitBackground: !maskable });
  console.log('✓', file);
}

await render('pwa-192x192.png', 192);
await render('pwa-512x512.png', 512);
await render('maskable-512x512.png', 512, { maskable: true });
await render('apple-touch-icon.png', 180, { maskable: true });
await browser.close();
