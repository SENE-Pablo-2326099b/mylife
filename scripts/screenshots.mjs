// Captures mobiles de chaque écran avec les données de démo, en thème sombre (Nuit) et clair (Perle),
// de 320 à 430 px de large, + contrôle des erreurs console, des débordements horizontaux, du clavier et du hors-ligne.
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

  const settle = async (ms = 900) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(ms);
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

  // Premier lancement : accueil guidé
  await page.goto(BASE + '/');
  await settle();
  await shot('00-bienvenue', { fullPage: false });
  await page.getByRole('button', { name: 'Continuer' }).click();
  await settle(500);
  await shot('00b-bienvenue-revenus', { fullPage: false });
  await page.getByRole('button', { name: 'Passer' }).click();
  await settle();
  await shot('00c-accueil-vide', { fullPage: false });

  // Données de démo
  await page.goto(BASE + '/reglages/donnees');
  await settle();
  await page.getByRole('button', { name: 'Charger la démo' }).click();
  await page.getByText('opérations de démo chargées').waitFor({ timeout: 15000 });
  await settle();

  const routes = [
    ['01-aujourdhui', '/'],
    ['02-budget', '/budget'],
    ['03-operations', '/operations'],
    ['04-patrimoine', '/patrimoine'],
    ['05-placement', '/patrimoine/placement/demo-p-pea'],
    ['06-previsions', '/previsions'],
    ['07-recurrents', '/recurrents'],
    ['08-independance', '/independance'],
    ['09-alertes', '/alertes'],
    ['10-a-classer', '/a-classer'],
    ['11-reglages', '/reglages'],
    ['12-budget-mensuel', '/reglages/budget'],
    ['13-apparence', '/reglages/apparence'],
    ['14-banques', '/synchro'],
    ['15-regles', '/reglages/regles'],
    ['16-categories', '/reglages/categories'],
    ['17-donnees', '/reglages/donnees'],
  ];

  const setTheme = async (name) => {
    await page.goto(BASE + '/reglages/apparence');
    await settle(400);
    await page.getByRole('radio', { name: new RegExp(`^Thème ${name}`) }).click();
    await settle(400);
  };

  for (const theme of ['Nuit', 'Perle']) {
    const t = theme.toLowerCase();
    await page.setViewportSize({ width: 390, height: 844 });
    await setTheme(theme);
    for (const [name, path] of routes) {
      await page.goto(BASE + path);
      await settle();
      await shot(`${t}-390-${name}`);
    }
    // Ce que l'on voit sans défiler, et la barre condensée au défilement
    await page.goto(BASE + '/');
    await settle();
    await shot(`${t}-390-01b-aujourdhui-ecran`, { fullPage: false });
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(600);
    await shot(`${t}-390-01c-barre-condensee`, { fullPage: false });

    // Feuille d'une opération
    await page.goto(BASE + '/operations');
    await settle();
    await page.locator('main button.hl').filter({ hasText: /€/ }).first().click();
    await page.waitForTimeout(700);
    await shot(`${t}-390-18-feuille-operation`, { fullPage: false });
    await page.keyboard.press('Escape');

    // Petits et grands téléphones
    for (const width of [320, 430]) {
      await page.setViewportSize({ width, height: width === 320 ? 640 : 932 });
      for (const [name, path] of routes) {
        await page.goto(BASE + path);
        await settle(500);
        await checkOverflow(`${t}-${width}-${name}`);
      }
      for (const [name, path] of [routes[0], routes[1], routes[3], routes[5]]) {
        await page.goto(BASE + path);
        await settle();
        await shot(`${t}-${width}-${name}`, { fullPage: false });
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme('Nuit');

  // Grand écran : barre latérale
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(BASE + '/patrimoine');
  await settle();
  await shot('nuit-1280-patrimoine', { fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });

  // File à classer : raccourci clavier
  await page.goto(BASE + '/a-classer');
  await settle();
  await page.keyboard.press('1');
  await page.waitForTimeout(600);
  await shot('19-a-classer-apres-raccourci', { fullPage: false });

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
  const offlineOk = await page.getByRole('heading', { name: 'Aujourd’hui' }).first().isVisible().catch(() => false);
  if (!offlineOk) problems.push('[pwa] l’app ne se recharge pas hors ligne');
  else console.log('✓ rechargement hors ligne');
  await context.setOffline(false);

  await browser.close();
} catch (e) {
  problems.push(`[script] ${e instanceof Error ? e.stack : e}`);
} finally {
  stop();
}

// Les requêtes vers le relais sans configuration Enable Banking (503) et le service worker en preview sont attendues.
const real = problems.filter((p) => !/status of 503|status of 401|Failed to load resource/.test(p));
if (real.length) {
  console.log('\nProblèmes détectés :');
  for (const p of real) console.log(' -', p);
  process.exitCode = 1;
} else {
  console.log('\nAucune erreur console, aucun débordement horizontal.');
}
