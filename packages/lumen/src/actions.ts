/**
 * Actions validées (V4, F1) : Copilot propose, tu valides d'un toucher, et **c'est l'app concernée qui exécute**, avec
 * son propre code (ses règles, sa synchro). Une action validée attend dans une boîte d'envoi commune à l'adresse MyLife
 * (`mylife:actions`, sur l'appareil seulement, effacée quand un autre compte se connecte). L'app la prend tout de suite
 * si elle est ouverte, sinon à sa prochaine ouverture, puis note le résultat et l'action qui l'annule.
 * Rien ne s'exécute sans validation : une proposition de Copilot n'entre jamais seule dans la boîte.
 */

export type ActionApp = 'finances' | 'perf' | 'home' | 'chef';

export type ActionKind = 'finances.skipRecurring' | 'perf.movePlanned' | 'miniapp.addEntry' | 'miniapp.removeEntry' | 'chef.addToList' | 'chef.removeFromList' | 'chef.planMeal' | 'chef.clearMeal';

export interface ActionSpec {
  kind: ActionKind;
  params: Record<string, unknown>;
  /** Ce que fait l'action, en une phrase lisible (montrée avant la validation). */
  summary: string;
}

export interface MyLifeAction extends ActionSpec {
  id: string;
  app: ActionApp;
  createdAt: number;
  /** pending : validée, attend son app ; done : faite ; failed : l'app n'a pas pu. */
  status: 'pending' | 'done' | 'failed';
  doneAt?: number;
  error?: string;
  /** L'action qui défait celle-ci, fournie par l'app une fois faite. */
  undo?: ActionSpec | null;
}

export const ACTION_APP: Record<ActionKind, ActionApp> = {
  'finances.skipRecurring': 'finances',
  'perf.movePlanned': 'perf',
  'miniapp.addEntry': 'home',
  'miniapp.removeEntry': 'home',
  'chef.addToList': 'chef',
  'chef.removeFromList': 'chef',
  'chef.planMeal': 'chef',
  'chef.clearMeal': 'chef',
};

export const ACTION_APP_NAME: Record<ActionApp, string> = { finances: 'MyFinances', perf: 'MyPerf', home: 'Mes apps', chef: 'MyChef' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_:.+-]{1,200}$/;
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export type ParsedAction = { action: ActionSpec; error?: undefined } | { action?: undefined; error: string };

/** Lecture prudente d'une action (proposée par une IA, ou relue de la boîte) : paramètres vérifiés un par un. */
export function parseActionSpec(raw: unknown): ParsedAction {
  if (!raw || typeof raw !== 'object') return { error: 'Action illisible.' };
  const o = raw as Record<string, unknown>;
  const kind = o.kind as ActionKind;
  const p = (o.params && typeof o.params === 'object' ? o.params : {}) as Record<string, unknown>;
  const summary = str(o.summary, 160);
  if (!summary) return { error: 'Il manque la phrase qui décrit l’action (summary).' };
  switch (kind) {
    case 'finances.skipRecurring': {
      const itemId = str(p.itemId, 200);
      if (!ID.test(itemId) || typeof p.skip !== 'boolean') return { error: 'finances.skipRecurring : itemId (de get_finances → recurring) et skip (true/false).' };
      return { action: { kind, summary, params: { itemId, skip: p.skip } } };
    }
    case 'perf.movePlanned': {
      const plannedId = str(p.plannedId, 80);
      const date = str(p.date, 10);
      if (!ID.test(plannedId) || !DATE.test(date)) return { error: 'perf.movePlanned : plannedId (de get_training → planned) et date (AAAA-MM-JJ).' };
      return { action: { kind, summary, params: { plannedId, date } } };
    }
    case 'miniapp.addEntry': {
      const appId = str(p.appId, 32);
      const day = str(p.day, 10);
      const values = p.values && typeof p.values === 'object' && !Array.isArray(p.values) ? (p.values as Record<string, unknown>) : null;
      if (!/^[a-z0-9]{6,32}$/.test(appId) || !DATE.test(day) || !values) return { error: 'miniapp.addEntry : appId (de get_my_apps), day (AAAA-MM-JJ) et values (identifiant de champ → valeur).' };
      const clean: Record<string, number | string | boolean> = {};
      for (const [k, v] of Object.entries(values).slice(0, 8)) if (/^[a-z][a-z0-9_]{0,23}$/.test(k) && (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string')) clean[k] = typeof v === 'string' ? v.slice(0, 200) : v;
      return { action: { kind, summary, params: { appId, day, values: clean } } };
    }
    case 'miniapp.removeEntry': {
      const appId = str(p.appId, 32);
      const entryId = str(p.entryId, 32);
      if (!/^[a-z0-9]{6,32}$/.test(appId) || !/^[A-Za-z0-9_-]{1,32}$/.test(entryId)) return { error: 'miniapp.removeEntry : appId et entryId.' };
      return { action: { kind, summary, params: { appId, entryId } } };
    }
    case 'chef.addToList': {
      const name = str(p.name, 60);
      const qty = typeof p.qty === 'number' && p.qty > 0 && p.qty < 100_000 ? Math.round(p.qty * 100) / 100 : undefined;
      if (!name) return { error: 'chef.addToList : name (l’aliment), qty et unit facultatifs.' };
      return { action: { kind, summary, params: { name, ...(qty !== undefined ? { qty } : {}), ...(qty !== undefined && str(p.unit, 12) ? { unit: str(p.unit, 12) } : {}) } } };
    }
    case 'chef.removeFromList': {
      const itemId = str(p.itemId, 64);
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(itemId)) return { error: 'chef.removeFromList : itemId.' };
      return { action: { kind, summary, params: { itemId } } };
    }
    case 'chef.planMeal': {
      const day = str(p.day, 10);
      const recipeId = str(p.recipeId, 64);
      if (!DATE.test(day) || (p.slot !== 'midi' && p.slot !== 'soir') || !/^[A-Za-z0-9_-]{1,64}$/.test(recipeId)) return { error: 'chef.planMeal : day (AAAA-MM-JJ), slot (midi ou soir), recipeId (de get_kitchen → recipes).' };
      return { action: { kind, summary, params: { day, slot: p.slot, recipeId } } };
    }
    case 'chef.clearMeal': {
      const day = str(p.day, 10);
      if (!DATE.test(day) || (p.slot !== 'midi' && p.slot !== 'soir')) return { error: 'chef.clearMeal : day et slot.' };
      return { action: { kind, summary, params: { day, slot: p.slot } } };
    }
    default:
      return { error: `Action inconnue : ${String(o.kind)}. Possibles : ${Object.keys(ACTION_APP).join(', ')}.` };
  }
}

// ---------------------------------------------------------------- boîte d'envoi (sur l'appareil)

export const ACTIONS_KEY = 'mylife:actions';
export const ACTIONS_EVENT = 'mylife:actions';
const MAX_KEPT = 50;

const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function readActions(): MyLifeAction[] {
  try {
    const v = JSON.parse(storage()?.getItem(ACTIONS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(v)) return [];
    return v.flatMap((x) => {
      const o = x as Partial<MyLifeAction>;
      const parsed = parseActionSpec(o);
      if (!parsed.action || typeof o.id !== 'string' || typeof o.createdAt !== 'number' || !['pending', 'done', 'failed'].includes(o.status as string)) return [];
      return [{ ...o, ...parsed.action, app: ACTION_APP[parsed.action.kind] } as MyLifeAction];
    });
  } catch {
    return [];
  }
}

function writeActions(list: MyLifeAction[]): void {
  try {
    storage()?.setItem(ACTIONS_KEY, JSON.stringify(list.slice(-MAX_KEPT)));
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(ACTIONS_EVENT));
  } catch {
    /* stockage plein ou indisponible */
  }
}

/** Une action validée par l'utilisateur entre dans la boîte, en attente de son app. */
export function enqueueAction(spec: ActionSpec, id: string, now = Date.now()): MyLifeAction {
  const action: MyLifeAction = { ...spec, id, app: ACTION_APP[spec.kind], createdAt: now, status: 'pending' };
  writeActions([...readActions().filter((a) => a.id !== id), action]);
  return action;
}

/** Résultat noté par l'app qui a exécuté. */
export function settleAction(id: string, result: { ok: true; undo: ActionSpec | null } | { ok: false; error: string }, now = Date.now()): void {
  writeActions(readActions().map((a) => (a.id !== id ? a : result.ok ? { ...a, status: 'done', doneAt: now, undo: result.undo } : { ...a, status: 'failed', doneAt: now, error: result.error })));
}

/** Les actions validées qui attendent cette app. */
export const pendingActions = (app: ActionApp): MyLifeAction[] => readActions().filter((a) => a.app === app && a.status === 'pending');

/**
 * Exécute ce qui attend une app, une action après l'autre, avec l'exécuteur de l'app. Une erreur de l'exécuteur est
 * notée sur l'action (jamais avalée). Renvoie le nombre d'actions traitées.
 */
export async function runPendingActions(app: ActionApp, execute: (a: MyLifeAction) => Promise<ActionSpec | null>): Promise<number> {
  const list = pendingActions(app);
  for (const a of list) {
    try {
      settleAction(a.id, { ok: true, undo: await execute(a) });
    } catch (e) {
      settleAction(a.id, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return list.length;
}
