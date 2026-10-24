/**
 * Parcours complet dans Chrome (deux téléphones simulés : Alice et Bob), contre le serveur local
 * (vraie API MyRave + vraie authentification MyLife, base en mémoire).
 * Les positions GPS et l'orientation sont SIMULÉES ici, et seulement ici (options du navigateur de test).
 * Prérequis : npm run build. CHROME_PATH pour un autre navigateur que /usr/bin/google-chrome.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { startLocalServer, type LocalServer } from '../../server/local';

const PORT = 4321;
const ALICE = { latitude: 48.8566, longitude: 2.3522, accuracy: 8 };
/** ~120 m au nord-est d'Alice. */
const BOB = { latitude: 48.8575, longitude: 2.3535, accuracy: 10 };

let server: LocalServer;
let browser: Browser;
let alice: Page;
let bob: Page;
let aliceCtx: BrowserContext;
const errors: string[] = [];
/** SHOTS=dossier : captures d'écran aux étapes clés (revue visuelle). */
const shot = async (page: Page, name: string) => void (process.env.SHOTS && (await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` })));

async function phone(geolocation: typeof ALICE): Promise<[BrowserContext, Page]> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', geolocation, permissions: ['geolocation'] });
  ctx.setDefaultTimeout(20_000);
  // THEME=brut (par exemple) : tout le parcours dans ce thème (revue visuelle des identités).
  if (process.env.THEME) await ctx.addInitScript((t) => localStorage.setItem('mylife:appearance', JSON.stringify({ theme: t, followSystem: false, reduceMotion: true, haptics: true, at: 1 })), process.env.THEME);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text()) && errors.push(m.text()));
  return [ctx, page];
}

/** Création du compte MyLife en un écran (identifiant + mot de passe), puis la clé de secours mise de côté. */
async function signUp(page: Page, login: string) {
  await page.getByLabel('Identifiant').fill(login);
  await page.getByText('Libre').waitFor();
  await page.getByLabel('Mot de passe', { exact: true }).fill('mot-de-passe-de-test');
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.getByText('Ta clé de secours').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'C’est fait, je l’ai mise de côté' }).click();
}

beforeAll(async () => {
  server = await startLocalServer({ port: PORT });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome' });
  [aliceCtx, alice] = await phone(ALICE);
  [, bob] = await phone(BOB);
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('MyRave de bout en bout', () => {
  let link = '';

  it('connexion avec un compte MyLife, puis création d’un groupe', async () => {
    await alice.goto(`${server.url}/raveloc/`);
    await alice.getByText('Crée ton compte').waitFor();
    await shot(alice, '01-connexion');
    await signUp(alice, 'test-e2e-alice');
    await alice.getByText('Aucun groupe pour l’instant').waitFor();
    await shot(alice, '02-aucun-groupe');
    await alice.getByRole('link', { name: 'Créer un groupe' }).click();
    await alice.getByRole('button', { name: 'Rave de ce soir' }).click();
    await alice.getByLabel('Ton pseudo').fill('Alice');
    await alice.getByRole('button', { name: 'Créer et inviter' }).click();
    await alice.getByText('Gérer le groupe').waitFor();
    await alice.getByRole('heading', { name: 'Rave de ce soir' }).waitFor();
  });

  it('invitation d’un ami : lien avec la clé dans le fragment', async () => {
    await alice.getByRole('button', { name: /Créer et partager un lien/ }).click();
    link = (await alice.locator('code').first().textContent())!.trim();
    expect(link).toMatch(new RegExp(`^${server.url}/raveloc/#rejoindre=[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}$`));
    await alice.getByText(/0 utilisation/).waitFor();
    await shot(alice, '03-gerer-inviter');
  });

  it('l’ami ouvre le lien, crée son compte et rejoint le groupe', async () => {
    await bob.goto(link);
    await bob.getByText(/Tu as reçu une invitation/).waitFor();
    expect(bob.url()).not.toContain('rejoindre'); // la clé a quitté la barre d'adresse
    await signUp(bob, 'test-e2e-bob');
    await bob.getByText('Rave de ce soir').waitFor();
    await bob.getByLabel('Ton pseudo').fill('Bob');
    await bob.getByRole('button', { name: 'Rejoindre le groupe' }).click();
    await bob.getByText('Ta position n’est pas partagée').waitFor();
    // Bob voit Alice, qui ne partage pas.
    await bob.getByRole('button', { name: /Retrouver Alice — Ne partage pas sa position/ }).waitFor();
    await shot(bob, '04-groupe-sans-partage');
  });

  it('activer le partage : la position est réellement transmise', async () => {
    await bob.getByRole('button', { name: 'Partager ma position' }).click();
    await bob.getByRole('dialog', { name: 'Partager ma position' }).getByText(/l’autre membre du groupe/).waitFor();
    await shot(bob, '05-feuille-partage');
    await bob.getByRole('button', { name: 'Partager', exact: true }).click();
    await bob.getByText('Partage actif').waitFor();
    await bob.getByText(/Position transmise/).waitFor();
    const { rows } = await server.db.query<{ payload: string }>('SELECT payload FROM raveloc_positions');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).not.toContain('48.85'); // chiffrée
  });

  it('l’autre membre reçoit la position, horodatée, avec une distance arrondie', async () => {
    await alice.getByRole('button', { name: 'Retour' }).click();
    const card = alice.getByRole('button', { name: /Retrouver Bob — Position à jour/ });
    await card.waitFor({ timeout: 25_000 });
    await alice.getByText(/^≈ 1[0-5]0\s?m$/).waitFor();
    await shot(alice, '06-groupe-ami-localise');
    await shot(bob, '07-partage-actif');
  });

  it('sélection d’un ami et navigation directionnelle', async () => {
    await alice.getByRole('button', { name: /Retrouver Bob/ }).click();
    await alice.getByRole('heading', { name: 'Bob' }).waitFor();
    await alice.locator('.distance').getByText(/^≈ 1[0-5]0\s?m$/).waitFor();
    await alice.getByText(/vers le nord-est/).waitFor();
    await shot(alice, '08-navigation-sans-boussole');
    // Pas de capteur dans ce navigateur : on le dit, la flèche est orientée nord en haut.
    // Chrome expose requestPermission comme iOS : sans cap reçu, l'app propose d'autoriser la boussole.
    await alice.getByRole('button', { name: 'Activer' }).click({ timeout: 8000 });
    // Pas de capteur (ou accès refusé par ce navigateur de test) : on le dit, nord en haut.
    await alice.getByText(/(Pas de boussole disponible|Accès à la boussole refusé).*La flèche est orientée nord en haut/).waitFor({ timeout: 8000 });
    const north = await alice.locator('.dial .rotor').nth(1).evaluate((el) => (el as HTMLElement).style.transform);
    expect(Number(/rotate\(([-\d.]+)deg\)/.exec(north)![1])).toBeGreaterThan(30);
    // Boussole simulée (événements d'orientation absolue) : je me tourne vers le nord-est (cap 40°).
    await alice.evaluate(() => {
      const fire = () => {
        const e = new Event('deviceorientationabsolute');
        Object.assign(e, { alpha: 320, beta: 10, gamma: 0, absolute: true });
        window.dispatchEvent(e);
      };
      (window as unknown as { __fake: number }).__fake = window.setInterval(fire, 30);
    });
    await alice.getByText('Tiens le téléphone à plat, devant toi.').waitFor();
    await alice.waitForTimeout(800);
    const rot = await alice.locator('.dial .rotor').nth(1).evaluate((el) => (el as HTMLElement).style.transform);
    const deg = Number(/rotate\(([-\d.]+)deg\)/.exec(rot)![1]);
    const signed = deg > 180 ? deg - 360 : deg;
    expect(Math.abs(signed)).toBeLessThan(10); // ami droit devant
    await shot(alice, '09-navigation-boussole');
    await alice.evaluate(() => window.clearInterval((window as unknown as { __fake: number }).__fake));
  });

  it('perte de réseau puis reprise', async () => {
    await aliceCtx.setOffline(true);
    await alice.getByText(/Hors ligne\. Les positions affichées ne bougent plus/).waitFor();
    // La dernière position reste affichée, avec son âge, pas comme une position en direct.
    await alice.locator('.distance').waitFor();
    await shot(alice, '10-hors-ligne');
    await aliceCtx.setOffline(false);
    await alice.getByText('Connexion rétablie.').waitFor({ timeout: 15_000 });
  });

  it('arrêter le partage : révocation immédiate chez l’autre', async () => {
    await bob.getByRole('button', { name: 'Arrêter' }).click();
    await bob.getByText('Ta position n’est pas partagée').waitFor();
    expect((await server.db.query('SELECT * FROM raveloc_positions')).rows).toEqual([]);
    await alice.getByText(/Bob ne partage pas sa position/).waitFor({ timeout: 15_000 });
    await shot(alice, '11-ami-ne-partage-plus');
  });

  it('retirer un membre : il perd l’accès au groupe', async () => {
    await alice.getByRole('button', { name: 'Retour' }).click();
    await alice.getByRole('link', { name: 'Gérer' }).click();
    await alice.getByRole('button', { name: 'Retirer', exact: true }).click();
    await alice.getByRole('button', { name: 'Confirmer', exact: true }).click();
    await alice.getByText(/Membres \(1\)/).waitFor();
    await bob.getByText('Aucun groupe pour l’instant').waitFor({ timeout: 25_000 });
  });

  it('lien révoqué : plus utilisable', async () => {
    await alice.getByRole('button', { name: 'Révoquer' }).click();
    await alice.getByText('Aucun lien actif.').waitFor();
    await bob.goto(link);
    await bob.getByText(/Invitation invalide, expirée ou révoquée/).waitFor();
  });

  it('session expirée : retour à la connexion, sans écran vide', async () => {
    await bob.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('mylife-session')!);
      s.token = `${s.token.split('.')[0]}.${'x'.repeat(43)}`; // signature invalide
      localStorage.setItem('mylife-session', JSON.stringify(s));
    });
    await bob.goto(`${server.url}/raveloc/`);
    await bob.getByText(/Session expirée : reconnecte-toi/).waitFor();
    await shot(bob, '12-session-expiree');
  });

  it('petit écran (320 px) : aucun débordement horizontal', async () => {
    await alice.setViewportSize({ width: 320, height: 640 });
    await alice.getByRole('button', { name: 'Retour' }).click();
    const overflow = await alice.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(alice, '13-groupe-320px');
  });

  it('aucune erreur JavaScript pendant le parcours', () => {
    expect(errors).toEqual([]);
  });
});
