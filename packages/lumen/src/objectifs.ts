import { addWeeks, computeCharacter, weekStart, type AppStats, type StatsApp, type StatsByApp } from './character';
import type { MiniApp } from './miniapp';

/**
 * MyObjectifs (V4, 3.1) : tes objectifs, mesurés par les apps sans rien saisir. Un objectif suit une source qui existe
 * déjà (compteurs par semaine que chaque app publie, saisies de « Mes apps », niveau du Personnage), une cible et une
 * date limite. Moteur pur : il dit où tu en es, ce que le rythme attendait à cette date, et si tu es en avance ou en
 * retard. Jamais de montant : l'argent se compte en jours sous le budget et en cycles d'épargne tenus.
 */

export type ObjectiveSource =
  | { type: 'counter'; app: StatsApp; key: string }
  | { type: 'miniapp'; appId: string; agg: 'count' | 'sum'; field?: string }
  | { type: 'level' };

export interface Objective {
  v: 1;
  title: string;
  source: ObjectiveSource;
  target: number;
  /** AAAA-MM-JJ : ce qui compte commence ce jour-là (semaines entières : celle du jour de début). */
  start: string;
  deadline: string;
  /** Atteint (date, ms) : gardé même si la source baisse ensuite. */
  doneAt?: number;
}

/** Ce que MyObjectifs sait mesurer, avec ses mots. */
export interface CounterSource {
  app: StatsApp;
  key: string;
  label: string;
  /** Unité au pluriel (« séances ») et au singulier. */
  unit: [string, string];
  /** La valeur stockée → la valeur montrée (minutes → heures). */
  scale?: number;
  /** Une cible de départ raisonnable par mois. */
  perMonth: number;
}

export const COUNTER_SOURCES: readonly CounterSource[] = [
  { app: 'perf', key: 'sessions', label: 'Séances de sport (MyPerf)', unit: ['séances', 'séance'], perMonth: 12 },
  { app: 'perf', key: 'records', label: 'Records battus (MyPerf)', unit: ['records', 'record'], perMonth: 4 },
  { app: 'finances', key: 'under', label: 'Jours sous ton budget du jour (MyFinances)', unit: ['jours', 'jour'], perMonth: 20 },
  { app: 'finances', key: 'saved', label: 'Cycles avec l’épargne tenue (MyFinances)', unit: ['cycles', 'cycle'], perMonth: 1 },
  { app: 'raveloc', key: 'groups', label: 'Sorties avec ta bande (Sorties, MyRave)', unit: ['sorties', 'sortie'], perMonth: 2 },
  { app: 'music', key: 'minutes', label: 'Heures de musique (MyMusique)', unit: ['heures', 'heure'], scale: 60, perMonth: 40 },
  { app: 'music', key: 'discoveries', label: 'Artistes découverts (MyMusique)', unit: ['artistes', 'artiste'], perMonth: 10 },
];

export const counterSource = (app: StatsApp, key: string) => COUNTER_SOURCES.find((c) => c.app === app && c.key === key);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Lecture prudente d'un objectif synchronisé (ou proposé). */
export function parseObjective(raw: unknown): Objective | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const title = str(o.title, 80);
  const target = typeof o.target === 'number' && Number.isFinite(o.target) && o.target > 0 && o.target <= 1e7 ? o.target : null;
  if (o.v !== 1 || !title || target === null || typeof o.start !== 'string' || !DATE.test(o.start) || typeof o.deadline !== 'string' || !DATE.test(o.deadline) || o.deadline < o.start) return null;
  const s = (o.source ?? {}) as Record<string, unknown>;
  let source: ObjectiveSource | null = null;
  if (s.type === 'level') source = { type: 'level' };
  else if (s.type === 'counter' && typeof s.app === 'string' && typeof s.key === 'string' && counterSource(s.app as StatsApp, s.key)) source = { type: 'counter', app: s.app as StatsApp, key: s.key };
  else if (s.type === 'miniapp' && typeof s.appId === 'string' && /^[a-z0-9]{6,32}$/.test(s.appId) && (s.agg === 'count' || s.agg === 'sum')) {
    const field = s.agg === 'sum' && typeof s.field === 'string' && /^[a-z][a-z0-9_]{0,23}$/.test(s.field) ? s.field : undefined;
    if (s.agg === 'count' || field) source = { type: 'miniapp', appId: s.appId, agg: s.agg, ...(field ? { field } : {}) };
  }
  if (!source) return null;
  return { v: 1, title, source, target, start: o.start, deadline: o.deadline, ...(typeof o.doneAt === 'number' ? { doneAt: o.doneAt } : {}) };
}

export interface ObjectiveContext {
  stats: StatsByApp;
  miniApps: readonly MiniApp[];
  today: string;
  rest?: readonly string[];
}

export type ObjectiveStatus = 'done' | 'ahead' | 'onTrack' | 'behind' | 'missed' | 'unavailable';

export interface ObjectiveProgress {
  value: number;
  target: number;
  /** 0 à 1. */
  ratio: number;
  /** Ce que le rythme régulier attendait aujourd'hui (même unité que `value`). */
  expected: number;
  status: ObjectiveStatus;
  /** Unité (pluriel, singulier). */
  unit: [string, string];
  /** Jalons franchis (25, 50, 75, 100 %). */
  milestones: number[];
  /** Jours restants (0 le dernier jour, négatif après). */
  daysLeft: number;
  /** Pourquoi on ne peut pas mesurer (app jamais ouverte, app de « Mes apps » supprimée). */
  why?: string;
}

const DAY = 86_400_000;
const ms = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const days = (from: string, to: string) => Math.round((ms(to) - ms(from)) / DAY);

/** Somme d'un compteur sur les semaines dont le lundi tombe entre le début (sa semaine) et la date limite. */
function sumCounter(s: AppStats | null | undefined, key: string, start: string, end: string): number {
  if (!s) return 0;
  const from = weekStart(start);
  let total = 0;
  for (let w = from; w <= end; w = addWeeks(w, 1)) total += s.weeks[w]?.[key] ?? 0;
  return total;
}

function measure(o: Objective, ctx: ObjectiveContext): { value: number; unit: [string, string]; why?: string } {
  const end = ctx.today < o.deadline ? ctx.today : o.deadline;
  const src = o.source;
  if (src.type === 'level') {
    const c = computeCharacter(ctx.stats, ctx.today, ctx.rest);
    return c.empty ? { value: 0, unit: ['niveaux', 'niveau'], why: 'Le Personnage n’a encore rien compté.' } : { value: c.level, unit: ['niveau', 'niveau'] };
  }
  if (src.type === 'counter') {
    const def = counterSource(src.app, src.key)!;
    const s = ctx.stats[src.app];
    const value = sumCounter(s, src.key, o.start, end) / (def.scale ?? 1);
    return { value: Math.round(value * 10) / 10, unit: def.unit, ...(s ? {} : { why: `Ouvre ${def.label.match(/\(([^)]+)\)/)?.[1] ?? 'l’app'} pour qu’il compte.` }) };
  }
  const app = ctx.miniApps.find((a) => a.id === src.appId && a.spec);
  if (!app) return { value: 0, unit: ['saisies', 'saisie'], why: 'Cette app de « Mes apps » n’existe plus.' };
  const entries = app.entries.filter((e) => e.day >= o.start && e.day <= end);
  if (src.agg === 'count') return { value: entries.length, unit: ['saisies', 'saisie'] };
  const field = app.spec!.fields.find((f) => f.id === src.field);
  const unit = field?.unit ?? field?.label.toLowerCase() ?? '';
  const total = entries.reduce((n, e) => n + (typeof e.values[src.field!] === 'number' ? (e.values[src.field!] as number) : 0), 0);
  return { value: Math.round(total * 10) / 10, unit: [unit, unit] };
}

/** Où en est un objectif aujourd'hui. */
export function objectiveProgress(o: Objective, ctx: ObjectiveContext): ObjectiveProgress {
  const m = measure(o, ctx);
  const ratio = Math.max(0, Math.min(1, m.value / o.target));
  const span = Math.max(1, days(o.start, o.deadline) + 1);
  const elapsed = Math.max(0, Math.min(span, days(o.start, ctx.today) + 1));
  // Le niveau ne part pas de zéro : le rythme attendu n'a pas de sens, on compare seulement à la cible.
  const expected = o.source.type === 'level' ? o.target : Math.round(((o.target * elapsed) / span) * 10) / 10;
  const daysLeft = days(ctx.today, o.deadline);
  const done = o.doneAt !== undefined || m.value >= o.target;
  // Un écart réel (au moins 1, ou 5 % de la cible) : au premier jour, une saisie n'est pas « de l'avance ».
  const gap = Math.max(1, o.target * 0.05);
  const status: ObjectiveStatus = done
    ? 'done'
    : m.why && m.value === 0
      ? 'unavailable'
      : daysLeft < 0
        ? 'missed'
        : o.source.type === 'level'
          ? 'onTrack'
          : m.value - expected >= gap
            ? 'ahead'
            : expected - m.value >= gap
              ? 'behind'
              : 'onTrack';
  return { value: m.value, target: o.target, ratio: done ? 1 : ratio, expected, status, unit: m.unit, milestones: [25, 50, 75, 100].filter((p) => (done ? 1 : ratio) * 100 >= p), daysLeft, ...(m.why ? { why: m.why } : {}) };
}

/** Un objectif tout juste atteint garde sa date (le succès reste, même si la source baisse ensuite). */
export const markDone = (o: Objective, p: ObjectiveProgress, now = Date.now()): Objective | null => (o.doneAt === undefined && p.value >= o.target ? { ...o, doneAt: now } : null);

/** La phrase qui dit où on en est, au tutoiement. */
export function objectiveLine(p: ObjectiveProgress): string {
  const n = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
  const u = (v: number) => (Math.abs(v) >= 2 ? p.unit[0] : p.unit[1]);
  switch (p.status) {
    case 'done':
      return 'Objectif atteint !';
    case 'unavailable':
      return p.why ?? 'Rien à mesurer pour l’instant.';
    case 'missed':
      return `Date passée : ${n(p.value)} sur ${n(p.target)} ${u(p.target)}.`;
    case 'ahead':
      return `En avance : ${n(p.value - p.expected)} ${u(p.value - p.expected)} de plus que le rythme.`;
    case 'behind':
      return `En retard : il en faudrait ${n(p.expected)} aujourd’hui, tu en es à ${n(p.value)}.`;
    default:
      return p.daysLeft >= 0 ? `Dans le rythme. Encore ${n(Math.max(0, p.target - p.value))} ${u(p.target - p.value)}, ${p.daysLeft} jour${p.daysLeft > 1 ? 's' : ''} restant${p.daysLeft > 1 ? 's' : ''}.` : 'Dans le rythme.';
  }
}
