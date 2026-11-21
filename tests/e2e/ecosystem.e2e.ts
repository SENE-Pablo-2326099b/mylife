/**
 * MyLife de bout en bout, comme sur un téléphone : premier lancement, compte créé en un écran, puis
 * les trois apps sur la même adresse avec la même session, le même thème, la même installation ;
 * et sur un second appareil, le thème qui suit par la synchro chiffrée.
 * Prérequis : l'accueil (npm run build) et les trois apps construites (voir README).
 * CHROME_PATH pour un autre navigateur que /usr/bin/google-chrome ; SHOTS=dossier pour des captures.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { startLocalServer, type LocalServer } from '../../server/local';

const PORT = 4330;
let server: LocalServer;
let browser: Browser;
let phone: BrowserContext;
let page: Page;
const errors: string[] = [];
const LOGIN = 'test-e2e-mylife';
const PASSWORD = 'cheval-Agrafe-2026';
const shot = async (p: Page, name: string) => void (process.env.SHOTS && (await p.screenshot({ path: `${process.env.SHOTS}/${name}.png` })));

async function device(width = 390, height = 844): Promise<[BrowserContext, Page]> {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, locale: 'fr-FR', colorScheme: 'dark' });
  ctx.setDefaultTimeout(20_000);
  const p = await ctx.newPage();
  // « ViewTransition opt-in disabled » : note du navigateur quand on quitte l'ancienne app (transitions de page) pour la coquille.
  p.on('pageerror', (e) => !/ViewTransition opt-in disabled/.test(e.message) && errors.push(`${p.url()} : ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|favicon|ViewTransition opt-in disabled/.test(m.text()) && errors.push(`${p.url()} : ${m.text()}`));
  return [ctx, p];
}

const style = (p: Page) => p.evaluate(() => document.documentElement.dataset.style ?? null);
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

beforeAll(async () => {
  server = await startLocalServer({ port: PORT });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome' });
  [phone, page] = await device();
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('MyLife, une seule app', () => {
  it('nouvel utilisateur : dans chaque app, seul le compte est possible, et aucune donnée d’autrui n’apparaît', async () => {
    for (const path of ['/', '/finances/', '/perf/', '/raveloc/']) {
      const [ctx, fresh] = await device();
      await fresh.goto(`${server.url}${path}`);
      // L'accueil commence par une présentation, puis le même formulaire que les apps. L'ancienne adresse de
      // MyFinances (`/finances/`) est servie par la coquille, depuis le retrait de l'app d'avant.
      if (path === '/' || path === '/finances/') await fresh.getByRole('button', { name: 'Commencer' }).click();
      await fresh.getByText('Crée ton compte').waitFor({ timeout: 30_000 });
      await fresh.waitForTimeout(2500);
      const text = await fresh.evaluate(() => document.body.innerText);
      for (const leak of ['Jambes', 'Back squat', 'Démarrer la séance', 'Reste aujourd’hui', 'Semaine 2']) expect(text, `${path} : « ${leak} » visible sans compte`).not.toContain(leak);
      // Aucune donnée d'entraînement n'a été créée dans le navigateur.
      expect(await fresh.evaluate(() => localStorage.getItem('mylife-session')), path).toBeNull();
      await ctx.close();
    }
  });

  it('premier lancement : bienvenue, puis compte créé en un écran', async () => {
    await page.goto(`${server.url}/`);
    await page.getByText(/Tes finances, ton entraînement et tes sorties/).waitFor();
    await shot(page, '01-bienvenue');
    await page.getByRole('button', { name: 'Commencer' }).click();
    await page.getByLabel('Identifiant').fill(LOGIN);
    await page.getByText('Libre').waitFor();
    await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await shot(page, '02-creation');
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.getByText('Ta clé de secours').waitFor();
    await shot(page, '03-cle');
    await page.getByRole('button', { name: 'C’est fait, je l’ai mise de côté' }).click();
    await page.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    for (const name of ['MyFinances', 'MyPerf', 'MyRave']) await page.getByRole('main').getByText(name, { exact: true }).first().waitFor();
    await shot(page, '04-accueil');
  });

  it('une seule app installable : le même manifeste (portée /) relié par chaque page', async () => {
    const manifest = (await (await fetch(`${server.url}/manifest.webmanifest`)).json()) as { id: string; scope: string; shortcuts: { url: string }[]; screenshots: { src: string }[] };
    expect(manifest.id).toBe('/');
    expect(manifest.screenshots).toHaveLength(4);
    for (const s of manifest.screenshots) expect((await fetch(`${server.url}${s.src}`)).ok, s.src).toBe(true);
    expect(manifest.scope).toBe('/');
    expect(manifest.shortcuts.map((s) => s.url)).toEqual(['/argent', '/perf/', '/raveloc/']);
    for (const path of ['/', '/argent', '/finances/', '/perf/', '/raveloc/']) {
      const html = await (await fetch(`${server.url}${path}`)).text();
      const links = [...html.matchAll(/<link[^>]+rel="manifest"[^>]*>/g)].map((m) => m[0]);
      expect(links, path).toHaveLength(1);
      expect(links[0], path).toContain('href="/manifest.webmanifest"');
    }
  });

  it('depuis l’accueil, les deux apps d’avant qui restent se préparent en arrière-plan ; celle de MyFinances est désinscrite', async () => {
    await page.goto(`${server.url}/`);
    // Un appareil qui avait l'app MyFinances d'avant : son service worker est remplacé par celui qui la désinscrit.
    await page.evaluate(() => navigator.serviceWorker.register('/finances/sw.js', { scope: '/finances/' }));
    await page.reload();
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname).sort()), { timeout: 20_000, interval: 500 })
      .toEqual(['/', '/perf/', '/raveloc/']);
  });

  it('MyRave : déjà connecté (même session), même interface', async () => {
    await page.goto(`${server.url}/raveloc/`);
    await page.getByText('Aucun groupe pour l’instant').waitFor();
    expect(await page.getByText('Crée ton compte').count()).toBe(0);
    await shot(page, '05-raveloc');
  });

  it('MyFinances : l’app d’avant est retirée, ses anciennes adresses mènent au module', async () => {
    await page.goto(`${server.url}/finances/`);
    await page.waitForURL('**/argent');
    await page.goto(`${server.url}/finances/patrimoine/placements`);
    await page.waitForURL('**/argent/patrimoine');
    await shot(page, '06-finances');
  });

  it('MyPerf : déjà connecté, relié tout seul', async () => {
    await page.goto(`${server.url}/perf/account`);
    await page.getByText(LOGIN).first().waitFor({ timeout: 40_000 });
    await page.getByText(/Synchronisé/).first().waitFor({ timeout: 30_000 });
    await shot(page, '07-perf-compte');
    // MyPerf pose sa fiche pour Copilot (objectif de séances compris), une fois relié au compte.
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mylife:copilot:perf') ?? 'null')?.weeklyGoal ?? null), { timeout: 15_000, interval: 500 }).toBe(4);
  });

  it('MyPerf : importer un programme (texte collé, programme prêt), le retrouver, l’exporter', async () => {
    await page.goto(`${server.url}/perf/program-import`);
    await page.getByText('Avec ton IA, gratuite').waitFor({ timeout: 30_000 });
    // Le programme tel qu'on l'a dans ses notes : titres de séance, une ligne par exercice.
    await page.getByLabel('Programme à importer').fill('Mon PPL\nLundi – Push\nDC 4x6-8 @75% repos 2min\nPec deck 3x12\nJeudi – Pull\nTractions 3x max\nRowing barre 3x10');
    await page.getByText('Voir l’aperçu').click();
    await page.getByText('Programme collé (texte)').waitFor();
    // « DC » reconnu (Développé couché), « Pec deck » sera créé.
    await page.getByText('Développé couché', { exact: true }).waitFor();
    await page.getByText('Nouvel exercice : Pec deck').waitFor();
    await page.getByText(/4 exercices · 3 reconnus · 1 nouveau/).waitFor();
    await shot(page, '07b-import-apercu');
    await page.getByText('Importer 2 séances').click();
    await page.getByText('C’est prêt').waitFor();
    await page.getByText('Voir mes séances').click();
    await page.getByText('Lundi – Push').first().waitFor();
    await page.getByText('Jeudi – Pull').first().waitFor();
    await shot(page, '07c-import-planning');
    // Un programme prêt.
    await page.goto(`${server.url}/perf/program-import`);
    await page.getByText('Full body débutant').click();
    await page.getByText(/10 exercices · 10 reconnus/).waitFor();
    await page.getByText('Importer 2 séances').click();
    await page.getByText('C’est prêt').waitFor();
    // Export : un fichier au format d'échange, avec les séances importées.
    await page.goto(`${server.url}/perf/program-import`);
    // Tout en bas de la page : centré d'abord (sinon sous le dock).
    const exportButton = page.getByRole('button', { name: 'Exporter mon programme' });
    await exportButton.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const download = page.waitForEvent('download');
    await exportButton.click();
    const file = await download;
    const json = JSON.parse(readFileSync((await file.path())!, 'utf8')) as { format: string; sessions: { name: string }[] };
    expect(json.format).toBe('myperf-program');
    expect(json.sessions.map((s) => s.name)).toEqual(expect.arrayContaining(['Lundi – Push', 'Jeudi – Pull', 'Full body A', 'Full body B']));
  });

  it('un thème choisi dans les réglages habille les apps d’avant', async () => {
    await page.goto(`${server.url}/reglages`);
    await page.getByRole('button', { name: 'Clair', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('clair');
    await shot(page, '08-reglages-clair');
    for (const path of ['/raveloc/']) {
      await page.goto(`${server.url}${path}`);
      await page.waitForTimeout(800);
      expect(await page.evaluate(() => document.documentElement.dataset.scheme), path).toBe('light');
    }
    await shot(page, '09-finances-clair');
  });

  it('second appareil : connexion, et le thème suit (synchro chiffrée)', async () => {
    const [, other] = await device();
    await other.goto(`${server.url}/`);
    await other.getByRole('button', { name: 'J’ai déjà un compte' }).click();
    await other.getByLabel('Identifiant').fill(LOGIN);
    await other.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await other.getByRole('button', { name: 'Se connecter' }).click();
    await other.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    await expect.poll(() => other.evaluate(() => document.documentElement.dataset.theme), { timeout: 20_000, interval: 500 }).toBe('clair');
    await shot(other, '13-second-appareil');
  });

  it('Copilot : clé saisie, question, lecture des apps (Claude simulé), réponse ; fiches de contexte posées par les apps', async () => {
    // Les apps ont posé leurs fiches de contexte (sur l'appareil seulement).
    expect(await page.evaluate(() => localStorage.getItem('mylife:copilot:perf'))).toContain('weeklyGoal');
    const bodies: { messages: { role: string }[]; model: string }[] = [];
    await page.route('https://api.anthropic.com/**', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}');
      bodies.push(body);
      const first = bodies.length === 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: `msg_${bodies.length}`,
          type: 'message',
          role: 'assistant',
          model: body.model,
          stop_reason: first ? 'tool_use' : 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
          content: first ? [{ type: 'tool_use', id: 'toolu_1', name: 'get_overview', input: {} }] : [{ type: 'text', text: 'Belle semaine : tu es niveau ' + 'au-dessus de la moyenne.' }],
        }),
      });
    });
    await page.goto(`${server.url}/copilot`);
    await page.getByLabel('Clé API').fill('sk-ant-test-e2e');
    await page.getByRole('button', { name: 'Enregistrer la clé' }).click();
    await page.getByRole('button', { name: 'Résume ma semaine.' }).click();
    await page.getByText('Belle semaine : tu es niveau au-dessus de la moyenne.').waitFor({ timeout: 20_000 });
    await page.getByText('A lu : tes modules').waitFor();
    expect(bodies[0]!.model).toBe('claude-opus-5-5');
    // Le résultat de l'outil (la vue d'ensemble, lue sur l'appareil) part dans la deuxième requête.
    expect(JSON.stringify(bodies[1]!.messages)).toContain('cards');
    await shot(page, '13i-copilot');
    await page.unroute('https://api.anthropic.com/**');
    await page.evaluate(() => localStorage.removeItem('mylife:anthropic-key'));
  });

  it('Sortie : chaud ?, planning et set en cours, budget partagé, sac commun, carnet d’ID, hors ligne', async () => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const now = new Date();
    const later = new Date(now.getTime() + 2 * 86_400_000);
    const from = new Date(now.getTime() - 10 * 60_000);
    const to = new Date(now.getTime() + 50 * 60_000);
    await page.goto(`${server.url}/ancien/sorties`);
    await page.getByLabel('Quoi').fill('Festival test');
    await page.getByLabel('Où (facultatif)').fill('Quelque part');
    await page.getByLabel('Du').fill(iso(now));
    await page.getByLabel('Au').fill(iso(later));
    await page.getByRole('button', { name: 'Proposer et inviter' }).click();
    const linkText = page.getByText(/\/rejoindre#espace=/);
    await linkText.waitFor({ timeout: 20_000 });
    const link = (await linkText.textContent())!.trim();

    // L'ami (un nouveau compte) rejoint et répond « chaud ».
    const [friendCtx, friend] = await device();
    await friend.goto(`${server.url}/`);
    await friend.getByRole('button', { name: 'Commencer' }).click();
    await friend.getByLabel('Identifiant').fill(`${LOGIN}-ami`);
    await friend.getByText('Libre').waitFor();
    await friend.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await friend.getByRole('button', { name: 'Créer mon compte' }).click();
    await friend.getByRole('button', { name: 'C’est fait, je l’ai mise de côté' }).click();
    await friend.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    await friend.goto(link);
    await friend.getByText('Rejoindre « Festival test » ?').waitFor({ timeout: 20_000 });
    await friend.getByLabel('Ton pseudo pour cette sortie').fill('Bravo');
    await friend.getByRole('button', { name: 'Rejoindre' }).click();
    await friend.getByText('Toi, tu es…').waitFor();
    await friend.getByRole('radio', { name: 'Chaud' }).click();
    await friend.waitForTimeout(1500);
    await page.reload();
    await page.getByText(/Ça se fait · 2 chauds/).waitFor({ timeout: 20_000 });

    // Planning : le set qui se joue maintenant.
    await page.getByRole('radio', { name: 'Planning' }).click();
    await page.getByText('Ajouter un set').click();
    await page.getByLabel('Début').fill(`${pad(from.getHours())}:${pad(from.getMinutes())}`);
    await page.getByLabel('Fin').fill(`${pad(to.getHours())}:${pad(to.getMinutes())}`);
    await page.getByLabel('Scène').fill('Main');
    await page.getByLabel('Artiste').fill('DJ Test');
    await page.getByRole('button', { name: 'Ajouter le set' }).click();
    await page.waitForTimeout(1500);
    await friend.reload();
    await friend.getByRole('radio', { name: 'Planning' }).click();
    await friend.getByText('DJ Test').waitFor({ timeout: 20_000 });
    await friend.getByRole('button', { name: 'Y aller' }).click();
    await friend.waitForTimeout(1500);

    // Budget : l'ami paie 30 € pour tous.
    await friend.getByRole('radio', { name: 'Budget' }).click();
    await friend.getByText('Ajouter une dépense').click();
    await friend.getByLabel('Quoi').fill('Essence');
    await friend.getByLabel('Montant (€)').fill('30');
    await friend.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await friend.waitForTimeout(1500);
    await page.reload();
    await page.getByRole('radio', { name: 'Budget' }).click();
    await page.getByText(/doit\s+15,00\s?€/).waitFor({ timeout: 20_000 });
    await shot(page, '13d-sortie-budget');

    // Carnet d'ID : un toucher, le DJ en train de jouer est retrouvé grâce au planning.
    await page.getByRole('radio', { name: 'ID' }).click();
    await page.getByRole('button', { name: 'ID ?' }).click();
    await page.getByText('ID noté : DJ Test · Main').waitFor();

    // Hors ligne : l'ajout attend le réseau, puis part tout seul.
    await friend.getByRole('radio', { name: 'Sac' }).click();
    await friendCtx.setOffline(true);
    await friend.getByLabel('Ajouter à la liste').fill('Tente');
    await friend.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await friend.getByText(/1 en attente de réseau/).waitFor();
    await friendCtx.setOffline(false);
    await friend.evaluate(() => window.dispatchEvent(new Event('online')));
    await friend.getByText(/en attente de réseau/).waitFor({ state: 'detached', timeout: 20_000 });
    await page.reload();
    await page.getByRole('radio', { name: 'Sac' }).click();
    await page.getByText('Tente').waitFor({ timeout: 20_000 });
    await page.getByRole('radio', { name: 'Planning' }).click();
    await page.getByText('Bravo').first().waitFor();
    await shot(page, '13e-sortie-planning');
    await friendCtx.close();
  });

  it('320 px : aucun débordement horizontal, nulle part', async () => {
    const [, small] = await device(320, 640);
    await small.goto(`${server.url}/`);
    await small.getByRole('button', { name: 'J’ai déjà un compte' }).click();
    await small.getByLabel('Identifiant').fill(LOGIN);
    await small.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await small.getByRole('button', { name: 'Se connecter' }).click();
    await small.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    for (const path of ['/', '/modules', '/copilot', '/compte', '/reglages', '/installer', '/donnees', '/confidentialite', '/kit', '/argent', '/argent/operations', '/argent/plan', '/argent/patrimoine', '/argent/reglages', '/ancien/sorties', '/raveloc/', '/raveloc/groupes', '/perf/']) {
      await small.goto(`${server.url}${path}`);
      await small.waitForTimeout(1200);
      expect(await overflow(small), path).toBeLessThanOrEqual(0);
    }
  });

  it('même navigateur, autre compte : rien du précédent (données, clé d’IA, aperçus)', async () => {
    // Un premier compte, à lui (le compte principal des parcours suivants doit rester sans finances) ; il laisse des
    // traces : un compte dans MyFinances (synchronisé), sa clé d'IA.
    const first = `${LOGIN}-a`;
    await page.goto(`${server.url}/compte`);
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await page.getByRole('button', { name: 'Commencer' }).click();
    await page.getByLabel('Identifiant').fill(first);
    await page.getByText('Libre').waitFor();
    await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.getByRole('button', { name: 'C’est fait, je l’ai mise de côté' }).click();
    await page.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    await page.goto(`${server.url}/argent/patrimoine`);
    const begin = page.getByRole('button', { name: 'Commencer à la main' });
    const add = page.getByRole('button', { name: 'Ajouter un compte' });
    await begin.or(add).first().waitFor({ timeout: 30_000 });
    if (await begin.isVisible()) await begin.click();
    else {
      await add.click();
      await page.getByRole('dialog', { name: 'Ajouter' }).getByRole('button', { name: /^Un autre compte/ }).click();
    }
    await page.getByLabel('Nom').fill('Zébulon');
    await page.getByLabel('Solde ou valeur').fill('12');
    await page.getByRole('button', { name: 'Créer' }).click();
    await page.getByRole('button', { name: /^Quotidien|^Épargne|^Biens/ }).first().waitFor({ timeout: 30_000 });
    // Parti dans le compte avant la déconnexion (la file de synchro des réglages du moteur est vide).
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('mylife-queue-finances5') ?? '[]') as unknown[]).length === 0, undefined, { timeout: 30_000 });
    await page.evaluate(() => localStorage.setItem('mylife:anthropic-key', 'sk-ant-du-premier'));
    await page.goto(`${server.url}/compte`);
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await page.getByRole('button', { name: 'Commencer' }).click();
    // Un autre compte, dans le même navigateur.
    const other = `${LOGIN}-b`;
    await page.getByLabel('Identifiant').fill(other);
    await page.getByText('Libre').waitFor();
    await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.getByRole('button', { name: 'C’est fait, je l’ai mise de côté' }).click();
    await page.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    expect(await page.evaluate(() => localStorage.getItem('mylife:anthropic-key'))).toBeNull();
    await page.goto(`${server.url}/argent/patrimoine`);
    await page.getByRole('heading', { name: 'Patrimoine' }).waitFor();
    await page.waitForTimeout(1500);
    for (const family of await page.locator('.fin-family > button[aria-expanded="false"]').all()) await family.click();
    expect(await page.evaluate(() => document.body.innerText)).not.toContain('Zébulon');
    await shot(page, '14-autre-compte');
    // MyPerf : relié au nouveau compte, sans rien du précédent.
    await page.goto(`${server.url}/perf/account`);
    await page.getByText(other).first().waitFor({ timeout: 40_000 });
    await page.getByText(/Synchronisé/).first().waitFor({ timeout: 30_000 });
    // Le premier compte, lui, a toujours ses données : il les retrouve en se reconnectant ailleurs.
    const [, back] = await device();
    await back.goto(`${server.url}/`);
    await back.getByRole('button', { name: 'J’ai déjà un compte' }).click();
    await back.getByLabel('Identifiant').fill(first);
    await back.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await back.getByRole('button', { name: 'Se connecter' }).click();
    await back.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    await back.goto(`${server.url}/argent/patrimoine`);
    await back.locator('.fin-family > button').first().waitFor({ timeout: 30_000 });
    for (const family of await back.locator('.fin-family > button[aria-expanded="false"]').all()) await family.click();
    await back.getByRole('link', { name: /^Zébulon/ }).waitFor({ timeout: 30_000 });
  });

  it('navigateur avec des données d’avant tout compte : un compte neuf part de zéro', async () => {
    const [ctx, used] = await device();
    await used.goto(`${server.url}/`);
    await used.getByRole('button', { name: 'Commencer' }).waitFor();
    // Des opérations laissées par l'app d'avant, utilisée sans compte sur cet appareil.
    await used.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('myfinances', 20);
          open.onupgradeneeded = () => {
            for (const name of ['transactions', 'accounts', 'settings', 'meta']) if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name, { keyPath: name === 'meta' ? 'key' : 'id' });
          };
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction(['accounts', 'transactions'], 'readwrite');
            tx.objectStore('accounts').put({ id: 'orph', name: 'Compte Orphelin', bank: 'Banque', iban: null, currency: 'EUR', source: 'demo', connectionId: null, remoteUid: null, balance: 100, balanceDate: null, lastSyncAt: null, lastSyncError: null, hidden: false });
            tx.objectStore('transactions').put({ id: 'orph-1', accountId: 'orph', date: '2026-11-01', amount: -500, label: 'Achat Orphelin', currency: 'EUR' });
            tx.oncomplete = () => resolve(open.result.close());
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    await used.getByRole('button', { name: 'Commencer' }).click();
    const login = `${LOGIN}-c`;
    await used.getByLabel('Identifiant').fill(login);
    await used.getByText('Libre').waitFor();
    await used.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await used.getByRole('button', { name: 'Créer mon compte' }).click();
    await used.getByRole('button', { name: 'C’est fait, je l’ai mise de côté' }).click();
    await used.goto(`${server.url}/argent`);
    await used.getByRole('button', { name: 'Commencer à la main' }).waitFor({ timeout: 30_000 });
    await shot(used, '15-compte-neuf');
    expect(await used.evaluate(() => document.body.innerText)).not.toContain('Orphelin');
    await ctx.close();
  });

  it('Ta journée : l’agenda commun montre la sortie du jour sur l’accueil (autre appareil du compte)', async () => {
    // Un parcours précédent a connecté un autre compte dans la page principale : on revient avec le premier.
    const [ctx, p] = await device();
    await p.goto(`${server.url}/`);
    await p.getByRole('button', { name: 'J’ai déjà un compte' }).click();
    await p.getByLabel('Identifiant').fill(LOGIN);
    await p.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await p.getByRole('button', { name: 'Se connecter' }).click();
    await p.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    await p.getByText('Festival test', { exact: false }).first().waitFor({ timeout: 30_000 });
    await shot(p, '35-ta-journee');
    expect(await p.evaluate(() => Object.keys(localStorage))).toContain('mylife:agenda:home');
    await ctx.close();
  });

  it('ouverture au public : confidentialité lisible sans compte, support, export de mes données', async () => {
    // Sans compte : la page de confidentialité s'ouvre (pas de renvoi vers la bienvenue), liée depuis la bienvenue.
    const [anon, a] = await device();
    await a.goto(`${server.url}/`);
    await a.getByRole('link', { name: /ce que MyLife garde/i }).click();
    await a.getByRole('heading', { name: 'Tes données restent à toi' }).waitFor();
    expect(new URL(a.url()).pathname).toBe('/confidentialite');
    await a.getByText('Mentions légales').waitFor();
    await shot(a, '30-confidentialite');
    await a.getByRole('link', { name: 'Retour à l’accueil' }).click();
    await a.getByRole('button', { name: 'Commencer' }).waitFor();
    await anon.close();

    const [ctx, p] = await device();
    await p.goto(`${server.url}/`);
    await p.getByRole('button', { name: 'J’ai déjà un compte' }).click();
    await p.getByLabel('Identifiant').fill(LOGIN);
    await p.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await p.getByRole('button', { name: 'Se connecter' }).click();
    await p.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    // Compte → « Un problème, une idée ? » : envoyé, avec l'avertissement qu'il n'est pas chiffré.
    await p.goto(`${server.url}/donnees`);
    await p.getByText('Un problème, une idée ?').waitFor();
    await p.getByText(/n’est pas chiffré/).waitFor();
    const send = p.getByRole('button', { name: 'Envoyer' });
    expect(await send.isDisabled()).toBe(true);
    await p.getByLabel('Ton message').fill('Le bilan devrait montrer les records.');
    await send.click();
    await p.getByText('Message envoyé : merci !').waitFor();
    // Tes données (même écran) : l'export de la coquille est un JSON lisible, sans rien d'un autre compte.
    await p.getByRole('heading', { name: 'Tes données' }).waitFor();
    await shot(p, '31-tes-donnees');
    const download = p.waitForEvent('download');
    await p.getByRole('button', { name: 'Exporter' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^mylife-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(readFileSync((await file.path())!, 'utf8')) as { format: string; account: string; theme: string };
    expect(data).toMatchObject({ format: 'mylife-export', account: LOGIN });
    expect(['auto', 'sombre', 'clair']).toContain(data.theme);
    // L'archive des fonctions retirées (V5) : lue dans le compte et déchiffrée sur l'appareil.
    const archived = p.waitForEvent('download');
    await p.getByRole('button', { name: 'Télécharger l’archive' }).click();
    const archive = await archived;
    expect(archive.suggestedFilename()).toMatch(/^mylife-archive-\d{4}-\d{2}-\d{2}\.json$/);
    const arch = JSON.parse(readFileSync((await archive.path())!, 'utf8')) as { format: string; account: string; account_data: Record<string, unknown[]>; errors: Record<string, string> };
    expect(arch).toMatchObject({ format: 'mylife-archive-v5', account: LOGIN, errors: {} });
    expect(Object.keys(arch.account_data).sort()).toEqual(['calendrier', 'chef', 'miniapps', 'mylife', 'objectifs']);
    await ctx.close();
  });

  it('coquille V5 (/v5/) : même compte, cartes des modules, module éteint qui disparaît, ajout rapide, thème, 320 px', async () => {
    const [ctx, p] = await device();
    // Sans compte : la coquille renvoie vers la connexion.
    await p.goto(`${server.url}/`);
    await p.getByRole('button', { name: 'Commencer' }).waitFor();
    await p.getByRole('button', { name: 'J’ai déjà un compte' }).click();
    await p.getByLabel('Identifiant').fill(LOGIN);
    await p.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await p.getByRole('button', { name: 'Se connecter' }).click();
    await p.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    // Les apps déposent leur aperçu sur l'appareil : la coquille le lit.
    await p.evaluate(() => {
      localStorage.setItem('mylife:glance:finances', JSON.stringify({ title: '25,35 € à dépenser aujourd’hui', detail: 'Dans le budget', at: Date.now() }));
      localStorage.setItem('mylife:glance:perf', JSON.stringify({ title: 'Jambes', detail: '5 exercices', at: Date.now() }));
    });
    await p.goto(`${server.url}/`);
    await p.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    await p.getByText('25,35 €', { exact: true }).waitFor();
    await p.getByText('Jambes', { exact: true }).waitFor();
    // La carte MyPerf s'ouvre d'un toucher n'importe où, comme les autres.
    await p.getByRole('link', { name: 'Ouvrir MyPerf' }).waitFor();
    await shot(p, '40-v5-aujourdhui');
    await p.evaluate(() => (document.documentElement.dataset.glass = 'prononce'));
    await shot(p, '40b-v5-aujourdhui-prononce');
    await p.evaluate(() => (document.documentElement.dataset.glass = 'subtil'));
    // Ajout rapide : une saisie par module allumé.
    await p.getByRole('button', { name: 'Ajouter' }).click();
    await p.getByRole('dialog', { name: 'Ajouter' }).getByText('Une dépense').waitFor();
    await p.waitForTimeout(400);
    await shot(p, '41-v5-ajout');
    await p.keyboard.press('Escape');
    // Modules : un module éteint n'apparaît plus nulle part ; le choix tient après rechargement.
    await p.getByRole('link', { name: 'Modules' }).click();
    await p.getByRole('switch', { name: 'MyPerf : allumé' }).click();
    await shot(p, '42-v5-modules');
    await p.goto(`${server.url}/`);
    await p.getByText('25,35 €', { exact: true }).waitFor();
    expect(await p.getByText('Jambes', { exact: true }).count()).toBe(0);
    await p.getByRole('button', { name: 'Ajouter' }).click();
    expect(await p.getByRole('dialog', { name: 'Ajouter' }).getByText('Une séance').count()).toBe(0);
    await p.keyboard.press('Escape');
    // Réglages : le thème clair s'applique tout de suite.
    await p.goto(`${server.url}/reglages`);
    await p.getByRole('button', { name: 'Clair', exact: true }).click();
    expect(await p.evaluate(() => document.documentElement.dataset.theme)).toBe('clair');
    await shot(p, '43-v5-reglages-clair');
    // L'effet de verre se règle : subtil par défaut, prononcé ou sobre au choix, gardé sur l'appareil.
    expect(await p.evaluate(() => document.documentElement.dataset.glass)).toBe('subtil');
    await p.getByRole('button', { name: 'Prononcé', exact: true }).click();
    expect(await p.evaluate(() => document.documentElement.dataset.glass)).toBe('prononce');
    await shot(p, '43b-v5-reglages-clair-prononce');
    // Une seule lumière pour tout l'écran : elle suit la souris (ou l'inclinaison du téléphone), et les arêtes avec.
    const angle = () => p.evaluate(() => document.documentElement.style.getPropertyValue('--la'));
    await p.mouse.move(20, 300);
    await p.waitForTimeout(400);
    const left = await angle();
    await p.mouse.move(370, 300);
    await expect.poll(angle).not.toBe(left);
    // La barre du bas, posée bas : à 10 px du bord sans marge système, et pas plus haute que 64 px.
    const bar = await p.locator('nav.tabbar').boundingBox();
    expect(bar && [Math.round(844 - bar.y - bar.height), Math.round(bar.height)]).toEqual([10, 64]);
    await p.reload();
    expect(await p.evaluate(() => document.documentElement.dataset.glass)).toBe('prononce');
    await p.getByRole('button', { name: 'Subtil', exact: true }).click();
    expect(await p.evaluate(() => document.documentElement.dataset.glass)).toBe('subtil');
    await p.goto(`${server.url}/kit`);
    await p.getByRole('heading', { name: 'Le kit' }).waitFor();
    await shot(p, '44-v5-kit-clair');
    await ctx.close();
    const [, small] = await device(320, 640);
    await small.goto(`${server.url}/`);
    await small.getByRole('button', { name: 'J’ai déjà un compte' }).click();
    await small.getByLabel('Identifiant').fill(LOGIN);
    await small.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await small.getByRole('button', { name: 'Se connecter' }).click();
    await small.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    for (const path of ['/', '/modules', '/reglages', '/kit']) {
      await small.goto(`${server.url}${path}`);
      await small.waitForTimeout(600);
      expect(await overflow(small), path).toBeLessThanOrEqual(0);
    }
  });

  it('coquille V5 : compte créé en un écran et clé de secours, Copilot (Claude simulé), données et archive, confidentialité sans compte, déconnexion', async () => {
    const [ctx, p] = await device();
    const who = `${LOGIN}-v5`;
    // Sans compte : bienvenue, et la confidentialité reste lisible.
    await p.goto(`${server.url}/reglages`);
    await p.getByRole('button', { name: 'Commencer' }).waitFor();
    await p.goto(`${server.url}/confidentialite`);
    await p.getByRole('heading', { name: 'Tes données restent à toi' }).waitFor();
    await p.goto(`${server.url}/bienvenue`);
    await shot(p, '50-v5-bienvenue');
    await p.getByRole('button', { name: 'Commencer' }).click();
    await p.getByLabel('Identifiant').fill(who);
    await p.getByText('Libre').waitFor();
    await p.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    // Un seul gabarit : champs et bouton à la même hauteur (le mot de passe aussi, malgré son bouton « œil »).
    const heights = await p.evaluate(() => [...document.querySelectorAll('form input, form button[type="submit"]')].map((el) => Math.round(el.getBoundingClientRect().height)));
    expect(new Set(heights)).toEqual(new Set([48]));
    await p.getByRole('button', { name: 'Afficher le mot de passe' }).click();
    expect(await p.getByLabel('Mot de passe', { exact: true }).getAttribute('type')).toBe('text');
    await p.getByRole('button', { name: 'Cacher le mot de passe' }).click();
    await shot(p, '51-v5-creation');
    await p.getByRole('button', { name: 'Créer mon compte' }).click();
    await p.getByText('Ta clé de secours').waitFor();
    await shot(p, '52-v5-cle');
    await p.getByRole('button', { name: 'Plus tard' }).click();
    await p.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    // La clé n'est pas mise de côté : le rappel reste, jusqu'à « C'est fait ».
    await p.getByRole('button', { name: /Mets de côté ta clé de secours/ }).click();
    await p.getByRole('button', { name: 'C’est fait, je l’ai mise de côté' }).click();
    expect(await p.getByText('Mets de côté ta clé de secours').count()).toBe(0);
    // Copilot, Claude simulé : la vue d'ensemble est lue sur l'appareil.
    const bodies: { model: string }[] = [];
    await p.route('https://api.anthropic.com/**', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}');
      bodies.push(body);
      const first = bodies.length === 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: `msg_${bodies.length}`, type: 'message', role: 'assistant', model: body.model, stop_reason: first ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: first ? [{ type: 'tool_use', id: 'toolu_1', name: 'get_overview', input: {} }] : [{ type: 'text', text: 'Rien à signaler cette semaine.' }] }) });
    });
    await p.getByRole('link', { name: 'Copilot' }).click();
    await p.getByLabel('Clé API').fill('sk-ant-test-e2e');
    await p.getByRole('button', { name: 'Enregistrer la clé' }).click();
    await p.getByRole('button', { name: 'Résume ma semaine.' }).click();
    await p.getByText('Rien à signaler cette semaine.').waitFor({ timeout: 20_000 });
    await p.getByText('A lu : tes modules').waitFor();
    expect(bodies[0]!.model).toBe('claude-opus-5-5');
    await shot(p, '53-v5-copilot');
    // La conversation est gardée : elle porte le titre de la question et rejoint l'historique.
    await p.getByRole('heading', { name: 'Résume ma semaine.' }).waitFor();
    // Une nouvelle conversation, dans le domaine Finances : le domaine part avec la question.
    await p.getByRole('button', { name: 'Nouvelle' }).click();
    await p.getByRole('group', { name: 'Domaine de la conversation' }).getByRole('button', { name: 'Finances' }).click();
    await p.getByLabel('Ta question').fill('Mon budget tient ?');
    await p.getByRole('button', { name: 'Demander', exact: true }).click();
    await p.getByRole('heading', { name: 'Mon budget tient ?' }).waitFor({ timeout: 20_000 });
    expect(JSON.stringify(bodies[bodies.length - 1])).toContain('Conversation sur les finances');
    // L'historique : deux conversations, rangées par domaine ; en rouvrir une ; en supprimer une.
    await p.getByRole('button', { name: /^Historique/ }).click();
    await p.getByRole('heading', { name: 'Conversations' }).waitFor();
    await p.getByRole('button', { name: /^Résume ma semaine\./ }).waitFor();
    await shot(p, '53b-v5-copilot-historique');
    await p.getByRole('button', { name: 'Supprimer « Mon budget tient ? »' }).click();
    await p.getByRole('button', { name: 'Supprimer', exact: true }).click();
    expect(await p.getByRole('button', { name: /^Mon budget tient/ }).count()).toBe(0);
    await p.getByRole('button', { name: /^Résume ma semaine\./ }).click();
    await p.getByText('Rien à signaler cette semaine.').waitFor();
    // Les conversations suivent sur un autre appareil du compte (chiffrées) ; la clé d'API, elle, reste ici.
    await p.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem('mylife:app:copilot:dirty') ?? '{}')).length === 0, undefined, { timeout: 20_000 });
    const [ctxB, pB] = await device();
    await pB.goto(`${server.url}/`);
    await pB.getByRole('button', { name: 'J’ai déjà un compte' }).click();
    await pB.getByLabel('Identifiant').fill(who);
    await pB.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await pB.getByRole('button', { name: 'Se connecter' }).click();
    await pB.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    await pB.goto(`${server.url}/copilot`);
    await pB.getByLabel('Clé API').waitFor();
    await pB.getByRole('button', { name: /^Historique \(1\)/ }).click({ timeout: 20_000 });
    await pB.getByRole('button', { name: /^Résume ma semaine\./ }).waitFor();
    await ctxB.close();
    // Un module ouvre Copilot avec une question préparée, à relire avant l'envoi.
    await p.goto(`${server.url}/copilot?domaine=sport&q=${encodeURIComponent('Quelle séance aujourd’hui ?')}`);
    // Le champ se remplit une fois l'écran prêt : on attend la valeur au lieu de la lire tout de suite (cause de
    // l'instabilité notée au journal).
    await expect.poll(() => p.getByLabel('Ta question').inputValue()).toBe('Quelle séance aujourd’hui ?');
    await expect.poll(() => p.getByRole('group', { name: 'Domaine de la conversation' }).getByRole('button', { name: 'Sport' }).getAttribute('aria-pressed')).toBe('true');
    await p.unroute('https://api.anthropic.com/**');
    // Données : export et archive ; support.
    await p.goto(`${server.url}/donnees`);
    const dl = p.waitForEvent('download');
    await p.getByRole('button', { name: 'Exporter' }).click();
    expect((await dl).suggestedFilename()).toMatch(/^mylife-\d{4}-\d{2}-\d{2}\.json$/);
    const arch = p.waitForEvent('download');
    await p.getByRole('button', { name: 'Télécharger l’archive' }).click();
    const a = JSON.parse(readFileSync((await (await arch).path())!, 'utf8')) as { format: string; account: string; errors: Record<string, string> };
    expect(a).toMatchObject({ format: 'mylife-archive-v5', account: who, errors: {} });
    await p.getByLabel('Ton message').fill('Un essai depuis la V5.');
    await p.getByRole('button', { name: 'Envoyer' }).click();
    await p.getByText('Message envoyé : merci !').waitFor();
    await shot(p, '54-v5-donnees');
    // Compte : déconnexion → bienvenue, et la clé d'IA ne reste pas.
    await p.goto(`${server.url}/compte`);
    await shot(p, '55-v5-compte');
    await p.getByRole('button', { name: 'Se déconnecter' }).click();
    await p.getByRole('button', { name: 'Commencer' }).waitFor();
    expect(await p.evaluate(() => localStorage.getItem('mylife-session'))).toBeNull();
    await ctx.close();
  });

  it('MyFinances V5 : « pourquoi ce chiffre », les données de l’ancienne app passées dans le moteur', async () => {
    const [ctx, p] = await device();
    await p.goto(`${server.url}/`);
    await p.getByRole('button', { name: 'J’ai déjà un compte' }).click();
    await p.getByLabel('Identifiant').fill(LOGIN);
    await p.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await p.getByRole('button', { name: 'Se connecter' }).click();
    await p.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    // Rien sur l'appareil ni dans le compte : le premier lancement propose de relier une banque ou de commencer à la main.
    await p.goto(`${server.url}/argent/moteur`);
    await p.getByText('Bienvenue dans MyFinances').waitFor();
    // La synchro entre appareils a relié cet appareil (compte vide) : elle ne viendra plus remplacer ce qui suit.
    await p.waitForFunction(() => ['mylife-sync-finances', 'mylife-sync-finances5'].every((k) => !!(JSON.parse(localStorage.getItem(k) ?? 'null') as { joinedAs?: string } | null)?.joinedAs));
    // Une ancienne base (fictive) : deux comptes, quatre opérations, un revenu et une charge prévus.
    const today = await p.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    await p.evaluate(
      (date) =>
        new Promise<void>((resolve, reject) => {
          // La base des faits existe déjà (le module l'a créée, au format de l'ancienne app).
          const open = indexedDB.open('myfinances');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction(['transactions', 'accounts', 'categories', 'settings'], 'readwrite');
            const put = (store: string, row: unknown) => tx.objectStore(store).put(row);
            put('accounts', { id: 'acc', name: 'Compte courant', bank: 'Banque', balance: 120000, kind: 'current' });
            put('accounts', { id: 'liv', name: 'Livret', bank: 'Banque', balance: 300000, kind: 'savings' });
            put('categories', { id: 'courses', name: 'Courses', kind: 'variable', order: 0 });
            put('categories', { id: 'revenus', name: 'Revenus', kind: 'income', order: 1 });
            put('categories', { id: 'transferts', name: 'Transferts internes', kind: 'excluded', order: 2 });
            put('transactions', { id: 't1', accountId: 'acc', date, amount: -1250, label: 'CB EPICERIE DU COIN 1234', categoryId: 'courses' });
            put('transactions', { id: 't2', accountId: 'acc', date, amount: -3000, label: 'BOULANGERIE DES HALLES', categoryId: null });
            put('transactions', { id: 't3', accountId: 'acc', date, amount: -10000, label: 'VIR VERS LIVRET', categoryId: 'transferts' });
            put('transactions', { id: 't4', accountId: 'acc', date, amount: 200000, label: 'VIR EMPLOYEUR', categoryId: 'revenus' });
            put('settings', { id: 'main', payday: 1, incomes: [{ id: 'i', label: 'Salaire', amount: 200000, day: 1 }], fixedCharges: [{ id: 'c', label: 'Loyer', amount: 70000, day: 3 }] });
            tx.oncomplete = () => (open.result.close(), resolve());
            tx.onerror = () => reject(tx.error);
          };
        }),
      today,
    );
    await p.reload();
    await p.getByRole('heading', { name: 'Pourquoi ce chiffre' }).waitFor();
    // Budget théorique : 2 000 − 700 = 1 300 de reste à vivre ; 42,50 dépensés (dont 30 à classer, comptés).
    const term = (label: string) => p.locator('.list-row', { hasText: label }).first();
    const shows = (label: string, value: RegExp) => expect.poll(() => term(label).innerText(), { timeout: 8000 }).toMatch(value);
    await shows('Reste à vivre', /1\s300\s€/);
    await shows('Déjà dépensé', /42,50\s€/);
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    // Trésorerie : 1 200 sur le compte du quotidien. Le loyer, prélèvement récurrent, n'est pas réservé par défaut :
    // il ne touchera la trésorerie qu'à son débit réel.
    await shows('Comptes du quotidien', /1\s200\s€/);
    await shows('Échéances réservées', /\n0\s€/);
    await shows('Cash libre', /1\s200\s€/);
    await p.getByText(/Limité par ta trésorerie/).waitFor();
    await shows('Disponible à minuit', /1\s242,50\s€/);
    // Réserver le loyer, par choix sur cet engagement : il est déduit dès maintenant.
    const loyer = p.getByRole('button', { name: /Loyer/ }).first();
    await loyer.click();
    await p.getByRole('button', { name: 'Modifier l’engagement' }).click();
    await p.getByRole('switch', { name: 'Réserver dans la trésorerie' }).click();
    await p.getByRole('button', { name: 'Enregistrer' }).click();
    await shows('Échéances réservées', /700\s€/);
    await shows('Cash libre', /500\s€/);
    // En partie versée : 300 € déjà sortis, il n'en reste que 400 à payer.
    await loyer.click();
    await p.getByLabel('Déjà versé').fill('300');
    await p.getByRole('button', { name: 'Enregistrer' }).click();
    await shows('Échéances réservées', /400\s€/);
    await shows('Cash libre', /800\s€/);
    // Une poche de 150 € liée au loyer : verrouillée, et déduite une seule fois (le cash libre ne bouge pas).
    await p.locator('button.link', { hasText: 'Ajouter' }).nth(1).click();
    await p.getByLabel('Nom').fill('Réserve loyer');
    await p.getByLabel('Montant verrouillé').fill('150');
    await p.getByLabel('Elle couvre').selectOption('chg:c');
    await p.getByRole('button', { name: 'Enregistrer' }).click();
    await shows('Poches verrouillées', /150\s€/);
    await shows('Échéances réservées', /250\s€/);
    await shows('Cash libre', /800\s€/);
    // Un achat de 400 € en 4 fois, dont une payée : l'échéance du cycle (100 €) pèse sur ce cycle, et elle seule.
    await p.getByRole('button', { name: 'Paiement en plusieurs fois' }).click();
    await p.getByLabel('Achat').fill('Vélo');
    await p.getByLabel('Montant total').fill('400');
    await p.getByText(/3 échéances de 100\s€ à venir/).waitFor();
    await p.getByRole('button', { name: 'Créer' }).click();
    await shows('Charges prévues', /800\s€/);
    await shows('Reste à vivre', /1\s200\s€/);
    await shows('Échéances réservées', /350\s€/);
    await shows('Cash libre', /700\s€/);
    await p.getByText('Paiements fractionnés restants').waitFor();
    // Lisser la dépense de 30 € : elle ne pèse plus sur la seule journée.
    await p.getByRole('button', { name: /BOULANGERIE DES HALLES/ }).click();
    await p.getByRole('switch', { name: 'Lisser sur le reste du cycle' }).click();
    await p.getByRole('button', { name: 'Fermer', exact: true }).last().click();
    await shows('Dépensé aujourd’hui', /12,50\s€/);
    await shot(p, '60-finances-v5-moteur');
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    // Tout tient après rechargement, et quand les données sont relues depuis l'ancienne app.
    await p.reload();
    await shows('Cash libre', /700\s€/);
    await p.getByRole('button', { name: 'Relire mes données' }).click();
    await shows('Cash libre', /700\s€/);
    await shows('Dépensé aujourd’hui', /12,50\s€/);
    await p.getByRole('button', { name: /Réserve loyer/ }).waitFor();
    // ---- M3. À classer, par marchand : la nature d'abord, puis la catégorie ; tout le marchand suit.
    await p.getByRole('button', { name: /Boulangerie Des Halles/ }).click();
    await p.getByLabel('Catégorie').selectOption('courses');
    await p.getByRole('button', { name: 'Classer' }).click();
    await p.getByText(/À classer :/).waitFor({ state: 'detached' });
    // Une avance : 5 € des 12,50 € de l'épicerie payés pour quelqu'un. Ils sortent du budget et restent dus.
    await p.getByRole('button', { name: /CB EPICERIE DU COIN/ }).click();
    await p.getByLabel('Pour qui').fill('Camille');
    await p.getByLabel('Sa part').fill('5');
    await p.getByRole('button', { name: 'Ajouter cette avance' }).click();
    await p.getByRole('button', { name: 'Terminé' }).click();
    await shows('Déjà dépensé', /37,50\s€/);
    await p.getByText(/À récupérer : 5\s€/).waitFor();
    // Un virement interne arrive par la banque, en deux opérations non classées : il est apparié tout seul, et
    // comme il va vers l'épargne, c'est une mise de côté (50 €), pas une dépense.
    await p.evaluate(
      (date) =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('myfinances');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction(['transactions'], 'readwrite');
            tx.objectStore('transactions').put({ id: 'ta', accountId: 'acc', date, amount: -5000, label: 'VIR SEPA INTERNE', categoryId: null });
            tx.objectStore('transactions').put({ id: 'tb', accountId: 'liv', date, amount: 5000, label: 'VERSEMENT', categoryId: null });
            tx.oncomplete = () => (open.result.close(), resolve());
            tx.onerror = () => reject(tx.error);
          };
        }),
      today,
    );
    await p.getByRole('button', { name: 'Relire mes données' }).click();
    await p.getByText('Virements internes appariés').waitFor();
    await shows('Épargne', /50\s€/);
    await shows('Déjà dépensé', /37,50\s€/);
    // L'avance ne sera pas remboursée : la part redevient une dépense.
    await p.getByRole('button', { name: /^Camille/ }).click();
    await p.getByRole('button', { name: 'Je ne le reverrai pas' }).click();
    await shows('Déjà dépensé', /42,50\s€/);
    await shot(p, '61-finances-v5-automatismes');
    // ---- M4. Les réglages : tout ce qui structure le calcul se change ici.
    await p.getByRole('link', { name: 'Réglages de MyFinances' }).click();
    await p.getByRole('heading', { name: 'Réglages' }).waitFor();
    // Un sommaire en rubriques ; chaque rubrique ouvre un écran court, et son retour ramène au sommaire.
    const section = async (name: RegExp, title: string) => {
      await p.getByRole('link', { name }).click();
      await p.getByRole('heading', { name: title }).waitFor();
    };
    const home = async () => {
      await p.getByRole('link', { name: 'Retour', exact: true }).click();
      await p.getByRole('heading', { name: 'Réglages' }).waitFor();
    };
    const add = () => p.getByRole('button', { name: 'Ajouter' }).click();
    await section(/^Cycle et calcul/, 'Cycle et calcul');
    await p.getByLabel('Jour de paie').waitFor();
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    await home();
    // Un compte tenu à la main : 40 € d'espèces, comptés dans le cash quotidien par leur rôle.
    await section(/^Comptes/, 'Comptes');
    await add();
    await p.getByLabel('Nom').fill('Portefeuille');
    await p.getByLabel('Solde ou valeur').fill('40');
    await p.getByRole('button', { name: 'Créer' }).click();
    await p.getByRole('button', { name: /^Portefeuille.*Espèces · cash quotidien · tenu à la main/ }).waitFor();
    // Le rôle d'un compte est un réglage : le livret entre dans le cash quotidien, puis en ressort.
    const livret = p.getByRole('button', { name: /^Livret/ });
    await livret.click();
    await p.getByRole('switch', { name: 'Dans le cash quotidien' }).click();
    await p.getByRole('button', { name: 'Terminé' }).click();
    await p.getByRole('button', { name: /^Livret.*cash quotidien/ }).waitFor();
    await livret.click();
    await p.getByRole('switch', { name: 'Dans le cash quotidien' }).click();
    await p.getByRole('button', { name: 'Terminé' }).click();
    await home();
    // Les catégories ont leur écran, en tête du sommaire. Deux niveaux : « Pain » sous « Courses ».
    await p.getByRole('link', { name: /^Catégories/ }).click();
    await p.getByRole('heading', { name: 'Catégories' }).waitFor();
    await p.getByRole('button', { name: 'Ajouter' }).click();
    await p.getByLabel('Nom').fill('Pain');
    await p.getByLabel('Sous-catégorie de').selectOption('courses');
    await p.getByRole('button', { name: 'Enregistrer' }).click();
    await p.getByRole('button', { name: /^Pain.*jamais utilisée/ }).waitFor();
    // Une catégorie qui ne sert à rien se supprime ; une catégorie qui sert, non (fusionner ou archiver).
    await p.getByRole('button', { name: 'Ajouter' }).click();
    await p.getByLabel('Nom').fill('Éphémère');
    await p.getByRole('button', { name: 'Enregistrer' }).click();
    await p.getByRole('button', { name: /^Éphémère/ }).click();
    await p.getByRole('button', { name: 'Supprimer' }).click();
    await expect.poll(() => p.getByRole('button', { name: /^Éphémère/ }).count()).toBe(0);
    await p.getByRole('button', { name: /^Courses/ }).first().click();
    await p.getByText(/Elle sert encore/).waitFor();
    expect(await p.getByRole('button', { name: 'Supprimer' }).count()).toBe(0);
    await p.getByRole('button', { name: 'Fermer' }).click();
    await shot(p, '69-finances-v5-categories');
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    await p.getByRole('link', { name: 'Retour' }).click();
    await p.getByRole('heading', { name: 'Réglages' }).waitFor();
    // Un tag, puis une règle de tri qui le pose.
    await section(/^Tags/, 'Tags');
    await add();
    await p.getByLabel('Nom').fill('week-end');
    await p.getByRole('button', { name: 'Enregistrer' }).click();
    await p.getByText('#week-end').waitFor();
    await home();
    await section(/^Règles de tri/, 'Règles de tri');
    await add();
    await p.getByLabel('Le libellé contient').fill('epicerie');
    await p.getByLabel('Catégorie').selectOption({ label: 'Courses › Pain' });
    await p.getByRole('switch', { name: 'week-end' }).click();
    await p.getByRole('button', { name: 'Enregistrer' }).click();
    await p.getByRole('button', { name: /^epicerie.*Pain · #week-end/ }).waitFor();
    // Une enveloppe hors quotidien, plafonnée à 100 €, qui contient « Courses » (et donc sa sous-catégorie).
    await home();
    await section(/^Enveloppes/, 'Enveloppes');
    await add();
    await p.getByLabel('Nom').fill('Alimentation');
    await p.getByLabel('Plafond par cycle').fill('100');
    await p.getByRole('switch', { name: 'Dans le budget quotidien' }).click();
    await p.getByRole('switch', { name: 'Courses', exact: true }).click();
    await p.getByRole('button', { name: 'Enregistrer' }).click();
    await p.getByRole('button', { name: /^Alimentation.*hors quotidien · plafond 100/ }).waitFor();
    await home();
    await p.getByRole('link', { name: /^Enveloppes.*dont 1 plafonnée/ }).waitFor();
    await shot(p, '62-finances-v5-reglages');
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    // Retour au calcul : les espèces sont dans le cash, l'enveloppe est mise à part, et ses dépenses (l'épicerie
    // classée par la règle, la boulangerie classée par son marchand) ne pèsent plus dans le quotidien.
    await p.goto(`${server.url}/argent/moteur`);
    await shows('Comptes du quotidien', /1\s240\s€/);
    await shows('Enveloppes hors quotidien', /100\s€/);
    await shows('Déjà dépensé', /\n0\s€/);
    await p.getByRole('button', { name: /^Alimentation.*42,50\s€ sur 100\s€/ }).waitFor();
    // ---- M5. Les écrans : Jour, Opérations et Analyse, À classer, Plan, Patrimoine, et leur navigation propre.
    await p.goto(`${server.url}/argent`);
    await p.getByRole('heading', { name: 'Jour' }).waitFor();
    await p.getByText('Tes 14 derniers jours').waitFor();
    await p.getByRole('img', { name: /du budget du cycle déjà dépensé/ }).waitFor();
    // Les dépenses cumulées du cycle, face au rythme idéal.
    await p.getByRole('img', { name: /Dépenses cumulées du cycle/ }).waitFor();
    await p.getByText('sur le rythme idéal').waitFor();
    // Un curseur au doigt ou à la souris : le jour visé, ce qui était dépensé, l'idéal et le cycle dernier à ce jour.
    const cumul = p.getByRole('img', { name: /Dépenses cumulées du cycle/ });
    await cumul.hover({ position: { x: 70, y: 60 } });
    await p.getByText(/dépensés au |au début du cycle/).waitFor();
    await p.mouse.move(5, 5);
    await p.getByText(/^dépensés en \d+ jours?$/).waitFor();
    // Quatorze jours en barres ; un jour touché donne son montant.
    const bars = p.getByRole('img', { name: /Dépenses des 14 derniers jours/ });
    await bars.click({ position: { x: 300, y: 80 } });
    await p.locator('.fin-day-pick').waitFor();
    await p.getByRole('img', { name: /Dépenses cumulées du cycle/ }).scrollIntoViewIfNeeded();
    await shot(p, '63b-finances-v5-jour-cumul');
    await p.evaluate(() => (document.documentElement.dataset.glass = 'prononce'));
    await shot(p, '63c-finances-v5-jour-prononce');
    await p.evaluate(() => (document.documentElement.dataset.theme = 'sombre'));
    await shot(p, '63d-finances-v5-jour-prononce-sombre');
    await p.evaluate(() => (document.documentElement.dataset.theme = 'clair'));
    await p.evaluate(() => (document.documentElement.dataset.glass = 'subtil'));
    await p.evaluate(() => window.scrollTo(0, 0));
    await shot(p, '63-finances-v5-jour');
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    // La barre du bas est celle du module ; son « + » ouvre la saisie d'une dépense.
    const tabs = p.getByRole('navigation', { name: 'Navigation de MyFinances' });
    await tabs.getByRole('link', { name: 'Ajouter' }).click();
    await p.getByLabel('Montant').fill('4,50');
    await p.getByLabel('Catégorie').selectOption('courses');
    await p.getByLabel('Libellé (facultatif)').fill('Café du marché');
    await p.getByRole('button', { name: 'Ajouter', exact: true }).click();
    // Saisie en espèces : elle apparaît dans la liste, et sort du portefeuille (40 € → 35,50 €).
    const cafe = p.getByRole('button', { name: /Café du marché/ });
    await cafe.waitFor();
    await shot(p, '64-finances-v5-operations');
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    // La fiche d'une opération : la ventiler en deux catégories, puis retirer la ventilation.
    await p.getByRole('button', { name: /Epicerie Coin/ }).click();
    await p.getByLabel('Montant de la part').fill('2,50');
    await p.getByLabel('Sa catégorie').selectOption({ label: 'Courses › Pain' });
    await p.getByRole('button', { name: 'Ventiler', exact: true }).click();
    await p.getByText('Ventilée en 2 parts').waitFor();
    await p.getByRole('button', { name: 'Retirer la ventilation' }).click();
    await p.getByRole('button', { name: 'Terminé' }).click();
    // Un remboursement se rattache à la catégorie qu'il allège (ici le salaire, reclassé le temps de le vérifier).
    await p.getByRole('button', { name: /employeur/i }).first().click();
    await p.getByLabel('C’est').selectOption('REFUND');
    await p.getByLabel('Remboursement de').selectOption('courses');
    await p.getByRole('button', { name: 'Classer' }).click();
    await p.getByRole('button', { name: /employeur/i }).first().click();
    expect(await p.getByLabel('Remboursement de').inputValue()).toBe('courses');
    await p.getByLabel('C’est').selectOption('INCOME');
    await expect.poll(() => p.getByLabel('Remboursement de').count()).toBe(0);
    await p.getByRole('button', { name: 'Classer' }).click();
    // Chercher, puis la sélection multiple.
    await p.getByLabel('Chercher une opération').fill('cafe');
    await expect.poll(() => p.locator('button.fin-op').count()).toBe(1);
    await p.getByLabel('Chercher une opération').fill('');
    await p.getByRole('button', { name: 'Sélectionner' }).click();
    await cafe.click();
    await p.getByText('1 sélectionnée').waitFor();
    await p.getByRole('button', { name: 'Annuler' }).click();
    // Analyse, À classer, Plan, Patrimoine : chacun son graphique.
    await p.getByRole('button', { name: 'Analyse' }).click();
    await p.getByRole('img', { name: /Dépenses par catégorie/ }).waitFor();
    // Toutes les catégories ; une catégorie touchée se déplie sur ses dépenses ; « voir dans la liste » filtre la liste.
    await p.getByRole('button', { name: /^Courses/ }).click();
    await p.locator('.fin-cat-op').first().waitFor();
    await shot(p, '65-finances-v5-analyse');
    await p.getByRole('group', { name: 'Période analysée' }).getByRole('button', { name: '3 cycles' }).click();
    await p.getByRole('button', { name: /^Courses/ }).waitFor();
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    await tabs.getByRole('link', { name: 'Plan' }).click();
    await p.getByRole('img', { name: /Où vont tes revenus du cycle/ }).waitFor();
    await p.getByRole('img', { name: /Solde prévu jusqu'à la paie/ }).waitFor();
    // Le calendrier : un mois entier (au moins quatre semaines), et on passe d'un mois à l'autre.
    expect(await p.locator('.fin-cal > span').count()).toBeGreaterThanOrEqual(28);
    const monthLabel = () => p.locator('.fin-cal-month').innerText();
    const thisMonth = await monthLabel();
    await p.getByRole('button', { name: 'Mois suivant' }).click();
    expect(await monthLabel()).not.toBe(thisMonth);
    expect(await p.locator('.fin-cal > span[data-today="true"]').count()).toBe(0);
    await p.locator('.fin-cal-month').click();
    expect(await monthLabel()).toBe(thisMonth);
    await p.locator('.fin-cal > span[data-today="true"]').waitFor();
    // La trésorerie se lit au doigt : un jour, son solde et ses échéances.
    await p.getByRole('img', { name: /Solde prévu jusqu'à la paie/ }).hover({ position: { x: 200, y: 80 } });
    await p.getByText(/^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) \d+ /).first().waitFor();
    // Les enveloppes : une grande carte par enveloppe, et les dépenses de celle choisie en dessous.
    await p.getByRole('button', { name: /^Alimentation/ }).first().waitFor();
    await p.getByText(/^Alimentation, ce cycle/).waitFor();
    // À la souris aussi, les cartes glissent et se recalent ; le glissement ne choisit pas d'enveloppe, un clic oui.
    await p.locator('.fin-sec', { hasText: 'Budgets par enveloppe' }).getByRole('button', { name: 'Ajouter' }).click();
    await p.getByLabel('Nom').fill('Loisirs');
    await p.getByLabel('Plafond par cycle').fill('50');
    await p.getByRole('button', { name: 'Enregistrer' }).click();
    const envs = p.locator('.fin-envs');
    await envs.getByRole('button', { name: /^Loisirs/ }).waitFor();
    const row = (await envs.boundingBox())!;
    await p.mouse.move(row.x + 220, row.y + 60);
    await p.mouse.down();
    await p.mouse.move(row.x + 60, row.y + 60, { steps: 8 });
    await p.mouse.up();
    await expect.poll(() => envs.evaluate((el) => el.scrollLeft > 0 && el.scrollLeft >= el.scrollWidth - el.clientWidth - 1)).toBe(true);
    await p.locator('.fin-dots i').nth(1).and(p.locator('[data-on="true"]')).waitFor();
    await p.getByText(/^Alimentation, ce cycle/).waitFor();
    await envs.getByRole('button', { name: /^Loisirs/ }).click();
    await p.getByText(/^Loisirs, ce cycle/).waitFor();
    await p.locator('.fin-sec', { hasText: 'Loisirs, ce cycle' }).getByRole('button', { name: 'Modifier' }).click();
    await p.getByRole('button', { name: 'Supprimer' }).click();
    await envs.getByRole('button', { name: /^Loisirs/ }).waitFor({ state: 'detached' });
    // Ajouter une charge : le type en tuiles, le montant en grand, le jour à toucher.
    await tabs.getByRole('link', { name: 'Ajouter : un engagement' }).click();
    await p.getByRole('group', { name: 'Type' }).getByRole('button', { name: /^Charge/ }).waitFor();
    await p.getByLabel('Montant par échéance').fill('35');
    await p.getByLabel('Libellé').fill('Box internet');
    await p.getByRole('button', { name: 'Le 23' }).click();
    await p.getByText(/^Le 23 de chaque mois/).waitFor();
    await shot(p, '66b-finances-v5-formulaire');
    await p.getByRole('button', { name: /^Ajouter la charge · 35/ }).click();
    await p.getByRole('button', { name: /^Box internet.*35\s€/ }).waitFor();
    await shot(p, '66-finances-v5-plan');
    if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/66c-finances-v5-plan-entier.png`, fullPage: true });
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    await tabs.getByRole('link', { name: 'Patrimoine' }).click();
    // La simulation est repliée par défaut : une ligne ; « Simuler » la déplie (et elle le reste sur l'appareil).
    await p.getByRole('button', { name: /^Dans 10 ans/ }).waitFor();
    await p.getByRole('button', { name: 'Simuler' }).click();
    await p.getByRole('img', { name: /Projection du patrimoine/ }).waitFor();
    await p.getByRole('img', { name: /Répartition :/ }).waitFor();
    // Du général au détail : les familles d'abord ; une famille se déplie sur ses comptes ; un compte ouvre sa fiche.
    const quotidien = p.getByRole('button', { name: /^Quotidien/ });
    expect(await quotidien.getAttribute('aria-expanded')).toBe('false');
    await quotidien.click();
    expect(await quotidien.getAttribute('aria-expanded')).toBe('true');
    await p.getByRole('link', { name: /^Portefeuille.*36\s€/ }).waitFor();
    await p.getByRole('button', { name: /^Épargne/ }).click();
    expect(await quotidien.getAttribute('aria-expanded')).toBe('false');
    await p.getByRole('link', { name: /^Livret/ }).click();
    await p.getByRole('heading', { name: 'Livret' }).waitFor();
    // La simulation du compte : versement, rendement, horizon, frais ; les frais font baisser la valeur nette.
    const simulated = () => p.getByRole('img', { name: /Simulation sur/ }).getAttribute('aria-label');
    await p.getByLabel('Versement mensuel (€)').fill('100');
    await p.getByLabel('Rendement annuel (%)').fill('4');
    await p.getByLabel('Horizon (ans)').fill('20');
    await expect.poll(simulated).toMatch(/Simulation sur 20 ans/);
    const noFees = await simulated();
    await p.getByLabel('Frais de gestion (%/an)').fill('1');
    await expect.poll(simulated).not.toBe(noFees);
    expect(await simulated()).not.toMatch(/les frais coûtent 0\s€/);
    await shot(p, '70-finances-v5-compte');
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    await p.getByRole('link', { name: 'Retour', exact: true }).click();
    await p.getByRole('heading', { name: 'Patrimoine' }).waitFor();
    // La projection du patrimoine suit désormais la simulation des comptes.
    await p.getByText(/La projection additionne la simulation/).waitFor();
    await p.goto(`${server.url}/argent/patrimoine/compte/${'x'}`);
    await p.getByRole('heading', { name: 'Patrimoine' }).waitFor();
    await p.getByRole('button', { name: /^Épargne/ }).click();
    await p.getByRole('link', { name: /^Livret/ }).click();
    await p.getByRole('button', { name: 'Revenir aux valeurs par défaut' }).click();
    await p.getByRole('link', { name: 'Retour', exact: true }).click();
    // Le « + » suit l'écran : ici, un compte. Un placement se crée, puis ses lignes et leurs mouvements.
    await tabs.getByRole('link', { name: 'Ajouter : un compte' }).click();
    await p.getByRole('dialog', { name: 'Ajouter' }).getByRole('button', { name: /^Un placement/ }).click();
    await p.getByRole('button', { name: 'Boursobank' }).click();
    await p.getByRole('button', { name: 'Créer le placement' }).click();
    await p.getByRole('heading', { name: 'Boursobank' }).waitFor();
    await p.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await p.getByLabel('Nom de la ligne').fill('ETF Monde');
    await p.getByLabel('Cours actuel, par unité (€)').fill('100');
    await p.getByLabel('Quantité détenue').fill('10');
    await p.getByLabel('Total investi (€)').fill('900');
    await p.getByRole('button', { name: 'Ajouter la ligne' }).click();
    await p.getByRole('button', { name: /^ETF Monde.*10 parts.*\+11,1 %.*1\s000\s€/ }).click();
    await p.getByRole('button', { name: 'Mouvement' }).click();
    await p.getByLabel('Quantité').fill('2');
    await p.getByLabel('Montant (€)').fill('190');
    await p.getByRole('button', { name: 'Enregistrer' }).click();
    await p.getByRole('dialog', { name: 'ETF Monde' }).getByText(/12 parts/).waitFor();
    await p.getByRole('dialog', { name: 'ETF Monde' }).getByRole('button', { name: /^Achat · 2/ }).waitFor();
    await shot(p, '75-finances-v5-ligne');
    await p.getByRole('button', { name: 'Fermer' }).click();
    await p.getByText(/1\s200\s€/).first().waitFor();
    await shot(p, '76-finances-v5-placement');
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    await p.getByRole('link', { name: 'Retour', exact: true }).click();
    await p.getByRole('heading', { name: 'Patrimoine' }).waitFor();
    await p.getByRole('button', { name: /^Placements.*1 compte/ }).waitFor();
    // Un objectif, suivi à la main.
    await p.locator('.fin-sec', { hasText: 'Objectifs' }).getByRole('button', { name: 'Ajouter' }).click();
    await p.getByLabel('Nom').fill('Voyage');
    await p.getByLabel('Montant visé (€)').fill('2000');
    await p.getByRole('button', { name: 'Créer l’objectif' }).click();
    await p.getByRole('button', { name: /^Voyage.*0\s€ sur 2\s000\s€/ }).click();
    await p.getByLabel('Noter un versement (€)').fill('500');
    await p.getByRole('button', { name: 'Noter' }).click();
    await p.getByRole('button', { name: 'Fermer' }).click();
    await p.getByRole('button', { name: /^Voyage.*500\s€ sur 2\s000\s€/ }).waitFor();
    // Le relevé Trade Republic s'importe dans le module.
    await p.goto(`${server.url}/argent/patrimoine/import`);
    await p.getByRole('button', { name: 'Choisir le relevé (PDF)' }).waitFor();
    await p.goto(`${server.url}/argent/patrimoine`);
    // La projection se règle : un montant placé chaque mois et un rendement, saisis ; « revenir au plan » l'annule.
    const projected = () => p.getByRole('img', { name: /Projection du patrimoine/ }).getAttribute('aria-label');
    const before = await projected();
    await p.getByLabel('Je place chaque mois (€)').fill('300');
    await expect.poll(projected).not.toBe(before);
    await p.getByLabel('Rendement annuel (%)').fill('7,5');
    // La durée se choisit : la projection va jusqu'au bout de la période.
    await p.getByRole('group', { name: 'Durée de la simulation' }).getByRole('button', { name: '20 ans' }).click();
    await expect.poll(projected).toMatch(/dans 20 ans/);
    await p.getByText('Versé en 20 ans').waitFor();
    await p.getByRole('button', { name: /Revenir au plan/ }).click();
    await expect.poll(() => p.getByRole('button', { name: /Revenir au plan/ }).count()).toBe(0);
    await shot(p, '67-finances-v5-patrimoine');
    await p.evaluate(() => (document.documentElement.dataset.glass = 'prononce'));
    await shot(p, '67b-finances-v5-patrimoine-prononce');
    await p.evaluate(() => (document.documentElement.dataset.glass = 'subtil'));
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    // Sur ordinateur : la barre latérale à trois étages (MyLife, modules, écrans du module ouvert), son bouton
    // d'ajout qui suit l'écran, et une seule lampe pour tout l'écran ; sur tablette, un rail d'icônes.
    await p.setViewportSize({ width: 1280, height: 860 });
    const side = p.getByRole('navigation', { name: 'Navigation principale' });
    await side.getByRole('link', { name: 'Un compte' }).waitFor();
    await side.getByRole('link', { name: 'Patrimoine' }).waitFor();
    await p.evaluate(() => (document.documentElement.dataset.glass = 'prononce'));
    await p.mouse.move(500, 300);
    await p.waitForTimeout(500);
    expect(await p.evaluate(() => document.documentElement.dataset.lamp)).toBe('ecran');
    await shot(p, '71-ordinateur-patrimoine');
    await side.getByRole('link', { name: 'Plan' }).click();
    await side.getByRole('link', { name: 'Un engagement' }).waitFor();
    await p.evaluate(() => (document.documentElement.dataset.theme = 'sombre'));
    await p.mouse.move(700, 420);
    await p.waitForTimeout(500);
    await shot(p, '72-ordinateur-plan-sombre');
    await side.getByRole('link', { name: 'Aujourd’hui' }).click();
    await side.getByRole('button', { name: 'Ajouter' }).waitFor();
    await p.mouse.move(420, 260);
    await p.waitForTimeout(500);
    await shot(p, '73-ordinateur-accueil-sombre');
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    await p.setViewportSize({ width: 1000, height: 760 });
    expect(Math.round((await side.boundingBox())!.width)).toBe(76);
    await shot(p, '74-tablette-accueil');
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    await p.evaluate(() => {
      document.documentElement.dataset.theme = 'clair';
      document.documentElement.dataset.glass = 'subtil';
    });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto(`${server.url}/argent/classer`);
    await p.getByRole('heading', { name: 'À classer' }).waitFor();
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    // Le retour de l'en-tête ramène à MyLife, et sa barre du bas revient.
    await p.getByRole('link', { name: 'Retour à MyLife' }).click();
    await p.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    await p.getByRole('navigation', { name: 'Barre de navigation' }).waitFor();
    // ---- M6. La bascule : la carte de l'accueil vient du moteur et ouvre le module ; la banque, l'export.
    const card = p.getByRole('link', { name: 'Ouvrir MyFinances' });
    await card.getByText(/à dépenser aujourd’hui/).waitFor();
    expect(await card.getAttribute('href')).toBe('/argent');
    // Un faux relais bancaire : une banque, un compte, deux opérations dont une déjà connue au second passage.
    let bankState = '';
    await p.route('**/api/eb', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { op: string; state?: string };
      const ok = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
      if (body.op === 'status') return ok({ configured: true, authenticated: true });
      if (body.op === 'aspsps') return ok({ aspsps: [{ name: 'Banque Fictive', country: 'FR' }, { name: 'Autre Établissement', country: 'FR' }] });
      if (body.op === 'startAuth') return (bankState = body.state ?? ''), ok({ url: `${server.url}/finances/connexion/retour?code=abc&state=${bankState}`, authorization_id: 'a' });
      if (body.op === 'createSession') return ok({ session_id: 'sess-e2e', accounts: [{ uid: 'u1', identification_hash: 'h1', currency: 'EUR', details: 'Compte Fictif', cash_account_type: 'CACC' }], aspsp: { name: 'Banque Fictive', country: 'FR' }, access: { valid_until: new Date(Date.now() + 80 * 86400_000).toISOString() } });
      if (body.op === 'transactions') return ok({ transactions: [{ transaction_amount: { amount: '18.40', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: today, creditor: { name: 'CB LIBRAIRIE DU PORT' }, entry_reference: 'e2e-1' }] });
      if (body.op === 'balances') return ok({ balances: [{ name: 'x', balance_type: 'CLAV', balance_amount: { amount: '500.00', currency: 'EUR' } }] });
      return ok({});
    });
    await p.goto(`${server.url}/argent/banques`);
    await p.getByText('Aucun compte relié').waitFor();
    await p.getByRole('button', { name: 'Voir les banques' }).click();
    await p.getByLabel('Ta banque').fill('fictive');
    await expect.poll(() => p.getByRole('button', { name: /Établissement/ }).count()).toBe(0);
    await shot(p, '68-finances-v5-banques');
    // La banque renvoie à l'adresse déclarée (`/finances/connexion/retour`, servie par la coquille depuis le retrait de
    // l'app d'avant) : la connexion s'y termine, puis Banques s'ouvre.
    await p.getByRole('button', { name: 'Banque Fictive' }).click();
    await p.waitForURL('**/argent/banques', { timeout: 30_000 });
    await p.getByText('1 compte relié').waitFor();
    await p.getByText(/Accès jusqu’au/).waitFor();
    expect(bankState).not.toBe('');
    // Synchro à la demande : rien en double.
    await p.getByRole('button', { name: 'Synchroniser' }).click();
    await p.getByText('Compte Fictif : à jour').waitFor();
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    await p.unroute('**/api/eb');
    await p.goto(`${server.url}/argent/operations`);
    await expect.poll(() => p.getByRole('button', { name: /Librairie/i }).count()).toBe(1);
    // Export : un fichier, fabriqué sur l'appareil.
    await p.goto(`${server.url}/argent/reglages`);
    const exported = p.waitForEvent('download');
    await p.getByRole('button', { name: /Exporter mes données/ }).click();
    const exportedPath = (await (await exported).path())!;
    const file = JSON.parse(readFileSync(exportedPath, 'utf8')) as { format: string; tables: { transactions: unknown[] }; engine: { version: number } | null };
    expect(file.format).toBe('myfinances-backup');
    expect(file.tables.transactions.length).toBeGreaterThan(4);
    expect(file.engine?.version).toBe(1);
    // Importer : le fichier se relit ; tout y est déjà, rien n'est doublé ; l'import s'annule.
    await p.getByRole('button', { name: /^Importer des données/ }).click();
    await p.getByLabel('Fichier de données').setInputFiles(exportedPath);
    await p.getByText('Toutes ces opérations sont déjà là.').waitFor();
    await p.getByRole('button', { name: /^Ajouter 0 opération/ }).click();
    await p.getByText(/0 opération ajoutée/).waitFor();
    await p.getByRole('button', { name: 'Annuler le dernier import' }).click();
    await p.getByText('Import annulé : tes données sont revenues comme avant.').waitFor();
    await p.getByRole('button', { name: 'Fermer' }).click();
    // Un second appareil du même compte : faits et réglages arrivent tout seuls (l'espèce saisie, l'enveloppe créée).
    const [ctx2, p2] = await device();
    await p.waitForFunction(() => (JSON.parse(localStorage.getItem('mylife-queue-finances5') ?? '[]') as unknown[]).length === 0 && (JSON.parse(localStorage.getItem('mylife-queue-finances') ?? '[]') as unknown[]).length === 0, undefined, { timeout: 30_000 });
    await p2.goto(`${server.url}/`);
    await p2.getByRole('button', { name: 'J’ai déjà un compte' }).click();
    await p2.getByLabel('Identifiant').fill(LOGIN);
    await p2.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await p2.getByRole('button', { name: 'Se connecter' }).click();
    await p2.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    await p2.goto(`${server.url}/argent/operations`);
    await p2.getByRole('button', { name: /Librairie/i }).waitFor({ timeout: 30_000 });
    await p2.getByRole('button', { name: /Café du marché/ }).waitFor({ timeout: 30_000 });
    await ctx2.close();
    // Un autre compte sur ce navigateur : rien du précédent, ni opérations ni réglages, avant même la synchro.
    await p.goto(`${server.url}/compte`);
    await p.getByRole('button', { name: 'Se déconnecter' }).click();
    await p.getByRole('button', { name: 'J’ai déjà un compte' }).click();
    await p.getByLabel('Identifiant').fill(`${LOGIN}-b`);
    await p.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await p.getByRole('button', { name: 'Se connecter' }).click();
    await p.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    expect(await p.getByText(/à dépenser aujourd’hui/).count()).toBe(0);
    await p.goto(`${server.url}/argent/operations`);
    await p.getByText('Bienvenue dans MyFinances').waitFor();
    expect(await p.getByRole('button', { name: /Librairie/i }).count()).toBe(0);
    const left = await p.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const open = indexedDB.open('myfinances');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const count = open.result.transaction('transactions').objectStore('transactions').count();
            count.onsuccess = () => (open.result.close(), resolve(count.result));
          };
        }),
    );
    expect(left).toBe(0);
    await ctx.close();
  });

  it('aucune erreur JavaScript', () => {
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
