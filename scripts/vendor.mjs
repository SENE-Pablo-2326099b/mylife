#!/usr/bin/env node
// Copie les paquets partagés dans chaque app MyLife : une seule source, pas de paquet à publier.
// - packages/sync-client/src → src/vendor/mylife-sync (compte et synchro chiffrée)        : toutes les apps
// - packages/lumen/src       → src/vendor/lumen       (thèmes, jetons, registre des apps) : toutes les apps
// - packages/ui/src          → src/ui                 (kit d'interface web : verre, identités,
//                                                       navigation, écrans, compte)          : apps web React DOM
// Relancer après toute modification d'un paquet : npm run vendor (ou npm run vendor -- finances raveloc).
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const here = (p) => new URL(p, import.meta.url).pathname;
const APPS = {
  home: { root: here('../web/src'), web: true },
  finances: { root: here('../apps/finances/src'), web: true },
  perf: { root: here('../apps/perf/src'), web: false },
  raveloc: { root: here('../apps/raveloc/src'), web: true },
};
const PACKAGES = [
  { pkg: 'sync-client', dest: 'vendor/mylife-sync', web: false },
  { pkg: 'lumen', dest: 'vendor/lumen', web: false },
  { pkg: 'ui', dest: 'ui', web: true },
];
const header = (pkg, name) => {
  const text = `GÉNÉRÉ depuis MyLife/packages/${pkg} — ne pas modifier ici (MyLife : npm run vendor).`;
  return name.endsWith('.css') ? `/* ${text} */\n` : `// ${text}\n`;
};

const only = process.argv.slice(2);
for (const { pkg, dest, web } of PACKAGES) {
  const src = here(`../packages/${pkg}/src`);
  const files = readdirSync(src).filter((n) => /\.(ts|tsx|css|js)$/.test(n) && !n.endsWith('.test.ts'));
  for (const [app, { root, web: isWeb }] of Object.entries(APPS)) {
    if ((web && !isWeb) || (only.length && !only.includes(app))) continue;
    const dir = join(root, dest);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const name of files) writeFileSync(join(dir, name), header(pkg, name) + readFileSync(join(src, name), 'utf8'));
    console.log(`✓ ${pkg} → ${app} (${dir})`);
  }
}
