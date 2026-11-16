import type { ComponentType } from 'react';
import type { IconName, Tone } from '@mylife/kit';

/**
 * Le contrat de module de MyLife V5 (docs/VISION.md § 4). Un module est une fiche d'identité : la coquille ne connaît
 * les modules que par elle, et **un module n'importe jamais un autre module** (règle vérifiée par le linter).
 * Volontairement court : on n'y ajoute un champ que le jour où un module en a besoin.
 */

/** Une carte que le module propose à l'accueil « Aujourd'hui ». */
export interface ModuleCardSpec {
  /** `<module>.<carte>` : unique dans tout MyLife. */
  id: string;
  title: string;
  Component: ComponentType;
}

/** Une saisie que le module propose au bouton « + ». */
export interface QuickAdd {
  id: string;
  label: string;
  /** Une ligne sous le libellé. */
  detail: string;
  icon: IconName;
  href: string;
}

/** Ce qu'ouvre le « + » : où il mène, et comment il se nomme (« Une opération », « Un compte »…). */
export interface ModuleAdd {
  to: string;
  label: string;
}

/** Une chose à faire que le module signale à la boîte « À faire ». */
export interface TodoItem {
  id: string;
  title: string;
  detail?: string;
  href: string;
}

export interface ModuleManifest {
  /** Identifiant stable : lettres minuscules et chiffres. Ne change jamais (il nomme les réglages et les données). */
  id: string;
  name: string;
  /** Une ligne : ce que fait le module. */
  tagline: string;
  icon: IconName;
  tone: Tone;
  /** `active` : utilisable ; `soon` : annoncé, sans écran. */
  status: 'active' | 'soon';
  /**
   * Où s'ouvre le module. `legacy` : une app d'avant la V5, encore servie à part, en attendant que le module soit
   * repensé et reconstruit dans la coquille (phases 3 à 5).
   */
  entry: { href: string; legacy?: boolean };
  cards: readonly ModuleCardSpec[];
  quickAdds: readonly QuickAdd[];
  /**
   * La navigation propre au module, quand il vit dans la coquille : `base` est le préfixe de ses adresses, `tabs`
   * ses onglets (quatre au plus, le « + » se glisse au milieu) et `add` ce qu'ouvre le « + » quand on y est. Le « + »
   * suit l'écran : un onglet peut donner sa propre saisie (`tabs[].add`), sinon c'est celle du module.
   */
  nav?: { base: string; add: ModuleAdd; tabs: readonly { to: string; label: string; icon: IconName; end?: boolean; add?: ModuleAdd }[] };
  /** Lu sur l'appareil, à chaque affichage. */
  todos?: () => TodoItem[];
}

const ID = /^[a-z][a-z0-9]{1,23}$/;

/** Les fautes d'un registre de modules (vide : tout est conforme). */
export function contractErrors(modules: readonly ModuleManifest[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const sub = new Set<string>();
  for (const m of modules) {
    if (!ID.test(m.id)) errors.push(`${m.id} : identifiant invalide`);
    if (seen.has(m.id)) errors.push(`${m.id} : identifiant en double`);
    seen.add(m.id);
    if (!m.name.trim() || !m.tagline.trim()) errors.push(`${m.id} : nom ou description manquants`);
    if (!m.entry.href.startsWith('/')) errors.push(`${m.id} : l'entrée doit être une adresse de MyLife (/…)`);
    if (m.status === 'soon' && (m.cards.length || m.quickAdds.length)) errors.push(`${m.id} : un module « bientôt » ne propose rien`);
    for (const item of [...m.cards, ...m.quickAdds]) {
      if (!item.id.startsWith(`${m.id}.`)) errors.push(`${item.id} : doit commencer par « ${m.id}. »`);
      if (sub.has(item.id)) errors.push(`${item.id} : identifiant en double`);
      sub.add(item.id);
    }
    for (const q of m.quickAdds) if (!q.href.startsWith('/')) errors.push(`${q.id} : l'adresse doit être dans MyLife (/…)`);
  }
  return errors;
}

/** Ce que l'utilisateur a choisi : les modules éteints (tout module actif est allumé par défaut). */
export interface ShellPrefs {
  off: string[];
}

export const DEFAULT_PREFS: ShellPrefs = { off: [] };

export function parsePrefs(raw: unknown): ShellPrefs {
  const off = (raw as { off?: unknown } | null)?.off;
  return { off: Array.isArray(off) ? [...new Set(off.filter((x): x is string => typeof x === 'string' && ID.test(x)))] : [] };
}

/** Les modules visibles : actifs et pas éteints. Un module éteint n'apparaît nulle part. */
export const enabledModules = (modules: readonly ModuleManifest[], prefs: ShellPrefs): ModuleManifest[] => modules.filter((m) => m.status === 'active' && !prefs.off.includes(m.id));

export function toggleModule(prefs: ShellPrefs, id: string, on: boolean): ShellPrefs {
  const off = prefs.off.filter((x) => x !== id);
  return { off: on ? off : [...off, id] };
}
