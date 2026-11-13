import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contractErrors, enabledModules, parsePrefs, toggleModule, type ModuleManifest } from '../app/src/contract';
import { splitAmount } from '../app/src/legacy/glance';
import { MODULES } from '../app/src/modules';
import { ICON_NAMES } from '../packages/kit/src/icons';
import { isSlowDevice, resolveTheme } from '../packages/kit/src/theme';

/** La fondation de la V5 : le contrat de module, le registre, l'isolation des modules, le kit. */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const mod = (over: Partial<ModuleManifest> = {}): ModuleManifest => ({ id: 'demo', name: 'Démo', tagline: 'Un module', icon: 'card', tone: 'neutral', status: 'active', entry: { href: '/demo' }, cards: [], quickAdds: [], ...over });

describe('contrat de module', () => {
  it('le registre de MyLife est conforme', () => {
    expect(contractErrors(MODULES)).toEqual([]);
    expect(MODULES.map((m) => m.id)).toEqual(['finances', 'perf', 'rave', 'chef']);
    for (const m of MODULES) expect(ICON_NAMES, `icône de ${m.id}`).toContain(m.icon);
  });

  it('chaque faute est nommée : identifiant, doublon, adresse hors de MyLife, carte mal nommée, module « bientôt » qui propose', () => {
    const Card = () => null;
    expect(contractErrors([mod({ id: 'Demo' })])).toEqual(['Demo : identifiant invalide']);
    expect(contractErrors([mod(), mod()])).toEqual(['demo : identifiant en double']);
    expect(contractErrors([mod({ entry: { href: 'https://ailleurs.test' } })])[0]).toMatch(/adresse de MyLife/);
    expect(contractErrors([mod({ cards: [{ id: 'autre.carte', title: 'x', Component: Card }] })])[0]).toMatch(/commencer par « demo\. »/);
    expect(contractErrors([mod({ status: 'soon', cards: [{ id: 'demo.carte', title: 'x', Component: Card }] })])[0]).toMatch(/bientôt/);
    expect(contractErrors([mod({ quickAdds: [{ id: 'demo.ajout', label: 'x', detail: 'y', icon: 'plus', href: 'javascript:alert(1)' }] })])[0]).toMatch(/dans MyLife/);
  });

  it('un module éteint n’apparaît nulle part ; un module « bientôt » non plus ; le choix se relit prudemment', () => {
    expect(enabledModules(MODULES, { off: [] }).map((m) => m.id)).toEqual(['finances', 'perf', 'rave']);
    const off = toggleModule({ off: [] }, 'perf', false);
    expect(enabledModules(MODULES, off).map((m) => m.id)).toEqual(['finances', 'rave']);
    expect(toggleModule(off, 'perf', true)).toEqual({ off: [] });
    expect(parsePrefs({ off: ['perf', 'perf', 42, '../x'] })).toEqual({ off: ['perf'] });
    expect(parsePrefs('n’importe quoi')).toEqual({ off: [] });
  });
});

describe('isolation des modules', () => {
  it('un module n’importe jamais un autre module (seulement le kit, le cœur, lumen, le contrat, la passerelle et son dossier)', () => {
    const dir = 'app/src/modules';
    const folders = readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    expect(folders.sort()).toEqual(['finances', 'perf', 'rave']);
    for (const folder of folders)
      for (const f of readdirSync(new URL(`../${dir}/${folder}`, import.meta.url))) {
        const imports = [...read(`${dir}/${folder}/${f}`).matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
        for (const i of imports) expect(/^(react|react-router-dom|@mylife\/(kit|lumen|core\/.+)|\.\/.+|\.\.\/\.\.\/(contract|legacy\/glance))$/.test(i), `${folder}/${f} importe ${i}`).toBe(true);
      }
  });
});

describe('kit', () => {
  it('chaque couleur de module existe en sombre et en clair', () => {
    const css = read('packages/kit/src/kit.css');
    for (const tone of ['finances', 'perf', 'rave', 'chef', 'neutral']) {
      expect(css).toMatch(new RegExp(`\\n\\.tone-${tone} \\{`));
      expect(css).toContain(`:root[data-theme='clair'] .tone-${tone} {`);
    }
    // Le verre devient une surface pleine quand le flou n'est pas possible ou pas voulu.
    expect(css).toContain('.no-blur .glass');
    expect(css).toContain('prefers-reduced-transparency');
  });

  it('thème : le choix l’emporte, « comme le téléphone » suit le système ; appareil lent détecté', () => {
    expect(resolveTheme('auto', true)).toBe('clair');
    expect(resolveTheme('auto', false)).toBe('sombre');
    expect(resolveTheme('sombre', true)).toBe('sombre');
    expect(isSlowDevice({ deviceMemory: 2, hardwareConcurrency: 8 })).toBe(true);
    expect(isSlowDevice({ deviceMemory: 8, hardwareConcurrency: 8 })).toBe(false);
    expect(isSlowDevice({})).toBe(false);
  });
});

describe('passerelle vers les apps d’avant', () => {
  it('le montant d’un aperçu se met en grand ; un aperçu sans montant reste entier', () => {
    expect(splitAmount('25,35 € à dépenser aujourd’hui')).toEqual({ amount: '25,35 €', rest: 'à dépenser aujourd’hui' });
    expect(splitAmount('−3,20 € aujourd’hui')).toBeNull();
    expect(splitAmount('1 250 € à dépenser')).toEqual({ amount: '1 250 €', rest: 'à dépenser' });
    expect(splitAmount('Jambes')).toBeNull();
  });
});
