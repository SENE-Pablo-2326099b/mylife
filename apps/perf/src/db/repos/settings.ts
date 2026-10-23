import { DEFAULT_PLATES } from '@/domain/plates';
import { DEFAULT_REST, type RestSettings } from '@/domain/rest';
import { THEME_IDS, type ThemeId } from '@/vendor/lumen';

import { db } from '../db';

/** Colour themes (palettes in src/ui/themes.ts), shared by the MyLife apps (MyLife/packages/lumen). */
export { THEME_IDS, type ThemeId };

export interface AppSettings {
  theme: ThemeId;
  /** Follow the phone's light / dark mode: the theme's counterpart is used when the scheme differs. */
  followSystem: boolean;
  /** Global load step in kg. */
  increment: number;
  defaultBackoffPercent: number;
  restAutoStart: boolean;
  restNotifications: boolean;
  rest: RestSettings;
  keepAwake: boolean;
  /** Plate calculator: empty bar and plates available in the gym (kg). */
  barWeight: number;
  plates: number[];
  /** Consistency: sessions per week that count as an "active" week. */
  weeklyGoal: number;
  /** Weekly hard-set targets per muscle (0 / absent = no target). */
  volumeTargets: Record<string, number>;
  /** Body weight goal (kg), null = none. */
  bodyweightGoal: number | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'nuit',
  followSystem: false,
  increment: 2.5,
  defaultBackoffPercent: 0.8,
  restAutoStart: true,
  restNotifications: false,
  rest: DEFAULT_REST,
  keepAwake: true,
  barWeight: 20,
  plates: [...DEFAULT_PLATES],
  weeklyGoal: 4,
  // Rien de personnel par défaut : chacun règle ses cibles et son objectif de poids.
  volumeTargets: {},
  bodyweightGoal: null,
};

const KEY = 'app';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const numOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const boolOr = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const sub = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});
const numList = (v: unknown, fallback: readonly number[]): number[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0) ? [...v] : [...fallback];
const numMap = (v: unknown, fallback: Record<string, number>): Record<string, number> => {
  if (!isRecord(v)) return { ...fallback };
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(v)) if (typeof x === 'number' && Number.isFinite(x) && x >= 0) out[k] = x;
  return out;
};

/** Stored JSON over defaults: unknown keys are ignored, missing or invalid ones fall back. */
export function parseSettings(raw: unknown): AppSettings {
  const d = DEFAULT_SETTINGS;
  const r = sub(raw);
  const rest = sub(r.rest);
  const floors = sub(rest.floors);
  const byIntention = sub(rest.byIntention);
  // Before the themes: 'light' / 'dark' / 'system' (light and dark became Perle and Nuit).
  const legacy: Record<string, ThemeId> = { light: 'perle', dark: 'nuit', system: 'nuit' };
  const theme = THEME_IDS.find((id) => id === r.theme) ?? (typeof r.theme === 'string' ? legacy[r.theme] : undefined) ?? d.theme;
  return {
    theme,
    followSystem: boolOr(r.followSystem, r.theme === 'system' ? true : d.followSystem),
    increment: numOr(r.increment, d.increment),
    defaultBackoffPercent: numOr(r.defaultBackoffPercent, d.defaultBackoffPercent),
    restAutoStart: boolOr(r.restAutoStart, d.restAutoStart),
    restNotifications: boolOr(r.restNotifications, d.restNotifications),
    keepAwake: boolOr(r.keepAwake, d.keepAwake),
    barWeight: numOr(r.barWeight, d.barWeight),
    plates: numList(r.plates, d.plates),
    weeklyGoal: numOr(r.weeklyGoal, d.weeklyGoal),
    volumeTargets: numMap(r.volumeTargets, d.volumeTargets),
    bodyweightGoal: r.bodyweightGoal === null ? null : numOr(r.bodyweightGoal, d.bodyweightGoal ?? 0) || null,
    rest: {
      floors: {
        main: numOr(floors.main, d.rest.floors.main),
        compound: numOr(floors.compound, d.rest.floors.compound),
        isolation: numOr(floors.isolation, d.rest.floors.isolation),
      },
      byIntention: {
        power: numOr(byIntention.power, d.rest.byIntention.power),
        strength: numOr(byIntention.strength, d.rest.byIntention.strength),
        hypertrophy: numOr(byIntention.hypertrophy, d.rest.byIntention.hypertrophy),
      },
      warmup: numOr(rest.warmup, d.rest.warmup),
    },
  };
}

export function loadSettings(): AppSettings {
  const row = db().first<{ value: string }>('SELECT value FROM settings WHERE key = ?', [KEY]);
  if (row === null) return DEFAULT_SETTINGS;
  try {
    return parseSettings(JSON.parse(row.value));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  db().run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    KEY,
    JSON.stringify(settings),
  ]);
}

/** Small key/value storage for app state that must survive a kill (e.g. the running rest timer). */
export function getKv(key: string): string | null {
  return db().first<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])?.value ?? null;
}

export function setKv(key: string, value: string | null): void {
  if (value === null) db().run('DELETE FROM settings WHERE key = ?', [key]);
  else db().run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}
