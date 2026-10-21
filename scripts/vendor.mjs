#!/usr/bin/env node
// Copie les paquets partagés dans chaque app MyLife : une seule source, pas de paquet à publier.
// - packages/sync-client/src → src/vendor/mylife-sync (compte et synchro chiffrée)
// - packages/lumen/src       → src/vendor/lumen       (thèmes et jetons Lumen)
// Relancer après toute modification d'un paquet : npm run vendor
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const APPS = {
  finances: new URL('../../Budget/src/vendor', import.meta.url).pathname,
  perf: new URL('../../MyPerfV2/src/vendor', import.meta.url).pathname,
};
const PACKAGES = { 'sync-client': 'mylife-sync', lumen: 'lumen' };

for (const [pkg, folder] of Object.entries(PACKAGES)) {
  const src = new URL(`../packages/${pkg}/src`, import.meta.url).pathname;
  const header = `// GÉNÉRÉ depuis MyLife/packages/${pkg} — ne pas modifier ici (MyLife : npm run vendor).\n`;
  for (const [app, root] of Object.entries(APPS)) {
    const dir = join(root, folder);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(src).filter((n) => n.endsWith('.ts'))) {
      writeFileSync(join(dir, name), header + readFileSync(join(src, name), 'utf8'));
    }
    console.log(`✓ ${pkg} → ${app} (${dir})`);
  }
}
