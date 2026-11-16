import type { EngineState } from './state';

/**
 * Les réglages du moteur, découpés en lignes pour la synchro entre appareils : une ligne par engagement, par
 * enveloppe, par décision sur une opération… Deux appareils qui changent deux choses différentes ne s'écrasent pas ;
 * sur une même ligne, la modification la plus récente gagne. Fonctions pures.
 */
export const ROW_SEP = '\u0001';
export type StateRows = Map<string, unknown>;

/** Les listes : chaque élément devient une ligne, avec son rang pour retrouver l'ordre. */
const LISTS = {
  commitments: (x: { id: string }) => x.id,
  envelopes: (x: { id: string }) => x.id,
  provisions: (x: { id: string }) => x.id,
  installmentPlans: (x: { id: string }) => x.id,
  occurrenceOverrides: (x: { id: string }) => x.id,
  rules: (x: { id: string }) => x.id,
  receivables: (x: { id: string }) => x.id,
  categories: (x: { id: string }) => x.id,
  tags: (x: { id: string }) => x.id,
  accounts: (x: { id: string }) => x.id,
  manual: (x: { transaction: { id: string } }) => x.transaction.id,
  closedCycles: (x: { start: string }) => x.start,
  ignoredSuggestions: (x: string) => x,
} as const;
/** Les dictionnaires : une ligne par clé. */
const MAPS = ['allocationPatches', 'accountPatches', 'merchantDefaults', 'splits'] as const;
/** Les valeurs seules. */
const SINGLES = ['settings', 'carryIn', 'lastCycleStart', 'projectionRateBp'] as const;
/** Ce qui doit exister même vide. */
const REQUIRED_LISTS = new Set(['commitments', 'envelopes', 'provisions', 'installmentPlans', 'occurrenceOverrides', 'closedCycles']);

const key = (tbl: string, rid: string) => `${tbl}${ROW_SEP}${rid}`;

export function toRows(s: EngineState): StateRows {
  const rows: StateRows = new Map();
  const any = s as unknown as Record<string, unknown>;
  for (const [field, id] of Object.entries(LISTS)) {
    const list = any[field];
    if (Array.isArray(list)) list.forEach((v, i) => rows.set(key(field, (id as (x: unknown) => string)(v)), { i, v }));
  }
  for (const field of MAPS) for (const [k, v] of Object.entries((any[field] as Record<string, unknown> | undefined) ?? {})) rows.set(key(field, k), v);
  for (const field of SINGLES) if (any[field] !== undefined) rows.set(key('single', field), { v: any[field] });
  return rows;
}

/** L'état que décrivent ces lignes ; null si l'essentiel manque (les réglages). */
export function fromRows(rows: StateRows): EngineState | null {
  const lists: Record<string, { i: number; rid: string; v: unknown }[]> = {};
  const maps: Record<string, Record<string, unknown>> = {};
  const singles: Record<string, unknown> = {};
  for (const [k, row] of rows) {
    const at = k.indexOf(ROW_SEP);
    const tbl = k.slice(0, at);
    const rid = k.slice(at + 1);
    if (tbl === 'single') singles[rid] = (row as { v: unknown }).v;
    else if (tbl in LISTS) (lists[tbl] ??= []).push({ i: Number((row as { i: number }).i) || 0, rid, v: (row as { v: unknown }).v });
    else if ((MAPS as readonly string[]).includes(tbl)) (maps[tbl] ??= {})[rid] = row;
  }
  if (!singles.settings || typeof singles.settings !== 'object') return null;
  const out: Record<string, unknown> = { version: 1 };
  for (const field of Object.keys(LISTS)) {
    const list = lists[field];
    if (list) out[field] = list.sort((a, b) => a.i - b.i || a.rid.localeCompare(b.rid)).map((x) => x.v);
    else if (REQUIRED_LISTS.has(field)) out[field] = [];
  }
  for (const field of MAPS) if (maps[field]) out[field] = maps[field];
  out.allocationPatches ??= {};
  for (const field of SINGLES) if (field in singles) out[field] = singles[field];
  out.carryIn ??= { global: 0, envelopes: {} };
  out.lastCycleStart ??= null;
  return out as unknown as EngineState;
}

/** Les lignes qui diffèrent entre deux états (ajoutées, changées, retirées). */
export function diffRows(before: StateRows, after: StateRows): string[] {
  const changed: string[] = [];
  for (const [k, v] of after) if (!before.has(k) || JSON.stringify(before.get(k)) !== JSON.stringify(v)) changed.push(k);
  for (const k of before.keys()) if (!after.has(k)) changed.push(k);
  return changed;
}
