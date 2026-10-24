// npm run new-app <id> "<Nom>" [--icon <icône>] [--tagline "<une ligne>"]
// Crée une app de l'accueil déjà branchée sur toute la prise MyLife (docs/CONTRAT-APP.md) : moteur pur et son test,
// collection synchronisée, écran (chargé à la demande), registre, route, palette, export de « Mes données », app de
// synchro déclarée au serveur. Puis affiche ce qui reste à faire à la main. `tests/contract.test.ts` vérifie le tout.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const icon = flag('icon', 'sparkles');
const [id, name] = args;
const tagline = flag('tagline', `${name ?? ''} : à décrire`);
if (!id || !name || !/^[a-z][a-z0-9-]{1,23}$/.test(id)) {
  console.error('Usage : npm run new-app <id> "<Nom>" [--icon <icône>] [--tagline "<une ligne>"]\n  id : minuscules, chiffres, tirets (ex. chef, plein-air).');
  process.exit(1);
}
const sync = id.replace(/-/g, '');
const plain = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim();
const pascal = plain.split(' ').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const camel = pascal[0].toLowerCase() + pascal.slice(1);
const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, '’');

const done = [];
function create(path, content) {
  const full = ROOT + path;
  if (existsSync(full)) throw new Error(`${path} existe déjà : rien n’a été écrit pour lui.`);
  writeFileSync(full, content);
  done.push(`créé    ${path}`);
}
function insert(path, marker, text, { before = true } = {}) {
  const full = ROOT + path;
  const s = readFileSync(full, 'utf8');
  const line = s.split('\n').find((l) => l.includes(marker));
  if (!line) throw new Error(`Repère « ${marker} » introuvable dans ${path}.`);
  writeFileSync(full, s.replace(line, before ? `${text}\n${line}` : `${line}\n${text}`));
  done.push(`modifié ${path}`);
}

const existing = readFileSync(ROOT + 'packages/lumen/src/homeApps.ts', 'utf8');
if (existing.includes(`id: '${id}'`)) {
  console.error(`L’app « ${id} » existe déjà dans le registre.`);
  process.exit(1);
}

try {
  create(
    `packages/lumen/src/${id}.ts`,
    `/**
 * ${name} : moteur pur (aucune base, aucune interface), généré par \`npm run new-app\`. À compléter : la forme d'un
 * élément, sa lecture prudente (tout ce qui arrive d'un autre appareil est vérifié), les calculs de l'app.
 * Jamais rien de personnel dans les valeurs par défaut.
 */
export interface ${pascal}Item {
  v: 1;
  name: string;
  note: string;
}

/** Lecture prudente d'un élément synchronisé : null s'il ne ressemble à rien de connu. */
export function parse${pascal}Item(raw: unknown): ${pascal}Item | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || typeof o.name !== 'string' || !o.name.trim()) return null;
  return { v: 1, name: o.name.trim().slice(0, 80), note: typeof o.note === 'string' ? o.note.slice(0, 500) : '' };
}
`,
  );
  create(
    `tests/${id}.test.ts`,
    `import { describe, expect, it } from 'vitest';
import { parse${pascal}Item } from '../packages/lumen/src/${id}';

describe('${q(name)} : moteur', () => {
  it('lecture prudente d’un élément synchronisé', () => {
    expect(parse${pascal}Item({ v: 1, name: '  Essai  ', note: 'x' })).toEqual({ v: 1, name: 'Essai', note: 'x' });
    expect(parse${pascal}Item({ v: 2, name: 'Essai' })).toBeNull();
    expect(parse${pascal}Item({ v: 1, name: '' })).toBeNull();
    expect(parse${pascal}Item(null)).toBeNull();
  });
});
`,
  );
  create(
    `web/src/${camel}Data.ts`,
    `import { parse${pascal}Item } from './vendor/lumen';
import { defineCollection } from './ui/collectionSync';

/** Données de ${name}, chiffrées et synchronisées (app de synchro \`${sync}\`, une ligne par élément). */
export const ${camel}Items = defineCollection({ app: '${sync}', name: 'items', parse: parse${pascal}Item });
`,
  );
  create(
    `web/src/pages/${pascal}.tsx`,
    `import { useState } from 'react';
import { ${camel}Items } from '../${camel}Data';
import { Icon } from '../ui/icons';
import { Button, Card, EmptyState, Group, Reveal, Row, TextField } from '../ui/index';
import { Screen } from '../ui/Screen';

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

/** ${name} (généré par \`npm run new-app\`) : à construire à partir d'ici, avec le kit. */
export function ${pascal}Page() {
  const items = ${camel}Items.useList();
  const [name, setName] = useState('');
  const add = () => {
    if (!name.trim()) return;
    ${camel}Items.put(newId(), { v: 1, name: name.trim(), note: '' });
    setName('');
  };
  return (
    <Screen stack title="${q(name)}" kicker="MyLife" mood="settings" back="/">
      <Reveal index={0}>
        <Card>
          <TextField label="Nouvel élément" value={name} onChange={setName} enterKeyHint="done" />
          <Button className="mt-3" icon="add" onClick={add} disabled={!name.trim()}>
            Ajouter
          </Button>
        </Card>
      </Reveal>
      <Reveal index={1} className="mt-3">
        {items.length === 0 ? (
          <Card>
            <EmptyState icon="${icon}" title="Rien pour l’instant" body="Ajoute un premier élément : il suit sur tous tes appareils, chiffré." />
          </Card>
        ) : (
          <Group>
            {items.map((i) => (
              <Row key={i.id} title={i.value.name} right={<button type="button" aria-label={\`Supprimer \${i.value.name}\`} onClick={() => ${camel}Items.remove(i.id)}><Icon name="close" /></button>} />
            ))}
          </Group>
        )}
      </Reveal>
    </Screen>
  );
}
`,
  );
  insert('packages/lumen/src/homeApps.ts', 'new-app: entrées', `  { id: '${id}', name: '${q(name)}', path: '/${id}', icon: '${icon}', tagline: '${q(tagline)}', storage: ['mylife:app:${sync}:'], sync: { app: '${sync}' }, exportable: true, privacy: '${q(name)} : à décrire' },`);
  insert('packages/lumen/src/index.ts', 'new-app: moteurs', `export * from './${id}';`);
  insert('packages/lumen/src/index.ts', 'new-app: destinations', `  { app: 'home', title: '${q(name)}', path: '/${id}', keywords: '${q(plain.toLowerCase())}' },`);
  insert('web/src/App.tsx', 'new-app: pages', `const ${pascal}Page = lazy(() => import('./pages/${pascal}').then((m) => ({ default: m.${pascal}Page })));`, { before: false });
  insert(
    'web/src/App.tsx',
    'new-app: routes',
    `              <Route path="/${id}" element={<Suspense fallback={null}><${pascal}Page /></Suspense>} />`,
  );
  insert('web/src/appData.ts', 'new-app: exports', `  '${id}': () => ${camel}Items.list(),`);
  const appData = readFileSync(ROOT + 'web/src/appData.ts', 'utf8');
  writeFileSync(ROOT + 'web/src/appData.ts', `import { ${camel}Items } from './${camel}Data';\n${appData}`);
  const core = readFileSync(ROOT + 'server/core.ts', 'utf8');
  if (!/export const SYNC_APPS = \{[^}]*\} as const;/.test(core)) throw new Error('SYNC_APPS introuvable dans server/core.ts.');
  writeFileSync(ROOT + 'server/core.ts', core.replace(/(export const SYNC_APPS = \{[^}]*?)\s*\} as const;/, `$1, ${sync}: 5_000 } as const;`));
  done.push('modifié server/core.ts');
} catch (e) {
  console.error(`\n✗ ${e.message}\nCe qui a déjà été écrit :\n${done.map((d) => `  ${d}`).join('\n')}`);
  process.exit(1);
}

console.log(`\n✓ ${name} créée (/${id}, synchro « ${sync} »)\n${[...new Set(done)].map((d) => `  ${d}`).join('\n')}

Reste à faire (docs/CONTRAT-APP.md) :
  1. npm run vendor, puis npm test (tests/contract.test.ts et tests/${id}.test.ts).
  2. Le vrai moteur dans packages/lumen/src/${id}.ts, et ses tests.
  3. La phrase de confidentialité (« privacy ») et la ligne d'accueil (« tagline ») dans packages/lumen/src/homeApps.ts.
  4. Si elle fait monter le Personnage : ses compteurs par semaine et sa stat (« stat »).
  5. Copilot : un outil de lecture dans web/src/copilot.ts.
  6. Wrapped et Bilan : une story et une ligne.
  7. Crew : ce qui est partageable, jamais de donnée brute.
  8. Un parcours dans tests/e2e/ecosystem.e2e.ts (dont 320 px et un autre compte qui repart de zéro).
  9. Le journal docs/V4.md.`);
