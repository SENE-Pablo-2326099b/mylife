// Captures mobiles (390 px) de chaque écran avec les données de démo + détection des erreurs console.
// Prérequis : `npm run build`. Usage : node scripts/screenshots.mjs   (CHROME_PATH pour un autre navigateur)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 4317;
const BASE = `http://localhost:${PORT}`;
const executablePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
mkdirSync('screenshots', { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  env: { ...process.env, BRIDGE_PASSWORD: 'demo-password' },
  stdio: 'ignore',
});
const stop = () => server.kill('SIGTERM');

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Le serveur de preview ne répond pas');
}

const problems = [];
try {
  await waitForServer();
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', locale: 'fr-FR', hasTouch: true, isMobile: true });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`[console ${m.type()}] ${page.url()} : ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${page.url()} : ${e.message}`));

  const settle = async () => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
  };
  const checkOverflow = async (name) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) problems.push(`[layout] ${name} : débordement horizontal de ${overflow}px`);
  };
  const shot = async (name, opts = {}) => {
    await checkOverflow(name);
    await page.screenshot({ path: `screenshots/${name}.png`, fullPage: opts.fullPage ?? true });
    console.log('✓', name);
  };

  // Écran d'accueil vide
  await page.goto(BASE + '/');
  await settle();
  await shot('00-accueil-vide', { fullPage: false });

  // Chargement des données de démo
  await page.goto(BASE + '/reglages/donnees');
  await settle();
  await page.getByRole('button', { name: 'Charger des données de démo' }).click();
  await page.getByRole('status').waitFor();
  await settle();

  const routes = [
    ['01-aujourdhui', '/'],
    ['02-cycle', '/cycle'],
    ['03-operations', '/transactions'],
    ['04-alertes', '/alertes'],
    ['05-a-classer', '/a-classer'],
    ['06-synchro', '/synchro'],
    ['07-reglages', '/reglages'],
    ['08-regles', '/reglages/regles'],
    ['09-categories', '/reglages/categories'],
    ['10-reglages-alertes', '/reglages/alertes'],
    ['11-donnees', '/reglages/donnees'],
  ];
  for (const [name, path] of routes) {
    await page.goto(BASE + path);
    await settle();
    await shot(name);
  }

  // Premier écran (ce que l'on voit sans défiler) de l'accueil
  await page.goto(BASE + '/');
  await settle();
  await shot('01b-aujourdhui-ecran', { fullPage: false });

  // Édition d'une opération
  await page.goto(BASE + '/transactions');
  await settle();
  await page.locator('main ul li button').first().click();
  await page.waitForTimeout(400);
  await shot('12-edition-operation', { fullPage: false });
  await page.keyboard.press('Escape');

  // File à classer : raccourci clavier
  await page.goto(BASE + '/a-classer');
  await settle();
  await page.keyboard.press('1');
  await page.waitForTimeout(500);
  await shot('13-a-classer-apres-raccourci', { fullPage: false });

  // Navigation au clavier : le lien d'évitement doit être le premier élément focusable
  await page.goto(BASE + '/');
  await settle();
  await page.keyboard.press('Tab');
  const firstFocus = await page.evaluate(() => document.activeElement?.textContent?.trim());
  if (firstFocus !== 'Aller au contenu') problems.push(`[a11y] premier focus clavier : « ${firstFocus} »`);

  // Hors ligne : l'app doit se recharger depuis le service worker
  await page.goto(BASE + '/');
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 10000 }).catch(() => problems.push('[pwa] service worker non actif'));
  await context.setOffline(true);
  await page.reload();
  await settle().catch(() => {});
  const offlineOk = await page.getByText('Budget Dodge').first().isVisible().catch(() => false);
  if (!offlineOk) problems.push('[pwa] l’app ne se charge pas hors ligne');
  else await shot('14-hors-ligne', { fullPage: false });
  await context.setOffline(false);

  await browser.close();
} finally {
  stop();
}

// Les appels au relais sans clé Enable Banking renvoient 503 en local : ce n'est pas une erreur de l'app.
const real = problems.filter((p) => !/status of 503/.test(p));
if (real.length) {
  console.error('\nProblèmes détectés :\n' + real.join('\n'));
  process.exit(1);
}
console.log('\nAucune erreur console, aucun débordement horizontal.');
