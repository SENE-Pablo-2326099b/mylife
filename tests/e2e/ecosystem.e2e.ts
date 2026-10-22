/**
 * MyLife de bout en bout, comme sur un téléphone : premier lancement, compte créé en un écran, puis
 * les trois apps sur la même adresse avec la même session, le même thème, la même installation ;
 * et sur un second appareil, le thème qui suit par la synchro chiffrée.
 * Prérequis : l'accueil (npm run build) et les trois apps construites (voir README).
 * CHROME_PATH pour un autre navigateur que /usr/bin/google-chrome ; SHOTS=dossier pour des captures.
 */
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
    for (const path of ['/', '/compte', '/apparence', '/installer', '/raveloc/', '/raveloc/groupes', '/finances/', '/perf/']) {
      await small.goto(`${server.url}${path}`);
      await small.waitForTimeout(1200);
      expect(await overflow(small), path).toBeLessThanOrEqual(0);
    }
  });

  it('aucune erreur JavaScript', () => {
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
