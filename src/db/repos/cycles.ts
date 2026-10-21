import { addDays } from '@/domain/dates';
import { parseMesoKind } from '@/domain/mesoTypes';
import { DEFAULT_DELOAD, DEFAULT_SCHEME_4, generateScheme, LEGACY_S4, sameWeek, totalWeeks } from '@/domain/mesocycle';
import type { Macrocycle, Mesocycle } from '@/domain/types';

import { db, newId } from '../db';
import { insertRaw, selectRaw } from '../raw';
import { getKv, setKv } from './settings';
import { parseDeloadWeek, parseScheme } from '../parse';

interface MesoRow {
  id: string;
  name: string;
  macrocycle_id: string | null;
  start_date: string;
  work_weeks: number;
  deload_weeks: number;
  scheme: string;
  deload_load_factor: number;
  deload_volume_factor: number;
  deload_top_reps: number;
  deload_backoff_reps: number;
  deload_main: string | null;
  kind: string;
  notes: string;
}

function toMeso(r: MesoRow): Mesocycle {
  return {
    id: r.id,
    name: r.name,
    kind: parseMesoKind(r.kind),
    macrocycleId: r.macrocycle_id,
    startDate: r.start_date,
    workWeeks: r.work_weeks,
    deloadWeeks: r.deload_weeks,
    scheme: parseScheme(r.scheme),
    deload: {
      main: parseDeloadWeek(r.deload_main, DEFAULT_DELOAD.main),
      loadFactor: r.deload_load_factor,
      volumeFactor: r.deload_volume_factor,
    },
    notes: r.notes,
  };
}

/** Oldest first. */
export function listMesocycles(): Mesocycle[] {
  return db().all<MesoRow>('SELECT * FROM mesocycles ORDER BY start_date, created_at').map(toMeso);
}

export function getMesocycle(id: string): Mesocycle | null {
  const r = db().first<MesoRow>('SELECT * FROM mesocycles WHERE id = ?', [id]);
  return r === null ? null : toMeso(r);
}

/**
 * Name of the next cycle: the highest « Cycle N » + 1 (other names like « Bloc 1 » don't count),
 * so a program starting with a warm-up block still numbers its cycles 1, 2, 3…
 */
export function nextCycleName(names: readonly string[]): string {
  const numbers = names.flatMap((n) => {
    const m = /^cycle\s+(\d+)/i.exec(n.trim());
    return m?.[1] === undefined ? [] : [Number(m[1])];
  });
  return `Cycle ${numbers.length === 0 ? names.length + 1 : Math.max(...numbers) + 1}`;
}

/** Defaults for a new cycle: chains right after the last one, same shape. */
export function draftNextMesocycle(startFallback: string): Omit<Mesocycle, 'id'> {
  const all = listMesocycles();
  const last = all[all.length - 1];
  if (last === undefined) {
    return {
      name: 'Cycle 1',
      kind: 'accumulation',
      macrocycleId: null,
      startDate: startFallback,
      workWeeks: 4,
      deloadWeeks: 1,
      scheme: generateScheme(4),
      deload: { ...DEFAULT_DELOAD, main: { ...DEFAULT_DELOAD.main } },
      notes: '',
    };
  }
  return {
    name: nextCycleName(all.map((m) => m.name)),
    kind: last.kind,
    macrocycleId: last.macrocycleId,
    startDate: addDays(last.startDate, totalWeeks(last) * 7),
    workWeeks: last.workWeeks,
    deloadWeeks: last.deloadWeeks,
    scheme: last.scheme.map((w) => ({ ...w })),
    deload: { ...last.deload },
    notes: '',
  };
}

export function saveMesocycle(meso: Omit<Mesocycle, 'id'> & { id?: string }): string {
  const id = meso.id ?? newId();
  db().run(
    `INSERT INTO mesocycles (id, name, macrocycle_id, start_date, work_weeks, deload_weeks, scheme,
       deload_load_factor, deload_volume_factor, deload_top_reps, deload_backoff_reps, deload_main, kind, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, macrocycle_id = excluded.macrocycle_id,
       start_date = excluded.start_date, work_weeks = excluded.work_weeks, deload_weeks = excluded.deload_weeks,
       scheme = excluded.scheme, deload_load_factor = excluded.deload_load_factor,
       deload_volume_factor = excluded.deload_volume_factor, deload_top_reps = excluded.deload_top_reps,
       deload_backoff_reps = excluded.deload_backoff_reps, deload_main = excluded.deload_main, kind = excluded.kind, notes = excluded.notes`,
    [
      id,
      meso.name.trim(),
      meso.macrocycleId,
      meso.startDate,
      meso.workWeeks,
      meso.deloadWeeks,
      JSON.stringify(meso.scheme),
      meso.deload.loadFactor,
      meso.deload.volumeFactor,
      meso.deload.main.topRepsMin,
      meso.deload.main.backoffReps,
      JSON.stringify(meso.deload.main),
      meso.kind,
      meso.notes,
      Date.now(),
    ],
  );
  return id;
}

/** Workouts keep existing (mesocycle_id → NULL); only the grouping disappears. */
export function deleteMesocycle(id: string): void {
  db().run('DELETE FROM mesocycles WHERE id = ?', [id]);
}

/**
 * Deletes a mesocycle and returns how to undo it: the cycle row, its per-exercise week overrides
 * (cascade-deleted) and the link of its workouts (set to null) come back exactly as they were.
 */
export function deleteMesocycleUndoable(id: string): () => void {
  const meso = selectRaw('mesocycles', 'id = ?', [id])[0] ?? null;
  const overrides = selectRaw('cycle_week_overrides', 'mesocycle_id = ?', [id]);
  const workouts = db().all<{ id: string }>('SELECT id FROM workouts WHERE mesocycle_id = ?', [id]).map((w) => w.id);
  deleteMesocycle(id);
  return () => {
    if (meso === null) return;
    db().transaction(() => {
      insertRaw('mesocycles', meso);
      for (const o of overrides) insertRaw('cycle_week_overrides', o);
      for (const w of workouts) db().run('UPDATE workouts SET mesocycle_id = ? WHERE id = ?', [id, w]);
    });
  };
}

interface MacroRow {
  id: string;
  name: string;
  notes: string;
}

export function listMacrocycles(): Macrocycle[] {
  return db().all<MacroRow>('SELECT id, name, notes FROM macrocycles ORDER BY created_at');
}

export function saveMacrocycle(name: string, id: string = newId()): string {
  db().run(
    `INSERT INTO macrocycles (id, name, notes, created_at) VALUES (?, ?, '', ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
    [id, name.trim(), Date.now()],
  );
  return id;
}

export function deleteMacrocycle(id: string): void {
  db().run('DELETE FROM macrocycles WHERE id = ?', [id]);
}

const HEAVY_S4_KEY = 'upgrade_heavy_s4';

/**
 * One-shot (oct. 2026): S4 of the pre-filled accumulation went from 1×3 @88 % to 1×2 @92.5 %.
 * 4-week cycles whose S4 is still exactly the old pre-filled one, and whose S4 has not started
 * (no session from day 22 on), get the new S4. Any cycle the user tuned is left alone.
 */
export function upgradeLegacyS4(): number {
  if (getKv(HEAVY_S4_KEY) !== null) return 0;
  const s4 = DEFAULT_SCHEME_4[3];
  let changed = 0;
  if (s4 !== undefined) {
    for (const m of listMesocycles()) {
      const current = m.scheme[3];
      if (m.workWeeks !== 4 || current === undefined || !sameWeek(current, LEGACY_S4)) continue;
      const started = db().first<{ n: number }>('SELECT COUNT(*) AS n FROM workouts WHERE mesocycle_id = ? AND date >= ?', [m.id, addDays(m.startDate, 21)]);
      if ((started?.n ?? 0) > 0) continue;
      saveMesocycle({ ...m, scheme: m.scheme.map((w, i) => (i === 3 ? { ...s4 } : w)) });
      changed += 1;
    }
  }
  setKv(HEAVY_S4_KEY, String(Date.now()));
  return changed;
}
