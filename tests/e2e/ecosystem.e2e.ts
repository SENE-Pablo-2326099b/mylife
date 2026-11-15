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
  p.on('pageerror', (e) => errors.push(`${p.url()} : ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text()) && errors.push(`${p.url()} : ${m.text()}`));
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
      // L'accueil commence par une présentation, puis le même formulaire que les apps.
      if (path === '/') await fresh.getByRole('button', { name: 'Commencer' }).click();
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
    expect(manifest.shortcuts.map((s) => s.url)).toEqual(['/finances/', '/perf/', '/raveloc/']);
    for (const path of ['/', '/finances/', '/perf/', '/raveloc/']) {
      const html = await (await fetch(`${server.url}${path}`)).text();
      const links = [...html.matchAll(/<link[^>]+rel="manifest"[^>]*>/g)].map((m) => m[0]);
      expect(links, path).toHaveLength(1);
      expect(links[0], path).toContain('href="/manifest.webmanifest"');
    }
  });

  it('depuis l’accueil, les trois apps se préparent en arrière-plan (hors ligne, ouverture immédiate)', async () => {
    await page.goto(`${server.url}/`);
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname).sort()), { timeout: 20_000, interval: 500 })
      .toEqual(['/', '/finances/', '/perf/', '/raveloc/']);
  });

  it('MyRave : déjà connecté (même session), même interface', async () => {
    await page.goto(`${server.url}/raveloc/`);
    await page.getByText('Aucun groupe pour l’instant').waitFor();
    expect(await page.getByText('Crée ton compte').count()).toBe(0);
    await shot(page, '05-raveloc');
  });

  it('MyFinances : déjà connecté, l’appareil relié tout seul', async () => {
    await page.goto(`${server.url}/finances/`);
    await page.getByText(`Connecté à MyLife : ${LOGIN}`).waitFor();
    await shot(page, '06-finances');
    await page.goto(`${server.url}/finances/reglages/compte`);
    await page.getByText(/Synchronisé/).first().waitFor();
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
    for (const path of ['/raveloc/', '/finances/']) {
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
    for (const path of ['/', '/modules', '/copilot', '/compte', '/reglages', '/installer', '/donnees', '/confidentialite', '/kit', '/ancien/sorties', '/raveloc/', '/raveloc/groupes', '/finances/', '/perf/']) {
      await small.goto(`${server.url}${path}`);
      await small.waitForTimeout(1200);
      expect(await overflow(small), path).toBeLessThanOrEqual(0);
    }
  });

  it('même navigateur, autre compte : rien du précédent (données, clé d’IA, aperçus)', async () => {
    // Le premier compte laisse des traces : un prénom dans MyFinances (synchronisé), sa clé d'IA.
    await page.goto(`${server.url}/finances/`);
    const firstName = page.getByLabel('Ton prénom (facultatif)');
    await firstName.fill('Zébulon');
    await firstName.blur();
    await page.waitForTimeout(800);
    await page.evaluate(() => localStorage.setItem('mylife:anthropic-key', 'sk-ant-du-premier'));
    await page.goto(`${server.url}/finances/reglages/compte`);
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await page.getByText('Crée ton compte').waitFor();
    // Un autre compte, dans le même navigateur.
    const other = `${LOGIN}-b`;
    await page.getByLabel('Identifiant').fill(other);
    await page.getByText('Libre').waitFor();
    await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.getByRole('button', { name: 'C’est fait, je l’ai mise de côté' }).click();
    await page.goto(`${server.url}/finances/`);
    await page.getByText(`Connecté à MyLife : ${other}`).waitFor({ timeout: 30_000 });
    expect(await page.getByLabel('Ton prénom (facultatif)').inputValue()).toBe('');
    expect(await page.evaluate(() => document.body.innerText)).not.toContain('Zébulon');
    expect(await page.evaluate(() => localStorage.getItem('mylife:anthropic-key'))).toBeNull();
    await page.goto(`${server.url}/`);
    await page.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
    await page.goto(`${server.url}/finances/`);
    await shot(page, '14-autre-compte');
    // MyPerf : relié au nouveau compte, sans rien du précédent.
    await page.goto(`${server.url}/perf/account`);
    await page.getByText(other).first().waitFor({ timeout: 40_000 });
    await page.getByText(/Synchronisé/).first().waitFor({ timeout: 30_000 });
    // Le premier compte, lui, a toujours ses données : il les retrouve en se reconnectant ailleurs.
    const [, back] = await device();
    await back.goto(`${server.url}/finances/`);
    await back.getByRole('button', { name: 'J’ai déjà un compte' }).click();
    await back.getByLabel('Identifiant').fill(LOGIN);
    await back.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await back.getByRole('button', { name: 'Se connecter' }).click();
    await expect.poll(() => back.getByLabel('Ton prénom (facultatif)').inputValue().catch(() => ''), { timeout: 30_000, interval: 500 }).toBe('Zébulon');
  });

  it('navigateur avec des données d’avant tout compte : un compte neuf part de zéro (proposé d’abord)', async () => {
    const [ctx, used] = await device();
    await used.goto(`${server.url}/finances/`);
    await used.getByText('Crée ton compte').waitFor();
    await used.waitForTimeout(1000);
    // Des réglages saisis sur cet appareil, reliés à aucun compte.
    await used.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('myfinances');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction('settings', 'readwrite');
            const settings = tx.objectStore('settings');
            const main = settings.get('main');
            main.onsuccess = () => settings.put({ ...main.result, onboarded: true, firstName: 'Orphelin' });
            tx.oncomplete = () => resolve(open.result.close());
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    const login = `${LOGIN}-c`;
    await used.getByLabel('Identifiant').fill(login);
    await used.getByText('Libre').waitFor();
    await used.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await used.getByRole('button', { name: 'Créer mon compte' }).click();
    await used.getByText('Ton compte est neuf').waitFor({ timeout: 30_000 });
    await shot(used, '15-compte-neuf');
    await used.getByRole('button', { name: 'Partir de zéro' }).click();
    await used.getByText(`Connecté à MyLife : ${login}`).waitFor({ timeout: 30_000 });
    expect(await used.getByLabel('Ton prénom (facultatif)').inputValue()).toBe('');
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
    await p.getByRole('link', { name: 'Démarrer' }).waitFor();
    await shot(p, '40-v5-aujourdhui');
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
    // Sans ancienne base sur l'appareil : rien à reprendre, et c'est dit.
    await p.goto(`${server.url}/argent`);
    await p.getByText('Rien à reprendre ici').waitFor();
    // Une ancienne base (fictive) : deux comptes, quatre opérations, un revenu et une charge prévus.
    const today = await p.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    await p.evaluate(
      (date) =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('myfinances', 30);
          open.onupgradeneeded = () => ['transactions', 'accounts', 'categories', 'settings'].forEach((t) => open.result.createObjectStore(t, { keyPath: 'id' }));
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
    // Budget théorique : 2 000 − 700 = 1 300 de reste à vivre ; 42,50 dépensés (dont 30 à classer, comptés) ; le
    // virement vers le livret (sans jambe jumelle connue) ne pèse rien, le salaire règle son échéance.
    const term = (label: string) => p.locator('.list-row', { hasText: label }).first();
    await expect.poll(() => term('Reste à vivre').innerText()).toMatch(/1\s300\s€/);
    expect(await term('Déjà dépensé').innerText()).toMatch(/42,50\s€/);
    // Trésorerie : 1 200 sur le compte du quotidien (le livret n'en est pas), moins le loyer encore à payer.
    expect(await term('Comptes du quotidien').innerText()).toMatch(/1\s200\s€/);
    expect(await term('À payer avant la paie').innerText()).toMatch(/700\s€/);
    expect(await term('Cash libre').innerText()).toMatch(/500\s€/);
    // Le plus petit des deux : la trésorerie (500 + 42,50 dépensés depuis minuit), pas le budget (1 300).
    await p.getByText(/Limité par ta trésorerie/).waitFor();
    expect(await term('Disponible à minuit').innerText()).toMatch(/542,50\s€/);
    await shot(p, '60-finances-v5-moteur');
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    // Rejouable : même résultat.
    await p.getByRole('button', { name: 'Relire mes données' }).click();
    expect(await term('Cash libre').innerText()).toMatch(/500\s€/);
    await ctx.close();
  });

  it('aucune erreur JavaScript', () => {
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
