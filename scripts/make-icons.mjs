// Génère les icônes PNG de la PWA MyLife à partir de web/public/favicon.svg (Chrome headless via playwright-core).
// Usage : node scripts/make-icons.mjs   (CHROME_PATH pour un autre navigateur)
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const svg = readFileSync(new URL('../web/public/favicon.svg', import.meta.url), 'utf8');
const executablePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();

async function render(file, size, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  // Icône « maskable » : fond plein et logo dans la zone de sécurité (80 %).
  const inner = maskable ? Math.round(size * 0.72) : size;
  const radius = maskable ? 0 : Math.round(size * 0.22);
  await page.setContent(`<html><body style="margin:0;background:${maskable ? '#0B0719' : 'transparent'};display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px;border-radius:${radius}px;overflow:hidden">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await page.screenshot({ path: `web/public/${file}`, omitBackground: !maskable });
  console.log('✓', file);
}

await render('pwa-192x192.png', 192);
await render('pwa-512x512.png', 512);
await render('maskable-512x512.png', 512, { maskable: true });
await render('apple-touch-icon.png', 180, { maskable: true });
// Raccourcis de l'app installée (appui long sur l'icône) : l'icône de chaque app.
for (const app of ['finances', 'perf', 'raveloc']) {
  const icon = readFileSync(new URL(`../web/public/${app}.svg`, import.meta.url), 'utf8');
  await page.setViewportSize({ width: 96, height: 96 });
  await page.setContent(`<html><body style="margin:0;width:96px;height:96px">${icon.replace('<svg ', '<svg width="96" height="96" ')}</body></html>`);
  await page.screenshot({ path: `web/public/shortcut-${app}.png`, omitBackground: true });
  console.log('✓', `shortcut-${app}.png`);
}
await browser.close();
