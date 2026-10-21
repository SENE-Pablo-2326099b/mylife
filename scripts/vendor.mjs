#!/usr/bin/env node
// Copie le client de synchro (packages/sync-client/src) dans chaque app MyLife : une seule source,
// pas de paquet à publier. Relancer après toute modification du client : npm run vendor
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../packages/sync-client/src', import.meta.url).pathname;
const TARGETS = {
  finances: new URL('../../Budget/src/vendor/mylife-sync', import.meta.url).pathname,
  perf: new URL('../../MyPerfV2/src/vendor/mylife-sync', import.meta.url).pathname,
};
const HEADER = '// GÉNÉRÉ depuis MyLife/packages/sync-client — ne pas modifier ici (MyLife : npm run vendor).\n';

for (const [app, dir] of Object.entries(TARGETS)) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(SRC).filter((n) => n.endsWith('.ts'))) {
    writeFileSync(join(dir, name), HEADER + readFileSync(join(SRC, name), 'utf8'));
  }
  console.log(`✓ ${app} → ${dir}`);
}
