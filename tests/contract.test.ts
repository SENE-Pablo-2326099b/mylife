import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOME_APPS, MYLIFE_DESTINATIONS } from '../packages/lumen/src/index';
import { PERSONAL_PREFIXES } from '../packages/sync-client/src/device';
import { SYNC_APPS } from '../server/core';
import { APP_EXPORTS } from '../web/src/appData';

/**
 * Le contrat d'app (docs/CONTRAT-APP.md) : chaque app de l'accueil branche toutes ses prises. Une app ajoutée sans
 * l'une d'elles fait échouer ce test, avant qu'un oubli ne laisse des données d'un compte à un autre.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const routes = read('web/src/App.tsx');
const icons = read('packages/ui/src/icons.tsx');
const prefs = read('packages/ui/src/prefsSync.ts');
const webFiles = (dir: string): string[] =>
  readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'vendor' || e.name === 'ui' ? [] : webFiles(`${dir}/${e.name}`)) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []));

describe('contrat d’app : chaque app de l’accueil branche toutes ses prises', () => {
  it('identifiants et chemins uniques', () => {
    expect(new Set(HOME_APPS.map((a) => a.id)).size).toBe(HOME_APPS.length);
    expect(new Set(HOME_APPS.map((a) => a.path)).size).toBe(HOME_APPS.length);
  });

  for (const app of HOME_APPS) {
    describe(app.name, () => {
      it('une route, une destination de la palette, une icône du kit', () => {
        expect(routes, `route ${app.path}`).toContain(`path="${app.path}"`);
        expect(MYLIFE_DESTINATIONS.some((d) => d.path === app.path), `palette ${app.path}`).toBe(true);
        expect(icons, `icône ${app.icon}`).toMatch(new RegExp(`['"]?${app.icon}['"]?\\s*:`));
      });

      it('ce qu’elle garde sur l’appareil est effacé quand un autre compte se connecte', () => {
        for (const prefix of app.storage) expect(PERSONAL_PREFIXES.some((p) => prefix.startsWith(p)), prefix).toBe(true);
      });

      it('ses données partent chiffrées par une synchro déclarée', () => {
        if ('app' in app.sync) expect(Object.keys(SYNC_APPS)).toContain(app.sync.app);
        if ('mylife' in app.sync) for (const tbl of app.sync.mylife) expect(prefs, `ligne ${tbl} de mylife`).toContain(`tbl: '${tbl}'`);
      });

      it('dans « Mes données » si elle est exportable, et décrite sur la page de confidentialité', () => {
        if (app.exportable) expect(APP_EXPORTS[app.id], `export de ${app.id}`).toBeTypeOf('function');
        expect(app.privacy.length).toBeGreaterThan(5);
      });
    });
  }

  it('une collection synchronisée appartient à une app de synchro déclarée et à une app du registre', () => {
    const uses = webFiles('web/src').flatMap((f) => [...read(f).matchAll(/defineCollection(?:<[^>]*>)?\(\{\s*app:\s*'([a-z0-9]+)'/g)].map((m) => m[1]!));
    for (const app of new Set(uses)) {
      expect(Object.keys(SYNC_APPS), `SYNC_APPS.${app}`).toContain(app);
      expect(HOME_APPS.some((a) => 'app' in a.sync && a.sync.app === app), `registre : sync { app: '${app}' }`).toBe(true);
    }
  });

  it('la page de confidentialité et l’accueil lisent le registre', () => {
    expect(read('web/src/pages/Privacy.tsx')).toContain('HOME_APPS');
    expect(read('web/src/pages/Home.tsx')).toContain('HOME_APPS');
    expect(read('web/src/pages/Data.tsx')).toContain('APP_EXPORTS');
  });
});
