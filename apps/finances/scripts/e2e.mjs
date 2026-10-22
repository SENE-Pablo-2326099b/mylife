// Parcours de bout en bout sur la version construite (données de démo) : chaque écran s'ouvre sans erreur
// ni débordement à 320 et 390 px, et les parcours clés marchent (actions rapides, onglets du patrimoine,
// lanceur MyLife, indépendance financière, journal d'erreurs, relance hors ligne).
// Prérequis : `npm run build` (ou `npm run e2e`, qui le fait). CHROME_PATH pour un autre navigateur.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PORT = 4319;
const BASE = `http://localhost:${PORT}/finances`;
const executablePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
// Vite lancé directement (pas via npx) : l'arrêt final le termine vraiment.
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });

const failures = [];
let passed = 0;
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    const why = e instanceof Error ? e.message.split('\n')[0] : String(e);
    failures.push(`${name} : ${why}`);
    console.log(`  ✗ ${name} — ${why}`);
  }
}
const expect = (ok, message) => {
  if (!ok) throw new Error(message);
};

const ROUTES = ['/', '/budget', '/operations', '/a-classer', '/alertes', '/patrimoine', '/patrimoine?vue=placements', '/patrimoine?vue=objectifs', '/patrimoine?vue=biens', '/independance', '/previsions', '/recurrents', '/synchro', '/reglages', '/reglages/profil', '/reglages/compte', '/reglages/budget', '/reglages/apparence', '/reglages/regles', '/reglages/categories', '/reglages/alertes', '/reglages/donnees'];

try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(BASE + '/')).ok) break;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const browser = await chromium.launch({ executablePath });

  for (const width of [390, 320]) {
    console.log(`\n${width} px`);
    const context = await browser.newContext({ viewport: { width, height: width === 320 ? 640 : 844 }, colorScheme: width === 320 ? 'light' : 'dark', locale: 'fr-FR', hasTouch: true, isMobile: true });
    context.setDefaultTimeout(10000);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`${page.url()} : ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()} : ${m.text()}`));
    const open = async (path) => {
      await page.goto(BASE + path);
      await page.locator('h1').first().waitFor({ timeout: 8000 });
      await page.waitForTimeout(400);
    };

    await step('accueil puis démo chargée', async () => {
      await page.goto(BASE + '/');
      await page.getByRole('button', { name: 'Continuer' }).click();
      // Étape suivante de l'accueil (animée) : on attend qu'elle soit là avant de la passer.
      await page.waitForTimeout(500);
      await page.getByRole('button', { name: 'Passer' }).click();
      await page.waitForURL((u) => !u.pathname.endsWith('/bienvenue'));
      await open('/reglages/donnees');
      await page.getByRole('button', { name: 'Charger la démo' }).click();
      await page.getByText('opérations de démo chargées').waitFor({ timeout: 20000 });
    });

    await step(`${ROUTES.length} écrans sans erreur ni débordement`, async () => {
      const bad = [];
      for (const r of ROUTES) {
        const before = errors.length;
        await open(r);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 0) bad.push(`${r} déborde de ${overflow}px`);
        if (errors.length > before) bad.push(`${r} : ${errors[before]}`);
      }
      expect(bad.length === 0, bad.join(' · '));
    });

    await step('Aujourd’hui : budget du jour et bloc « à faire »', async () => {
      await open('/');
      await page.getByText('Reste aujourd’hui', { exact: false }).first().waitFor();
      await page.getByText('À faire').first().waitFor();
    });

    await step('palette : « nouvel objectif » ouvre le formulaire', async () => {
      await page.keyboard.press('Control+k');
      await page.getByLabel('Chercher, aller, agir, demander').fill('nouvel objectif');
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Créer l’objectif' }).waitFor();
      // Le formulaire s'ouvre et l'adresse redevient celle de l'onglet (le retour arrière ne le rouvre pas).
      await page.waitForURL((u) => u.search === '?vue=objectifs');
    });

    await step('Patrimoine : l’onglet choisi survit au rechargement', async () => {
      await open('/patrimoine');
      await page.getByRole('radio', { name: 'Placements' }).or(page.getByRole('tab', { name: 'Placements' })).or(page.getByRole('button', { name: 'Placements', exact: true })).first().click();
      await page.waitForURL(/vue=placements/);
      await page.reload();
      await page.getByRole('button', { name: 'Ajouter' }).first().waitFor();
      expect(page.url().includes('vue=placements'), 'onglet perdu');
    });

    await step('changer la catégorie d’une opération : enregistré, feuille fermée, page libre', async () => {
      await open('/operations');
      for (let round = 0; round < 2; round++) {
        await page.locator('main#contenu').getByRole('button').filter({ hasText: /€/ }).nth(round).click();
        const group = page.getByRole('group', { name: 'Choisir une catégorie' });
        await group.waitFor();
        await group.getByRole('button').nth(3 + round).click();
        await page.getByRole('button', { name: 'Enregistrer' }).click();
        await group.waitFor({ state: 'detached' });
        await page.getByText(/Classée en|reclassée/).first().waitFor();
        const state = await page.evaluate(() => ({ lock: document.body.style.overflow, layers: document.querySelectorAll('.fixed.inset-0.z-50').length }));
        expect(state.lock === '' && state.layers === 0, `page restée bloquée : ${JSON.stringify(state)}`);
      }
    });

    await step('palette de commande : chercher une opération, aller à un écran', async () => {
      await open('/');
      if (width < 1000) await page.getByRole('button', { name: /Chercher, aller, agir/ }).click();
      else await page.keyboard.press('Control+k');
      await page.getByLabel('Chercher, aller, agir, demander').fill('indépendance');
      await page.keyboard.press('Enter');
      await page.waitForURL(/independance/);
      // Écran poussé : le dock est rangé, le raccourci clavier ouvre la palette de partout.
      await page.keyboard.press('Control+k');
      await page.getByLabel('Chercher, aller, agir, demander').fill('carrefour');
      await page.getByRole('option', { name: /Carrefour/ }).first().waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'Rechercher et agir' }).waitFor({ state: 'detached' });
    });

    await step('lanceur MyLife : apps et état des synchros', async () => {
      await open('/');
      await page.getByRole('button', { name: /Espaces MyLife/ }).first().click();
      await page.getByText('MyPerf', { exact: true }).waitFor();
      await page.getByText('Compte MyLife').waitFor();
      await page.keyboard.press('Escape');
    });

    await step('indépendance financière : simulateur pré-rempli, capital final, vivre de ce capital', async () => {
      await open('/independance?capital=10000&epargne=100&horizon=20');
      await page.getByText('Capital final', { exact: true }).waitFor();
      // 10 000 € + 100 €/mois, 20 ans au taux enregistré : le résultat suit les paramètres de l'adresse.
      await page.getByText(/après 20 ans/).waitFor();
      await page.getByText('Vivre de ce capital').waitFor();
      await page.getByRole('button', { name: 'Augmenter Horizon de placement' }).click();
      await page.waitForURL(/horizon=21/);
      await page.getByText(/après 21 ans/).waitFor();
    });

    await step('assistant : configuration de la clé proposée', async () => {
      await open('/assistant');
      await page.getByText('Connecter l’assistant').waitFor();
    });

    await step('journal d’erreurs visible et vide', async () => {
      await open('/reglages/donnees');
      await page.getByText('Aucune erreur enregistrée sur cet appareil.').waitFor();
    });

    if (width === 390) {
      await step('relance hors ligne', async () => {
        await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 10000 });
        await context.setOffline(true);
        await page.goto(BASE + '/');
        await page.getByRole('heading', { name: 'Aujourd’hui' }).first().waitFor({ timeout: 8000 });
        await context.setOffline(false);
      });
    }

    await step('aucune erreur console', async () => expect(errors.length === 0, errors.slice(0, 3).join(' · ')));
    await context.close();
  }
  await browser.close();
} finally {
  server.kill('SIGTERM');
}

console.log(`\n${passed} réussis, ${failures.length} en échec`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
