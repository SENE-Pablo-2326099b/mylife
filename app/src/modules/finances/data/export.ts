import { facts, TABLE_NAMES, type RawSettings } from './facts';
import { readState } from './stateStore';

/**
 * Toutes les données de MyFinances dans un fichier, fabriqué sur l'appareil : les faits (au format des sauvegardes de
 * l'ancienne app, qui sait les relire) et les réglages du moteur. Le mot de passe du relais et l'autorisation bancaire
 * en cours n'y sont jamais.
 */
export async function buildExport(): Promise<Record<string, unknown>> {
  const tables: Record<string, unknown[]> = {};
  for (const name of TABLE_NAMES) tables[name] = await facts.table(name).toArray();
  tables.settings = (tables.settings as RawSettings[]).map((s) => ({ ...s, bridgePassword: '', ebOwnApp: null }));
  tables.meta = (tables.meta as { key: string }[]).filter((m) => m.key !== 'pendingAuth');
  return { format: 'myfinances-backup', version: 2, exportedAt: new Date().toISOString(), tables, engine: (await readState()) ?? null };
}

export async function downloadExport(): Promise<void> {
  const blob = new Blob([JSON.stringify(await buildExport())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `myfinances-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
