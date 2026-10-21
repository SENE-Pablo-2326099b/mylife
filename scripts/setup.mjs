#!/usr/bin/env node
// Configuration guidée : `npm run setup`.
// 1. connexion à Vercel, 2. premier déploiement (donne l'URL de retour pour Enable Banking),
// 3. Application ID + clé .pem → variables d'environnement Vercel, 4. redéploiement et vérification,
// 5. lien de configuration à ouvrir sur le téléphone.
// Relançable sans risque : chaque étape déjà faite est sautée (ou proposée à nouveau).
import { spawn, spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERCEL = ['--yes', 'vercel@61.1.0'];
const PROJECT = process.env.VERCEL_PROJECT || 'myfinances';
const KEY_COPY = join(homedir(), '.secrets', `${PROJECT}-enablebanking.pem`);
const ENV_LOCAL = join(ROOT, '.env.local');
// Options pour un usage sans questions : --app-id=<id> --pem=<chemin>.
const ARGS = Object.fromEntries(process.argv.slice(2).map((a) => /^--([a-z-]+)=(.*)$/.exec(a)).filter(Boolean).map((m) => [m[1], m[2]]));
const INTERACTIVE = process.stdin.isTTY;

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const step = (n, s) => console.log(`\n${bold(`── ${n}. ${s}`)}`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, def = '') => (await rl.question(def ? `${q} [${def}] ` : `${q} `)).trim() || def;
const yes = async (q, def = true) => /^(o|oui|y|yes)$/i.test(await ask(`${q} (o/n)`, def ? 'o' : 'n'));

/** Lance la CLI Vercel. `capture` : renvoie stdout+stderr ; sinon terminal interactif. */
function vercel(args, { capture = false, input } = {}) {
  if (!capture) return spawnSync('npx', [...VERCEL, ...args], { cwd: ROOT, stdio: 'inherit' }).status === 0;
  return new Promise((done) => {
    const child = spawn('npx', [...VERCEL, ...args], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.stdin.end(input ?? '');
    child.on('close', (code) => done({ ok: code === 0, out }));
  });
}

/** Mot de passe facile à recopier sur un téléphone (sans caractères ambigus), ~99 bits. */
function makePassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const group = () => Array.from({ length: 5 }, () => abc[randomInt(abc.length)]).join('');
  return [group(), group(), group(), group()].join('-');
}

function readEnvLocal() {
  if (!existsSync(ENV_LOCAL)) return {};
  return Object.fromEntries(
    readFileSync(ENV_LOCAL, 'utf8')
      .split('\n')
      .map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
}

function writeEnvLocal(values) {
  const merged = { ...readEnvLocal(), ...values };
  const lines = ['# Écrit par `npm run setup` — jamais commité (.gitignore).', ...Object.entries(merged).map(([k, v]) => `${k}=${v}`)];
  writeFileSync(ENV_LOCAL, lines.join('\n') + '\n', { mode: 0o600 });
}

/** Dernières clés .pem téléchargées (Linux, et Windows via WSL). */
function findPemFiles() {
  const dirs = [join(homedir(), 'Downloads'), join(homedir(), 'Téléchargements')];
  try {
    for (const u of readdirSync('/mnt/c/Users')) dirs.push(join('/mnt/c/Users', u, 'Downloads'));
  } catch {
    /* pas sous WSL */
  }
  const found = [];
  for (const d of dirs) {
    try {
      for (const f of readdirSync(d)) if (f.endsWith('.pem')) found.push(join(d, f));
    } catch {
      /* dossier absent ou illisible */
    }
  }
  return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

async function setEnv(name, value) {
  await vercel(['env', 'rm', name, 'production', '--yes'], { capture: true });
  const r = await vercel(['env', 'add', name, 'production'], { capture: true, input: value });
  if (!r.ok) throw new Error(`Impossible d'enregistrer ${name} dans Vercel :\n${r.out}`);
}

async function deploy() {
  console.log('Déploiement en cours (1 à 2 minutes)…');
  const r = await vercel(['deploy', '--prod', '--yes'], { capture: true });
  if (!r.ok) {
    console.log(r.out);
    throw new Error('Le déploiement a échoué (voir ci-dessus).');
  }
  const deployment = r.out.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi)?.[0];
  // L'adresse stable du projet est l'alias le plus court (l'adresse propre au déploiement est protégée).
  const inspect = deployment ? await vercel(['inspect', deployment], { capture: true }) : { out: '' };
  const urls = [...new Set(`${r.out}\n${inspect.out}`.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/gi) ?? [])].map((u) => u.toLowerCase());
  urls.sort((a, b) => a.length - b.length);
  // Seul le domaine de production est public : les adresses d'équipe et de déploiement sont protégées par Vercel.
  for (const u of urls) {
    const res = await fetch(`${u}/confidentialite.html`, { redirect: 'manual' }).catch(() => null);
    if (res?.status === 200) return u;
  }
  throw new Error(`Aucune adresse publique trouvée parmi :\n${urls.join('\n')}\n(Vercel → Settings → Deployment Protection)`);
}

async function probe(url, password) {
  try {
    const res = await fetch(`${url}/api/eb`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bridge-password': password }, body: '{"op":"status"}' });
    return { http: res.status, ...(await res.json().catch(() => ({}))) };
  } catch (e) {
    return { http: 0, error: e.message };
  }
}

async function main() {
  console.log(bold('\nMyFinances — configuration de la connexion bancaire\n'));
  console.log("Ce script met l'app en ligne sur Vercel (gratuit, HTTPS), puis branche Enable Banking.");
  console.log('Tes données bancaires ne sont jamais stockées sur Vercel : elles restent sur ton téléphone.');

  step(1, 'Compte Vercel');
  const who = await vercel(['whoami'], { capture: true });
  if (!who.ok || /log in|logged out/i.test(who.out)) {
    console.log('Connexion à Vercel (crée un compte gratuit si besoin, « Continue with GitHub » est le plus simple) :');
    if (!vercel(['login'])) throw new Error('Connexion à Vercel annulée.');
  } else console.log(green(`Connecté : ${who.out.trim().split('\n').pop()}`));

  step(2, 'Projet Vercel');
  if (!existsSync(join(ROOT, '.vercel', 'project.json'))) {
    const r = await vercel(['link', '--yes', '--project', PROJECT], { capture: true });
    if (!r.ok) throw new Error(`Liaison du projet impossible :\n${r.out}`);
  }
  console.log(green(`Projet « ${PROJECT} » prêt.`));

  const local = readEnvLocal();
  const password = local.BRIDGE_PASSWORD || makePassword();
  if (!local.BRIDGE_PASSWORD) writeEnvLocal({ BRIDGE_PASSWORD: password });

  step(3, 'Premier déploiement');
  let url = local.APP_URL;
  let status = url ? await probe(url, password) : null;
  if (!status?.authenticated) {
    await setEnv('BRIDGE_PASSWORD', password);
    url = await deploy();
    writeEnvLocal({ APP_URL: url });
    status = await probe(url, password);
  }
  console.log(green(`L'app est en ligne : ${url}`));

  const redirect = `${url}/connexion/retour`;
  const given = ARGS['app-id'] && ARGS.pem;
  if (!given && status?.configured && (!INTERACTIVE || !(await yes('Enable Banking est déjà configuré. Changer d’application ou de clé ?', false)))) {
    return finish(url, password);
  }

  step(4, 'Application Enable Banking');
  console.log(`Ouvre ${bold('https://enablebanking.com/cp/applications')} → « Register new application » :`);
  console.log(`  • Environment : ${bold('Production')}`);
  console.log(`  • Redirect URLs : ${bold(redirect)}`);
  console.log(`  • Email for data protection matters : ton adresse e-mail`);
  console.log(`  • Privacy URL : ${bold(`${url}/confidentialite.html`)}`);
  console.log(`  • Terms URL : ${bold(`${url}/confidentialite.html#conditions`)}`);
  console.log('  • Key : « Generate in the browser (using SubtleCrypto) and export private key » → un fichier .pem se télécharge');
  console.log('Puis, sur la page de l’application : « Link accounts » pour lier ta (tes) banque(s) et activer l’app.');
  if (!given && !INTERACTIVE) {
    console.log(yellow('\nRelance ensuite : npm run setup -- --app-id=<Application ID> --pem=<chemin du .pem>'));
    return;
  }
  if (!given) await ask('\nAppuie sur Entrée quand c’est fait…');

  let appId = ARGS['app-id'] ?? '';
  while (!/^[0-9a-f-]{36}$/i.test(appId)) {
    if (!INTERACTIVE) throw new Error(`Application ID invalide : ${appId}`);
    appId = await ask('Application ID (affiché sur la page de l’application) :', local.EB_APP_ID || '');
    if (!/^[0-9a-f-]{36}$/i.test(appId)) console.log(yellow('Format attendu : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'));
  }

  let pemPath = '';
  let pem = '';
  while (!pem) {
    const guess = findPemFiles()[0] ?? (existsSync(KEY_COPY) ? KEY_COPY : '');
    pemPath = (ARGS.pem ?? (await ask('Chemin du fichier .pem téléchargé :', guess))).replace(/^['"]|['"]$/g, '');
    if (ARGS.pem) delete ARGS.pem;
    // Chemin Windows collé tel quel (C:\Users\…) → chemin WSL.
    const win = /^([a-z]):\\(.*)$/i.exec(pemPath);
    if (win) pemPath = `/mnt/${win[1].toLowerCase()}/${win[2].replace(/\\/g, '/')}`;
    try {
      const text = readFileSync(pemPath, 'utf8');
      if (/-----BEGIN (RSA )?PRIVATE KEY-----/.test(text)) pem = text;
      else console.log(yellow('Ce fichier ne contient pas de clé privée.'));
    } catch {
      console.log(yellow('Fichier introuvable.'));
    }
    if (!pem && !INTERACTIVE) throw new Error(`Clé .pem illisible : ${pemPath}`);
  }
  if (resolve(pemPath) !== KEY_COPY) {
    mkdirSync(dirname(KEY_COPY), { recursive: true, mode: 0o700 });
    copyFileSync(pemPath, KEY_COPY);
    chmodSync(KEY_COPY, 0o600);
    console.log(green(`Clé copiée dans ${KEY_COPY} (tu peux supprimer celle du dossier Téléchargements).`));
  }

  step(5, 'Variables Vercel et redéploiement');
  await setEnv('EB_APP_ID', appId);
  await setEnv('EB_PRIVATE_KEY', Buffer.from(pem).toString('base64'));
  await setEnv('EB_REDIRECT_URLS', redirect);
  writeEnvLocal({ EB_APP_ID: appId, EB_PRIVATE_KEY_PATH: KEY_COPY });
  url = await deploy();
  status = await probe(url, password);
  if (status.configured && status.authenticated) console.log(green('Relais vérifié : configuré et protégé par mot de passe.'));
  else console.log(red(`Le relais ne répond pas comme prévu : ${JSON.stringify(status)}`));
  return finish(url, password);
}

function finish(url, password) {
  step(6, 'Sur ton téléphone');
  const link = `${url}/synchro#relais=${password}`;
  console.log(`Adresse de l'app : ${bold(url)}`);
  console.log(`Mot de passe du relais : ${bold(password)}  (aussi dans .env.local)`);
  console.log(`\n${bold('iPhone')} : ouvre ${url} dans Safari → Partager → « Sur l'écran d'accueil ».`);
  console.log("  Ouvre l'app depuis l'écran d'accueil → Réglages → Banques → saisis le mot de passe ci-dessus.");
  console.log('  (Sur iPhone, l’app installée ne partage pas ses données avec Safari : saisis-le bien dans l’app.)');
  console.log(`${bold('Android / ordinateur')} : ce lien enregistre le mot de passe directement :\n  ${link}`);
  console.log("\nEnsuite : Banques → « Ajouter une banque » → ta banque → connexion sur son site → retour dans l'app.");
  console.log(`Pour Trade Republic / Bitstack : Patrimoine → ajouter un placement (positions + investissement programmé).\n`);
}

main()
  .catch((e) => {
    console.error(red(`\n${e.message}`));
    process.exitCode = 1;
  })
  .finally(() => rl.close());
