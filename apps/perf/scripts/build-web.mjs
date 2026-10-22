#!/usr/bin/env node
// Version web installable (PWA) de MyPerf, servie sous MyLife à l'adresse /perf/.
// 1. export Expo (baseUrl /perf dans app.json) dans web/perf ;
// 2. service worker (hors ligne : toute l'app est mise en cache) ;
// 3. index.html : manifeste et icône de MyLife (une seule app installable, portée /), transitions
//    entre apps, enregistrement du service worker.
// Usage : npm run build:web   puis   npm run deploy:web
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'web', 'perf');
const BASE = '/perf/';

rmSync(OUT, { recursive: true, force: true });
execSync(`npx expo export -p web --output-dir ${OUT}`, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' } });
if (existsSync(join(ROOT, 'web', 'static'))) cpSync(join(ROOT, 'web', 'static'), OUT, { recursive: true });

// Vercel n'envoie jamais un dossier nommé node_modules : les polices et icônes qu'Expo y range
// (assets/node_modules/…) sont déplacées dans assets/nm/ et les références réécrites.
if (existsSync(join(OUT, 'assets', 'node_modules'))) {
  renameSync(join(OUT, 'assets', 'node_modules'), join(OUT, 'assets', 'nm'));
  const rewrite = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) rewrite(p);
      else if (/\.(js|html|json|css)$/.test(name)) {
        const text = readFileSync(p, 'utf8');
        if (text.includes('/assets/node_modules/')) writeFileSync(p, text.split('/assets/node_modules/').join('/assets/nm/'));
      }
    }
  };
  rewrite(OUT);
}

// Les fichiers JS sont servis « immuables » : leur nom doit changer avec leur contenu (après réécriture).
// Tous les morceaux (entrée + chargés à la demande) sont renommés, et chaque référence mise à jour.
const jsDir = join(OUT, '_expo', 'static', 'js', 'web');
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10);
const replaceIn = (file, from, to) => writeFileSync(file, readFileSync(file, 'utf8').split(from).join(to));
const all = readdirSync(jsDir).filter((n) => n.endsWith('.js'));
// D'abord les morceaux chargés à la demande, puis l'entrée : son empreinte inclut les nouveaux noms.
const ordered = [...all.filter((n) => !n.startsWith('entry-')), ...all.filter((n) => n.startsWith('entry-'))];
const current = new Map(all.map((n) => [n, n]));
for (const name of ordered) {
  const file = join(jsDir, current.get(name));
  const renamed = name.replace(/\.js$/, `-${digest(file)}.js`);
  for (const other of [join(OUT, 'index.html'), ...[...current.values()].filter((n) => n !== current.get(name)).map((n) => join(jsDir, n))]) replaceIn(other, name, renamed);
  renameSync(file, join(jsDir, renamed));
  current.set(name, renamed);
}

// Liste des fichiers à mettre en cache, avec une empreinte : un nouveau build = un nouveau cache.
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (!/\.map$|^sw\.js$|metadata\.json$/.test(name)) files.push(relative(OUT, p).split('\\').join('/'));
  }
};
walk(OUT);
const hash = createHash('sha256');
for (const f of files.sort()) hash.update(f).update(readFileSync(join(OUT, f)));
const version = hash.digest('hex').slice(0, 12);

writeFileSync(
  join(OUT, 'sw.js'),
  `// Service worker MyPerf (généré par scripts/build-web.mjs) : l'app entière en cache, hors ligne.
const CACHE = 'myperf-${version}';
const BASE = '${BASE}';
const FILES = ${JSON.stringify(files.map((f) => BASE + f))};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('myperf-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(BASE)) return;
  // Navigation : la page de l'app (routeur côté client), depuis le cache si hors ligne.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match(BASE + 'index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
`,
);

writeFileSync(
  join(OUT, 'register-sw.js'),
  `if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('${BASE}sw.js', { scope: '${BASE}' }).then((reg) => {
    // Nouvelle version installée : on recharge une fois pour l'utiliser.
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => {
        if (w.state === 'activated' && navigator.serviceWorker.controller) location.reload();
      });
    });
    setInterval(() => reg.update().catch(() => {}), 3600000);
  });
}
`,
);

const indexPath = join(OUT, 'index.html');
// Passage d'une app MyLife à l'autre en fondu (mêmes règles que packages/ui/src/lumen.css de MyLife).
const VIEW_TRANSITION = `@view-transition{navigation:auto}::view-transition-old(root){animation:160ms cubic-bezier(.4,0,1,1) both mylife-out}::view-transition-new(root){animation:260ms cubic-bezier(.2,.8,.2,1) both mylife-in}@keyframes mylife-out{to{opacity:0;transform:scale(.985)}}@keyframes mylife-in{from{opacity:0;transform:translateY(14px)}}@media (prefers-reduced-motion:reduce){::view-transition-old(root),::view-transition-new(root){animation:none}}`;
const head = [
  // Une seule app installable : MyLife (manifeste et icône à la racine de l'adresse).
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '<meta name="theme-color" content="#0B0719">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '<meta name="apple-mobile-web-app-title" content="MyLife">',
  `<style>${VIEW_TRANSITION}</style>`,
  `<script src="${BASE}register-sw.js" defer></script>`,
].join('');
writeFileSync(indexPath, readFileSync(indexPath, 'utf8').replace('</head>', `${head}</head>`));
console.log(`\n✓ PWA MyPerf prête dans web/perf (version ${version}, ${files.length} fichiers en cache)`);
