// Parcours de bout en bout sur la version construite (données de démo) : chaque écran s'ouvre sans erreur
// ni débordement à 320 et 390 px, et les parcours clés marchent (actions rapides, onglets du patrimoine,
// lanceur MyLife, indépendance financière, journal d'erreurs, relance hors ligne).
// Prérequis : `npm run build` (ou `npm run e2e`, qui le fait). CHROME_PATH pour un autre navigateur.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PORT = 4319;
const BASE = `http://localhost:${PORT}/finances`;
const executablePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
// Le serveur local de MyLife (accueil, apps construites, vraies API de compte sur une base en mémoire) :
// l'app exige un compte, qu'on crée ici comme un nouvel utilisateur. Lancé directement (pas via npx).
const ROOT = new URL('../../..', import.meta.url).pathname;
const server = spawn(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/local.ts'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(PORT) } });

const failures = [];
let passed = 0;
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    const why = e instanceof Error ? e.message.split('\n').slice(0, 3).join(' ') : String(e);
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

  // 1366 : la PWA sur un ordinateur (feuilles en panneau centré, souris).
  for (const width of [390, 320, 1366]) {
    console.log(`\n${width} px`);
    const context = await browser.newContext({ viewport: { width, height: width === 320 ? 640 : 844 }, colorScheme: width === 320 ? 'light' : 'dark', locale: 'fr-FR', hasTouch: width < 1000, isMobile: width < 1000 });
    context.setDefaultTimeout(10000);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`${page.url()} : ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${page.url()} : ${m.text()}`));
    // Compte et synchro passent par le vrai serveur local (base en mémoire) : l'appareil est relié au compte
    // neuf avant que l'app s'ouvre, puis la démo s'y charge (compte encore vide).
    const open = async (path) => {
      await page.goto(BASE + path);
      await page.locator('h1').first().waitFor({ timeout: 8000 });
      await page.waitForTimeout(400);
    };

    await step('nouvel utilisateur : seule la création de compte est possible', async () => {
      await page.goto(BASE + '/');
      await page.getByText('Crée ton compte').waitFor();
      expect((await page.getByRole('button', { name: 'Continuer' }).count()) === 0, 'l’app ne doit pas s’ouvrir sans compte');
      await page.getByLabel('Identifiant').fill(`test-e2e-${width}-${Date.now().toString(36)}`);
      await page.getByText('Libre').waitFor();
      await page.getByLabel('Mot de passe', { exact: true }).fill('cheval-Agrafe-2026');
      await page.getByRole('button', { name: 'Créer mon compte' }).click();
      await page.getByRole('button', { name: 'Continuer' }).waitFor();
    });

    await step('accueil puis démo chargée', async () => {
      await page.getByRole('button', { name: 'Continuer' }).click();
      // Étape suivante de l'accueil (animée) : on attend qu'elle soit là avant de la passer.
      await page.waitForTimeout(500);
      await page.getByRole('button', { name: 'Passer' }).click();
      await page.waitForURL((u) => !u.pathname.endsWith('/bienvenue'));
      await open('/reglages/donnees');
      await page.getByRole('button', { name: 'Charger la démo' }).click();
      await page.getByText('opérations de démo chargées').waitFor({ timeout: 20000 });
      // Personnage MyLife : MyFinances publie ses compteurs (jours sous le budget, par semaine ; jamais de montant).
      let stats = null;
      for (let i = 0; i < 30 && !stats; i++) {
        stats = await page.evaluate(() => JSON.parse(localStorage.getItem('mylife:stats:finances') ?? 'null'));
        if (!stats || !Object.keys(stats.weeks).length) {
          stats = null;
          await page.waitForTimeout(500);
        }
      }
      expect(stats !== null, 'compteurs du Personnage publiés');
      const keys = new Set(Object.values(stats.weeks).flatMap((w) => Object.keys(w)));
      expect([...keys].every((k) => ['under', 'tracked', 'saved'].includes(k)), `compteurs inattendus : ${[...keys]}`);
      expect(Object.values(stats.weeks).some((w) => (w.under ?? 0) > 0), 'des jours sous le budget');
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
      // Selon le jour et l'heure, la démo a déjà une dépense du jour (« Reste » ou « Dépassé aujourd'hui »), ou son
      // enveloppe est dépassée (libellés de OVERRUN_LABEL).
      await page.getByText(/(Reste|Dépassé) aujourd’hui|Au-delà de l’enveloppe|Manque d’ici la paie|Enveloppe dépassée/).first().waitFor();
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

    await step('détail du budget : l’épargne du cycle (prévue, versée) et l’argent réellement libre, sans débordement', async () => {
      await open('/');
      await page.locator('main#contenu button').filter({ hasText: /€/ }).first().click();
      const detail = page.getByRole('dialog', { name: 'Comment c’est calculé' });
      await detail.getByText('Épargne du cycle').waitFor();
      await detail.getByText(/prévus|versés/).first().waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow <= 1, `débordement horizontal de ${overflow} px`);
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/detail-budget-${width}.png`, fullPage: false });
      await page.keyboard.press('Escape');
      await detail.waitFor({ state: 'detached' });
    });

    await step('récurrents : une seule liste (réglages, plans, détectés), le détail dit d’où vient chaque ligne', async () => {
      await open('/recurrents');
      await page.getByRole('heading', { name: 'Revenus' }).waitFor();
      await page.locator('main#contenu button').filter({ hasText: /Réglages|Détecté|Plan/ }).first().click();
      const sheet = page.getByRole('dialog');
      await sheet.getByText('Ce cycle').waitFor();
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/recurrents-${width}.png` });
      await page.keyboard.press('Escape');
      await sheet.waitFor({ state: 'detached' });
    });

    await step('Aujourd’hui : opération ouverte depuis le détail du budget, reclassée, puis l’app reste utilisable', async () => {
      await open('/');
      await page.locator('main#contenu button').filter({ hasText: /€/ }).first().click();
      const detail = page.getByRole('dialog', { name: 'Comment c’est calculé' });
      await detail.waitFor();
      await detail.locator('button').filter({ hasText: /€/ }).first().click();
      const group = page.getByRole('group', { name: 'Choisir une catégorie' });
      await group.waitFor();
      await group.getByRole('button').nth(5).click();
      await page.getByRole('button', { name: 'Enregistrer' }).click();
      await page.getByText(/Classée en|reclassée/).first().waitFor();
      // Retour au détail du budget, qui se ferme normalement ; ensuite plus aucune couche ne capte les clics.
      await detail.waitFor();
      await page.keyboard.press('Escape');
      await detail.waitFor({ state: 'detached' });
      await page.waitForTimeout(400);
      const blocking = await page.evaluate(() => {
        const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        return el?.closest('.fixed.inset-0.z-50') ? el.className : null;
      });
      expect(blocking === null, `une couche capte encore les clics : ${blocking}`);
      expect((await page.evaluate(() => document.body.style.overflow)) === '', 'défilement resté bloqué');
      await page.locator('main#contenu button').filter({ hasText: /€/ }).first().click({ timeout: 3000 });
      await detail.waitFor();
      await page.keyboard.press('Escape');
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

    await step('action validée dans Copilot : MyFinances l’exécute à son ouverture (sauter un récurrent ce mois) et rend son annulation', async () => {
      await open('/');
      let card = null;
      for (let i = 0; i < 20 && !card?.recurring?.length; i++) {
        card = await page.evaluate(() => JSON.parse(localStorage.getItem('mylife:copilot:finances') ?? 'null'));
        if (!card?.recurring?.length) await page.waitForTimeout(300);
      }
      const item = card.recurring.find((r) => r.kind !== 'income' && !r.paidThisCycle && !r.skippedThisCycle);
      expect(item, 'un récurrent à sauter dans la fiche Copilot');
      await page.evaluate((id) => {
        localStorage.setItem('mylife:actions', JSON.stringify([{ id: `e2e-${id}`, app: 'finances', kind: 'finances.skipRecurring', summary: 'Sauter ce mois', params: { itemId: id, skip: true }, createdAt: Date.now(), status: 'pending' }]));
      }, item.id);
      await open('/recurrents');
      let action = null;
      for (let i = 0; i < 30 && action?.status !== 'done'; i++) {
        action = await page.evaluate(() => JSON.parse(localStorage.getItem('mylife:actions') ?? '[]')[0]);
        if (action?.status !== 'done') await page.waitForTimeout(300);
      }
      expect(action?.status === 'done', `action exécutée (${JSON.stringify(action)})`);
      expect(action.undo?.params?.skip === false, 'annulation fournie');
      await page.locator('main#contenu button').filter({ hasText: item.label }).filter({ hasText: 'Sauté ce mois' }).first().waitFor();
    });

    await step('navigation : Prévision et Récurrents en haut du Budget, Banques depuis Opérations, Réglages sans doublons', async () => {
      await open('/budget');
      await page.locator('main#contenu a[href$="/previsions"]').first().waitFor();
      await page.locator('main#contenu a[href$="/recurrents"]').first().waitFor();
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/budget-${width}.png` });
      await open('/operations');
      await page.getByRole('button', { name: 'Banques' }).click();
      await page.waitForURL((u) => u.pathname.endsWith('/synchro'));
      await open('/reglages');
      expect((await page.locator('main#contenu').getByText('Compte MyLife', { exact: true }).count()) === 0, 'le compte est dans les Espaces, pas dans les Réglages');
      expect((await page.locator('main#contenu a[href$="/synchro"]').count()) === 0, 'les banques ne sont plus dans les Réglages');
      await page.getByText('Seuils d’alerte').waitFor();
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

    await step('point de restauration : la démo supprimée revient', async () => {
      await open('/reglages/donnees');
      await page.getByRole('button', { name: 'Supprimer la démo' }).click();
      await page.getByText('Démo supprimée').first().waitFor();
      await page.getByText('Avant la suppression de la démo').waitFor();
      await page.getByRole('button', { name: 'Revenir ici' }).first().click();
      await page.getByRole('button', { name: 'Confirmer' }).click();
      await page.getByText(/Données revenues au/).waitFor();
      await page.getByRole('button', { name: 'Supprimer la démo' }).waitFor();
      // L'état d'avant le retour était vide : rien de plus à garder ; le point d'origine reste.
      await page.getByText('Avant la suppression de la démo').waitFor();
      expect((await page.getByText('Avant de revenir à un point de restauration').count()) === 0, 'point inutile d’une base vide');
    });

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
