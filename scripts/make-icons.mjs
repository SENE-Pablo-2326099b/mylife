// Génère les icônes PNG de la PWA à partir de public/favicon.svg (Chrome headless via playwright-core).
// Usage : node scripts/make-icons.mjs   (CHROME_PATH pour un autre navigateur)
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const executablePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();

async function render(file, size, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  // Icône « maskable » : fond plein et logo dans la zone de sécurité (80 %).
  const inner = maskable ? Math.round(size * 0.72) : size;
  const radius = maskable ? 0 : Math.round(size * 0.22);
  await page.setContent(`<html><body style="margin:0;background:${maskable ? '#111110' : 'transparent'};display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px;border-radius:${radius}px;overflow:hidden">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await page.screenshot({ path: `public/${file}`, omitBackground: !maskable });
  console.log('✓', file);
}

await render('pwa-192x192.png', 192);
await render('pwa-512x512.png', 512);
await render('maskable-512x512.png', 512, { maskable: true });
await render('apple-touch-icon.png', 180, { maskable: true });
await browser.close();
