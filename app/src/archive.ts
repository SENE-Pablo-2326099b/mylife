import { readAccountApp } from '@mylife/core/index';
import { currentSession, webPlatform } from '@mylife/core/web';

/**
 * Archive des fonctions retirées en V5 (docs/VISION.md § 3) : Personnage, Bilan, Crew, MyMusique, MyGames, « Mes apps »,
 * MyObjectifs, MyAgenda, MyFoyer, et MyChef (gelé). Leurs données restent dans le compte le temps d'une version, puis
 * le serveur les efface : ce fichier permet de les emporter avant. Tout est lu et déchiffré sur l'appareil.
 */

/** Apps de synchro qui ne servent plus à aucun écran (MyChef est gelé : ses données restent dans le compte). */
export const RETIRED_SYNC_APPS = ['miniapps', 'objectifs', 'calendrier', 'chef'] as const;

/** Ce que les fonctions retirées gardaient sur l'appareil. */
export const RETIRED_PREFIXES = ['mylife:stats', 'mylife:character', 'mylife:music', 'mylife:games', 'mylife:miniapps', 'mylife:app:objectifs:', 'mylife:app:calendrier:', 'mylife:app:chef:'] as const;

const SECRET = '(lien secret, non exporté)';

/** Les liens ICS sont des adresses secrètes : jamais dans un fichier qu'on peut partager. */
function hideLinks(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(hideLinks);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'url' && typeof x === 'string' && x ? SECRET : hideLinks(x)]));
  return v;
}

function deviceData(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !RETIRED_PREFIXES.some((p) => key.startsWith(p))) continue;
      const raw = localStorage.getItem(key);
      try {
        out[key] = hideLinks(JSON.parse(raw ?? 'null'));
      } catch {
        out[key] = raw;
      }
    }
  } catch {
    /* stockage indisponible */
  }
  return out;
}

export interface RetiredArchive {
  format: 'mylife-archive-v5';
  exportedAt: string;
  account: string | null;
  /** Lignes du compte, par app de synchro (et les lignes de `mylife` autres que l'apparence). */
  account_data: Record<string, { tbl: string; rid: string; updatedAt: number | null; row: unknown }[]>;
  /** Ce que cet appareil garde encore pour ces fonctions. */
  device: Record<string, unknown>;
  /** Apps qu'on n'a pas pu lire (hors ligne…). */
  errors: Record<string, string>;
}

export async function buildRetiredArchive(): Promise<RetiredArchive> {
  const session = currentSession();
  const archive: RetiredArchive = { format: 'mylife-archive-v5', exportedAt: new Date().toISOString(), account: session?.login ?? null, account_data: {}, device: deviceData(), errors: {} };
  if (!session) return archive;
  for (const app of [...RETIRED_SYNC_APPS, 'mylife'] as const) {
    try {
      const rows = await readAccountApp(webPlatform.api, session, app, webPlatform.random);
      archive.account_data[app] = rows
        .filter((r) => !(app === 'mylife' && r.tbl === 'prefs' && r.rid === 'appearance'))
        .map((r) => ({ tbl: r.tbl, rid: r.rid, updatedAt: r.updatedAt ?? null, row: hideLinks(r.row) }));
    } catch (e) {
      archive.errors[app] = e instanceof Error ? e.message : String(e);
    }
  }
  return archive;
}
