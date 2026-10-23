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
import { addWeeks, localToday, weekStart } from '../../packages/lumen/src/character';

const PORT = 4330;
let server: LocalServer;
let browser: Browser;
let phone: BrowserContext;
let page: Page;
const errors: string[] = [];
const LOGIN = 'test-e2e-mylife';
/** Libellé de la carte du Personnage sur le premier appareil (le second doit afficher le même). */
let personnage = '';
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
    await page.getByText('Tes finances, ton entraînement et tes sorties').waitFor();
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
    await page.getByText(/Bonjour|Bonsoir|Bonne nuit/).first().waitFor();
    for (const name of ['MyFinances', 'MyPerf', 'myRaveLoc']) await page.getByRole('button', { name: new RegExp(`Ouvrir ${name}`) }).waitFor();
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

  it('myRaveLoc : déjà connecté (même session), même interface', async () => {
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
    // MyPerf publie ses compteurs pour le Personnage (objectif de séances compris), une fois relié au compte.
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mylife:stats:perf') ?? 'null')?.goal ?? null), { timeout: 15_000, interval: 500 }).toBe(4);
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

  it('le Personnage : niveau, stats et quêtes calculés à partir des compteurs des apps', async () => {
    // Des compteurs comme ceux que publient MyPerf et MyFinances : 6 semaines à 3 séances, des jours sous le budget.
    const now = weekStart(localToday());
    const perf: Record<string, Record<string, number>> = {};
    const finances: Record<string, Record<string, number>> = {};
    for (let i = 1; i <= 6; i++) {
      perf[addWeeks(now, -i)] = { sessions: 3, records: i % 2 };
      finances[addWeeks(now, -i)] = { under: 6, tracked: 7 };
    }
    perf[now] = { sessions: 1 };
    await page.goto(`${server.url}/`);
    await page.evaluate(
      ([p, f]) => {
        localStorage.setItem('mylife:stats:perf', JSON.stringify({ v: 1, at: Date.now(), weeks: p, goal: 3 }));
        localStorage.setItem('mylife:stats:finances', JSON.stringify({ v: 1, at: Date.now(), weeks: f }));
      },
      [perf, finances],
    );
    await page.reload();
    const card = page.getByRole('link', { name: /Ton personnage : niveau \d+/ });
    await card.waitFor();
    await shot(page, '04b-accueil-personnage');
    await card.click();
    await page.getByText('Quêtes de la semaine').waitFor();
    await page.getByText('Fais 3 séances').waitFor();
    await page.getByText('Reste sous ton budget du jour 5 jours').waitFor();
    await page.getByText('Série de 6 semaines réussies').waitFor();
    // Culture n'est pas encore branchée.
    await page.getByText('Bientôt', { exact: true }).waitFor();
    await page.waitForTimeout(700);
    await shot(page, '04c-personnage');
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/04d-personnage-complet.png`, fullPage: true });
    // La semaine de repos se déclare (une toutes les quatre semaines).
    await page.getByRole('button', { name: 'Déclarer une semaine de repos' }).click();
    await page.getByRole('button', { name: 'Annuler le repos' }).waitFor();
    await page.getByRole('button', { name: 'Annuler le repos' }).click();
    // Bilan et Wrapped à l'heure réelle (animations comprises).
    await page.goto(`${server.url}/bilan?semaine=${addWeeks(now, -1)}`);
    await page.getByText('3 séances').first().waitFor();
    await page.waitForTimeout(900);
    await shot(page, '04e-bilan');
    await page.goto(`${server.url}/wrapped?periode=${addWeeks(now, -1).slice(0, 7)}`);
    await page.getByRole('dialog', { name: /Wrapped de/ }).waitFor();
    await page.waitForTimeout(900);
    await shot(page, '04f-wrapped-intro');
    await page.mouse.click(300, 420);
    await page.waitForTimeout(900);
    await shot(page, '04g-wrapped-force');
    await page.getByRole('button', { name: 'Fermer le Wrapped' }).click();
    await page.goto(`${server.url}/`);
    personnage = (await page.getByRole('link', { name: /Ton personnage : niveau \d+/ }).getAttribute('aria-label')) ?? '';
    expect(personnage).toMatch(/niveau \d+, /);
  });

  it('un thème choisi sur l’accueil habille toutes les apps', async () => {
    await page.goto(`${server.url}/apparence`);
    await page.getByRole('radio', { name: /Thème Brut/ }).click();
    expect(await style(page)).toBe('brut');
    await shot(page, '08-accueil-brut');
    for (const path of ['/raveloc/', '/finances/']) {
      await page.goto(`${server.url}${path}`);
      await page.waitForTimeout(800);
      expect(await style(page), path).toBe('brut');
    }
    await shot(page, '09-finances-brut');
  });

  it('les Espaces de chaque app montrent les apps, l’accueil et le compte', async () => {
    await page.goto(`${server.url}/raveloc/`);
    await page.getByRole('button', { name: /Espaces MyLife/ }).click();
    await page.getByRole('dialog', { name: 'Espaces MyLife' }).getByText(`${LOGIN} · chiffré de bout en bout`).waitFor();
    // L'app ouverte est marquée, l'accueil et les deux autres apps sont à un toucher.
    await page.getByRole('button', { name: /Rester dans myRaveLoc/ }).waitFor();
    await page.getByRole('button', { name: /Ouvrir MyFinances/ }).waitFor();
    await page.getByRole('button', { name: /Ouvrir MyPerf/ }).waitFor();
    await page.waitForTimeout(700);
    await shot(page, '10-espaces-raveloc');
    await page.getByRole('button', { name: /Ouvrir MyLife/ }).click();
    await page.waitForURL(`${server.url}/`);
    // L'aperçu déposé par myRaveLoc est sur l'accueil.
    await page.getByText('Aucun groupe en cours').waitFor();
    await shot(page, '11-accueil-apercus');
  });

  it('la palette de l’accueil mène aux écrans des autres apps', async () => {
    await page.getByRole('button', { name: /Chercher, aller, agir/ }).click();
    await page.getByPlaceholder('Chercher, aller, agir…').fill('seance');
    await page.getByRole('option', { name: /Séance du jour/ }).waitFor();
    await shot(page, '12-palette');
    await page.keyboard.press('Escape');
  });

  it('un écran ouvert directement (palette d’une autre app, lien) masque le dock', async () => {
    for (const path of ['/installer', '/raveloc/groupes/nouveau']) {
      await page.goto(`${server.url}${path}`);
      await page.waitForTimeout(1500);
      const dock = await page.locator('nav[aria-label="Navigation principale"]').evaluate((n) => getComputedStyle(n).opacity);
      expect(dock, path).toBe('0');
    }
  });

  it('second appareil : connexion, et le thème suit (synchro chiffrée)', async () => {
    const [, other] = await device();
    await other.goto(`${server.url}/`);
    await other.getByRole('button', { name: 'J’ai déjà un compte' }).click();
    await other.getByLabel('Identifiant').fill(LOGIN);
    await other.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await other.getByRole('button', { name: 'Se connecter' }).click();
    await other.getByText(`${LOGIN}`).first().waitFor();
    await expect.poll(() => style(other), { timeout: 20_000, interval: 500 }).toBe('brut');
    // Le Personnage suit aussi : mêmes compteurs (chiffrés dans le compte), même niveau.
    await expect
      .poll(() => other.getByRole('link', { name: /Ton personnage : niveau \d+/ }).getAttribute('aria-label').catch(() => null), { timeout: 20_000, interval: 500 })
      .toBe(personnage);
    await shot(other, '13-second-appareil');
  });

  it('320 px : aucun débordement horizontal, nulle part', async () => {
    const [, small] = await device(320, 640);
    await small.goto(`${server.url}/`);
    await small.getByRole('button', { name: 'J’ai déjà un compte' }).click();
    await small.getByLabel('Identifiant').fill(LOGIN);
    await small.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await small.getByRole('button', { name: 'Se connecter' }).click();
    await small.getByText(`${LOGIN}`).first().waitFor();
    for (const path of ['/', '/personnage', '/compte', '/apparence', '/installer', '/raveloc/', '/raveloc/groupes', '/finances/', '/perf/']) {
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
    // Le Personnage du premier compte ne suit pas : le nouveau part de zéro.
    expect(await page.evaluate(() => localStorage.getItem('mylife:stats:perf'))).toBeNull();
    await page.goto(`${server.url}/`);
    await page.getByText('Ton personnage t’attend').waitFor();
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

  it('bilan et Wrapped : carte du dimanche, carte de début de mois, stories, image partagée', async () => {
    const [ctx, p] = await device();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const plusDays = (day: string, n: number) => iso(new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000));
    // Un dimanche à venir, et le 3 du mois qui le suit.
    const sunday = plusDays(weekStart(localToday()), 13);
    const nextMonth = new Date(Date.parse(`${sunday}T12:00:00Z`));
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 3);
    const third = iso(nextMonth);
    const weeks = (to: string, n: number, counters: Record<string, number>) => Object.fromEntries(Array.from({ length: n }, (_, i) => [addWeeks(weekStart(to), -i), counters]));
    const inject = (at: string) =>
      p.evaluate(
        ([perf, finances, raveloc]) => {
          localStorage.setItem('mylife:stats:perf', JSON.stringify({ v: 1, at: Date.now(), weeks: perf, goal: 3 }));
          localStorage.setItem('mylife:stats:finances', JSON.stringify({ v: 1, at: Date.now(), weeks: finances }));
          localStorage.setItem('mylife:stats:raveloc', JSON.stringify({ v: 1, at: Date.now(), weeks: raveloc }));
        },
        [weeks(at, 10, { sessions: 3, records: 1 }), weeks(at, 10, { under: 6, tracked: 7 }), weeks(at, 2, { groups: 1, friends: 3 })],
      );

    // Horloge figée : les animations ne s'y jouent pas (captures de ces écrans : voir l'étape du Personnage).
    await p.clock.setFixedTime(new Date(`${sunday}T10:00:00`));
    await p.goto(`${server.url}/`);
    await p.getByRole('button', { name: 'J’ai déjà un compte' }).click();
    await p.getByLabel('Identifiant').fill(LOGIN);
    await p.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await p.getByRole('button', { name: 'Se connecter' }).click();
    await p.getByText(`${LOGIN}`).first().waitFor();
    await inject(sunday);
    await p.goto(`${server.url}/`);
    // Dimanche : « Ta semaine, en bref ».
    await p.getByText('Ta semaine, en bref').waitFor();
    await shot(p, '16-carte-semaine');
    await p.getByRole('link', { name: /^Ta semaine du/ }).click();
    await p.getByText('3 séances · 1 record').waitFor();
    await p.getByText('6 jours sous ton budget sur 7').waitFor();
    await p.getByText('Semaine réussie').first().waitFor();
    // Masquée une fois vue.
    await p.goto(`${server.url}/`);
    await p.getByRole('link', { name: /Ton personnage/ }).waitFor();
    expect(await p.getByText('Ta semaine, en bref').count()).toBe(0);

    // Le 3 du mois suivant : le Wrapped du mois fini.
    await p.clock.setFixedTime(new Date(`${third}T10:00:00`));
    await p.goto(`${server.url}/`);
    await inject(third);
    await p.reload();
    const card = p.getByRole('link', { name: /Ton Wrapped de .+ est prêt/ });
    await card.waitFor();
    await card.click();
    await p.getByRole('dialog', { name: /Wrapped de/ }).waitFor();
    for (let i = 0; i < 8 && !(await p.getByRole('button', { name: 'Partager l’image' }).isVisible()); i++) {
      await p.mouse.click(300, 420);
      await p.waitForTimeout(450);
    }
    await p.getByRole('button', { name: 'Partager l’image' }).waitFor();
    const download = p.waitForEvent('download');
    await p.getByRole('button', { name: 'Partager l’image' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^mylife-wrapped-\d{4}-\d{2}\.png$/);
    if (process.env.SHOTS) await file.saveAs(`${process.env.SHOTS}/21-wrapped-image.png`);
    await ctx.close();
  });

  it('aucune erreur JavaScript', () => {
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
