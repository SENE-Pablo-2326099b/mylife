import type { BodyEntry, BodyMetric } from '@/domain/types';

import { db, newId } from '../db';
import { parseBodyMetric } from '../parse';

interface BodyRow {
  id: string;
  date: string;
  metric: string;
  value: number;
}

const toEntry = (r: BodyRow): BodyEntry => ({ id: r.id, date: r.date, metric: parseBodyMetric(r.metric), value: r.value });

export function listBodyEntries(metric: BodyMetric): BodyEntry[] {
  return db()
    .all<BodyRow>('SELECT id, date, metric, value FROM body_entries WHERE metric = ? ORDER BY date, created_at', [metric])
    .map(toEntry);
}

export function addBodyEntry(metric: BodyMetric, date: string, value: number): string {
  const id = newId();
  db().run('INSERT INTO body_entries (id, date, metric, value, created_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    date,
    metric,
    value,
    Date.now(),
  ]);
  return id;
}

export function deleteBodyEntry(id: string): void {
  db().run('DELETE FROM body_entries WHERE id = ?', [id]);
}

/** Latest bodyweight on or before `date` — snapshotted on each workout for bodyweight-loaded maths. */
export function latestBodyweight(date: string): number | null {
  return (
    db().first<{ value: number }>(
      "SELECT value FROM body_entries WHERE metric = 'bodyweight' AND date <= ? ORDER BY date DESC, created_at DESC LIMIT 1",
      [date],
    )?.value ?? null
  );
}

export function latestPerMetric(): Map<BodyMetric, BodyEntry> {
  const rows = db().all<BodyRow>(
    `SELECT b.id, b.date, b.metric, b.value FROM body_entries b
     WHERE b.id = (SELECT id FROM body_entries b2 WHERE b2.metric = b.metric ORDER BY date DESC, created_at DESC LIMIT 1)`,
  );
  return new Map(rows.map((r) => [parseBodyMetric(r.metric), toEntry(r)]));
}
