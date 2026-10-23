/**
 * Le Personnage de MyLife : un RPG de la vraie vie. Chaque app publie de petits compteurs par semaine
 * (`AppStats`, jamais de montant ni de détail), et le personnage en est entièrement recalculé :
 * niveaux, quêtes de la semaine, série. Fonctions pures : mêmes compteurs → même personnage, sur
 * tous les appareils, sans registre d'XP à synchroniser ni à tricher.
 */

export type StatsApp = 'perf' | 'finances' | 'raveloc';

/**
 * Compteurs d'une app, par semaine (clé : le lundi, `AAAA-MM-JJ`).
 * - perf : `sessions` (séances terminées), `records` (records battus) ; `goal` = objectif de séances par semaine.
 * - finances : `under` (jours sous le budget du jour), `tracked` (jours suivis), `saved` (cycles terminés cette semaine avec l'épargne prévue tenue).
 * - raveloc : `groups` (groupes actifs), `friends` (amis distincts dans ces groupes).
 */
export interface AppStats {
  v: 1;
  /** Date du calcul (ms) : la ligne la plus récente gagne. */
  at: number;
  weeks: Record<string, Record<string, number>>;
  goal?: number;
}

export type StatsByApp = Partial<Record<StatsApp, AppStats | null>>;

export type StatId = 'force' | 'discipline' | 'social' | 'constance' | 'culture';

export interface StatDef {
  id: StatId;
  name: string;
  /** D'où viennent les points (affiché sous la stat). */
  source: string;
  app: StatsApp | null;
  /** Pas encore branchée (« bientôt »). */
  locked?: boolean;
}

export const STATS: readonly StatDef[] = [
  { id: 'force', name: 'Force', source: 'Séances et records dans MyPerf', app: 'perf' },
  { id: 'discipline', name: 'Discipline', source: 'Jours sous ton budget et épargne tenue dans MyFinances', app: 'finances' },
  { id: 'social', name: 'Social', source: 'Groupes et amis retrouvés dans myRaveLoc', app: 'raveloc' },
  { id: 'constance', name: 'Constance', source: 'Semaines réussies d’affilée, toutes apps confondues', app: null },
  { id: 'culture', name: 'Culture', source: 'Bientôt : ta musique (MyMusique)', app: null, locked: true },
];

/** Barème : ce que rapporte chaque chose, plafonné par semaine (une semaine hors norme ne fait pas tout). */
export const XP = {
  session: 40,
  sessionCap: 7,
  record: 60,
  recordCap: 5,
  underDay: 15,
  savedCycle: 200,
  group: 50,
  groupCap: 3,
  friend: 10,
  friendCap: 10,
  quest: { force: 150, discipline: 150, social: 100 },
  goodWeek: 80,
  streakStep: 20,
  streakCap: 10,
  fullWeek: 100,
} as const;

/** Jours sous le budget demandés par la quête Discipline (et jours suivis nécessaires pour qu'elle existe). */
export const DISCIPLINE_TARGET = 5;
const DEFAULT_GOAL = 3;

export type QuestId = 'force' | 'discipline' | 'social' | 'full';

export interface Quest {
  id: QuestId;
  stat: StatId;
  title: string;
  progress: number;
  target: number;
  done: boolean;
  xp: number;
  /** Bonus : jamais exigée pour réussir la semaine. */
  bonus: boolean;
}

export interface StatState {
  id: StatId;
  name: string;
  source: string;
  locked: boolean;
  xp: number;
  level: number;
  /** Avancée vers le niveau suivant, de 0 à 1. */
  progress: number;
  /** Points gagnés cette semaine. */
  week: number;
}

export interface Character {
  level: number;
  title: string;
  xp: number;
  /** Points pour le niveau actuel et le suivant (total). */
  levelXp: number;
  nextXp: number;
  progress: number;
  stats: StatState[];
  /** Quêtes de la semaine en cours (absentes pour une app jamais utilisée). */
  quests: Quest[];
  /** Semaines réussies d'affilée (la semaine en cours compte dès qu'elle est réussie, et ne casse rien avant). */
  streak: number;
  weekXp: number;
  week: string;
  /** Points gagnés par semaine, les 12 dernières (la plus ancienne d'abord). */
  history: { week: string; xp: number; good: boolean; rest: boolean }[];
  /** Aucune app n'a encore publié de compteurs. */
  empty: boolean;
}

// ---------------------------------------------------------------- dates (AAAA-MM-JJ, sans fuseau)

const DAY = 86_400_000;
const toMs = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Le lundi de la semaine d'une date. */
export function weekStart(iso: string): string {
  const ms = toMs(iso);
  const dow = (new Date(ms).getUTCDay() + 6) % 7;
  return fromMs(ms - dow * DAY);
}

export const addWeeks = (week: string, n: number): string => fromMs(toMs(week) + n * 7 * DAY);

/** Date du jour en heure locale (AAAA-MM-JJ). */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- niveaux

/** Points totaux pour atteindre un niveau : `base × (niveau − 1)^1,5`. */
export const xpForLevel = (level: number, base = 100): number => Math.round(base * Math.pow(Math.max(0, level - 1), 1.5));

export function levelFor(xp: number, base = 100): { level: number; levelXp: number; nextXp: number; progress: number } {
  let level = 1;
  while (xpForLevel(level + 1, base) <= xp) level++;
  const levelXp = xpForLevel(level, base);
  const nextXp = xpForLevel(level + 1, base);
  return { level, levelXp, nextXp, progress: nextXp > levelXp ? (xp - levelXp) / (nextXp - levelXp) : 0 };
}

/** Le niveau global se calcule sur le total, avec un pas trois fois plus long. */
export const GLOBAL_BASE = 300;

const TITLES: readonly [number, string][] = [
  [60, 'Légende'],
  [45, 'Héros'],
  [30, 'Champion'],
  [20, 'Vétéran'],
  [10, 'Aventurier'],
  [5, 'Apprenti'],
  [1, 'Novice'],
];
export const titleFor = (level: number): string => TITLES.find(([min]) => level >= min)?.[1] ?? 'Novice';

// ---------------------------------------------------------------- calcul

const count = (s: AppStats | null | undefined, week: string, key: string) => s?.weeks[week]?.[key] ?? 0;

/** Première semaine où l'app a vraiment servi (avant, ses quêtes n'existaient pas). */
function firstWeek(s: AppStats | null | undefined, keys: readonly string[]): string | null {
  if (!s) return null;
  const used = Object.keys(s.weeks)
    .filter((w) => keys.some((k) => (s.weeks[w]?.[k] ?? 0) > 0))
    .sort();
  return used[0] ?? null;
}

interface WeekResult {
  xp: Record<StatId, number>;
  quests: Quest[];
  good: boolean;
}

function evaluateWeek(stats: StatsByApp, week: string, starts: Record<StatsApp, string | null>, isCurrent: boolean): WeekResult {
  const { perf, finances, raveloc } = stats;
  const xp: Record<StatId, number> = { force: 0, discipline: 0, social: 0, constance: 0, culture: 0 };
  const quests: Quest[] = [];
  const open = (app: StatsApp) => starts[app] !== null && week >= starts[app]!;

  // Force
  const sessions = count(perf, week, 'sessions');
  xp.force += XP.session * Math.min(sessions, XP.sessionCap) + XP.record * Math.min(count(perf, week, 'records'), XP.recordCap);
  if (open('perf')) {
    const goal = Math.max(1, Math.round(perf?.goal ?? DEFAULT_GOAL));
    const done = sessions >= goal;
    if (done) xp.force += XP.quest.force;
    quests.push({ id: 'force', stat: 'force', title: `Fais ${goal} séance${goal > 1 ? 's' : ''}`, progress: Math.min(sessions, goal), target: goal, done, xp: XP.quest.force, bonus: false });
  }

  // Discipline
  const under = count(finances, week, 'under');
  xp.discipline += XP.underDay * Math.min(under, 7) + XP.savedCycle * count(finances, week, 'saved');
  // Une semaine passée trop peu suivie (banque pas encore reliée, import en retard) n'a pas de quête : elle ne casse pas la série.
  if (open('finances') && (isCurrent || count(finances, week, 'tracked') >= DISCIPLINE_TARGET)) {
    const done = under >= DISCIPLINE_TARGET;
    if (done) xp.discipline += XP.quest.discipline;
    quests.push({ id: 'discipline', stat: 'discipline', title: `Reste sous ton budget du jour ${DISCIPLINE_TARGET} jours`, progress: Math.min(under, DISCIPLINE_TARGET), target: DISCIPLINE_TARGET, done, xp: XP.quest.discipline, bonus: false });
  }

  // Social (bonus : jamais exigée)
  const groups = count(raveloc, week, 'groups');
  xp.social += XP.group * Math.min(groups, XP.groupCap) + XP.friend * Math.min(count(raveloc, week, 'friends'), XP.friendCap);
  if (open('raveloc')) {
    const done = groups >= 1;
    if (done) xp.social += XP.quest.social;
    quests.push({ id: 'social', stat: 'social', title: 'Retrouve ta bande dans un groupe', progress: Math.min(groups, 1), target: 1, done, xp: XP.quest.social, bonus: true });
  }

  const required = quests.filter((q) => !q.bonus);
  const good = required.length > 0 && required.filter((q) => q.done).length >= Math.min(2, required.length);
  if (quests.length >= 2) {
    const all = quests.every((q) => q.done);
    if (all) xp.constance += XP.fullWeek;
    quests.push({ id: 'full', stat: 'constance', title: 'Semaine complète : toutes les quêtes', progress: quests.filter((q) => q.done).length, target: quests.length, done: all, xp: XP.fullWeek, bonus: true });
  }
  return { xp, quests, good };
}

/** Une semaine de l'histoire du personnage. */
export interface TimelineWeek {
  week: string;
  /** Points gagnés cette semaine, par stat. */
  xp: Record<StatId, number>;
  total: number;
  /** Points cumulés à la fin de la semaine. */
  cumulative: number;
  good: boolean;
  rest: boolean;
  quests: Quest[];
  /** Série à la fin de la semaine. */
  streak: number;
}

function appStarts(stats: StatsByApp): Record<StatsApp, string | null> {
  return {
    perf: firstWeek(stats.perf, ['sessions']),
    finances: firstWeek(stats.finances, ['tracked']),
    raveloc: firstWeek(stats.raveloc, ['groups']),
  };
}

/**
 * Toute l'histoire du personnage, semaine par semaine, de la première semaine où une app a servi jusqu'à la
 * semaine en cours. `rest` : semaines de repos déclarées (la série n'y casse pas, elles ne rapportent rien en Constance).
 */
export function timeline(stats: StatsByApp, today: string, rest: readonly string[] = []): TimelineWeek[] {
  const current = weekStart(today);
  const starts = appStarts(stats);
  const firsts = Object.values(starts).filter((w): w is string => w !== null).sort();
  if (!firsts.length) return [];
  const restSet = new Set(rest.map(weekStart));
  const out: TimelineWeek[] = [];
  let streak = 0;
  let cumulative = 0;
  for (let w = firsts[0]!; w <= current; w = addWeeks(w, 1)) {
    const isCurrent = w === current;
    const r = evaluateWeek(stats, w, starts, isCurrent);
    const isRest = restSet.has(w);
    if (r.good) {
      streak += 1;
      r.xp.constance += XP.goodWeek + XP.streakStep * Math.min(streak, XP.streakCap);
    } else if (!isRest && !isCurrent) {
      // Semaine manquée : la série repart de zéro. La semaine en cours ne casse rien tant qu'elle n'est pas finie.
      streak = 0;
    }
    const total = Object.values(r.xp).reduce((a, b) => a + b, 0);
    cumulative += total;
    out.push({ week: w, xp: r.xp, total, cumulative, good: r.good, rest: isRest, quests: r.quests, streak });
  }
  return out;
}

/** Le personnage à partir des compteurs de chaque app (voir `timeline`). */
export function computeCharacter(stats: StatsByApp, today: string, rest: readonly string[] = []): Character {
  const current = weekStart(today);
  const line = timeline(stats, today, rest);
  const totals: Record<StatId, number> = { force: 0, discipline: 0, social: 0, constance: 0, culture: 0 };
  for (const w of line) for (const id of Object.keys(totals) as StatId[]) totals[id] += w.xp[id];
  const now = line[line.length - 1]?.week === current ? line[line.length - 1]! : null;
  const weekly = now?.xp ?? { force: 0, discipline: 0, social: 0, constance: 0, culture: 0 };
  const xp = line[line.length - 1]?.cumulative ?? 0;
  const global = levelFor(xp, GLOBAL_BASE);
  return {
    level: global.level,
    title: titleFor(global.level),
    xp,
    levelXp: global.levelXp,
    nextXp: global.nextXp,
    progress: global.progress,
    stats: STATS.map((d) => {
      const l = levelFor(totals[d.id]);
      return { id: d.id, name: d.name, source: d.source, locked: !!d.locked, xp: totals[d.id], level: l.level, progress: l.progress, week: weekly[d.id] };
    }),
    quests: now?.quests ?? [],
    streak: line[line.length - 1]?.streak ?? 0,
    weekXp: now?.total ?? 0,
    week: current,
    history: line.slice(-12).map((w) => ({ week: w.week, xp: w.total, good: w.good, rest: w.rest })),
    empty: line.length === 0,
  };
}

// ---------------------------------------------------------------- bilans (semaine, mois, année)

/** Ce qui s'est passé sur une période (des semaines entières, désignées par leur lundi). Que des nombres. */
export interface Recap {
  from: string;
  to: string;
  /** Semaines de la période déjà commencées. */
  weeks: number;
  apps: Record<StatsApp, boolean>;
  sessions: number;
  records: number;
  /** Semaines où l'objectif de séances a été atteint. */
  goalWeeks: number;
  under: number;
  tracked: number;
  saved: number;
  /** Semaines avec au moins un groupe, et le plus d'amis retrouvés en une semaine. */
  socialWeeks: number;
  friends: number;
  questsDone: number;
  questsTotal: number;
  goodWeeks: number;
  /** Plus longue série atteinte pendant la période. */
  bestStreak: number;
  xp: number;
  xpByStat: Record<StatId, number>;
  levelStart: number;
  levelEnd: number;
  bestWeek: { week: string; xp: number } | null;
}

export function recap(stats: StatsByApp, today: string, from: string, to: string, rest: readonly string[] = []): Recap {
  const line = timeline(stats, today, rest);
  const inside = line.filter((w) => w.week >= from && w.week <= to);
  const before = line.filter((w) => w.week < from);
  const startXp = before[before.length - 1]?.cumulative ?? 0;
  const endXp = inside[inside.length - 1]?.cumulative ?? startXp;
  const sum = (s: AppStats | null | undefined, key: string) => inside.reduce((n, w) => n + count(s, w.week, key), 0);
  const xpByStat: Record<StatId, number> = { force: 0, discipline: 0, social: 0, constance: 0, culture: 0 };
  for (const w of inside) for (const id of Object.keys(xpByStat) as StatId[]) xpByStat[id] += w.xp[id];
  const main = inside.flatMap((w) => w.quests.filter((q) => q.id !== 'full'));
  const best = inside.reduce<TimelineWeek | null>((b, w) => (w.total > (b?.total ?? 0) ? w : b), null);
  const used = (s: AppStats | null | undefined, keys: readonly string[]) => inside.some((w) => keys.some((k) => count(s, w.week, k) > 0));
  return {
    from,
    to,
    weeks: inside.length,
    apps: { perf: used(stats.perf, ['sessions']), finances: used(stats.finances, ['tracked']), raveloc: used(stats.raveloc, ['groups']) },
    sessions: sum(stats.perf, 'sessions'),
    records: sum(stats.perf, 'records'),
    goalWeeks: inside.filter((w) => w.quests.some((q) => q.id === 'force' && q.done)).length,
    under: sum(stats.finances, 'under'),
    tracked: sum(stats.finances, 'tracked'),
    saved: sum(stats.finances, 'saved'),
    socialWeeks: inside.filter((w) => count(stats.raveloc, w.week, 'groups') > 0).length,
    friends: inside.reduce((m, w) => Math.max(m, count(stats.raveloc, w.week, 'friends')), 0),
    questsDone: main.filter((q) => q.done).length,
    questsTotal: main.length,
    goodWeeks: inside.filter((w) => w.good).length,
    bestStreak: inside.reduce((m, w) => Math.max(m, w.streak), 0),
    xp: endXp - startXp,
    xpByStat,
    levelStart: levelFor(startXp, GLOBAL_BASE).level,
    levelEnd: levelFor(endXp, GLOBAL_BASE).level,
    bestWeek: best && best.total > 0 ? { week: best.week, xp: best.total } : null,
  };
}

/** Les semaines d'un mois (`AAAA-MM`) : celles dont le lundi tombe dans le mois. */
export function monthWeeks(month: string): { from: string; to: string } {
  const first = `${month}-01`;
  let from = weekStart(first);
  if (from < first) from = addWeeks(from, 1);
  let to = from;
  while (addWeeks(to, 1).slice(0, 7) === month) to = addWeeks(to, 1);
  return { from, to };
}

/** Les semaines d'une année : celles dont le lundi tombe dans l'année. */
export function yearWeeks(year: string): { from: string; to: string } {
  const { from } = monthWeeks(`${year}-01`);
  const { to } = monthWeeks(`${year}-12`);
  return { from, to };
}

/**
 * La semaine que la carte « Ta semaine » de l'accueil raconte : dimanche, celle qui s'achève ; lundi, celle
 * qui vient de finir. Les autres jours : rien (le bilan reste ouvert dans sa page).
 */
export function recapWeekFor(today: string): string | null {
  const dow = (new Date(toMs(today)).getUTCDay() + 6) % 7;
  if (dow === 6) return weekStart(today);
  if (dow === 0) return addWeeks(weekStart(today), -1);
  return null;
}

/**
 * Le Wrapped mis en avant sur l'accueil : du 1er au 7 du mois, celui du mois qui vient de finir ; à partir
 * du 15 décembre, l'année en cours ; du 1er au 15 janvier, l'année qui vient de finir.
 */
export function wrappedFor(today: string): { kind: 'month' | 'year'; period: string } | null {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const d = Number(today.slice(8, 10));
  if (m === 1 && d <= 15) return { kind: 'year', period: String(y - 1) };
  if (m === 12 && d >= 15) return { kind: 'year', period: String(y) };
  if (d <= 7) {
    const pm = m === 1 ? 12 : m - 1;
    return { kind: 'month', period: `${m === 1 ? y - 1 : y}-${String(pm).padStart(2, '0')}` };
  }
  return null;
}

// ---------------------------------------------------------------- stockage (web : même adresse pour toutes les apps)

export const statsKey = (app: StatsApp) => `mylife:stats:${app}`;
export const STATS_APPS: readonly StatsApp[] = ['perf', 'finances', 'raveloc'];

export function parseStats(raw: unknown): AppStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<AppStats>;
  if (s.v !== 1 || typeof s.at !== 'number' || !s.weeks || typeof s.weeks !== 'object') return null;
  const weeks: AppStats['weeks'] = {};
  for (const [w, c] of Object.entries(s.weeks)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w) || !c || typeof c !== 'object') continue;
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(c)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) clean[k] = v;
    weeks[w] = clean;
  }
  return { v: 1, at: s.at, weeks, ...(typeof s.goal === 'number' ? { goal: s.goal } : {}) };
}

export function readStats(app: StatsApp): AppStats | null {
  try {
    return parseStats(JSON.parse(globalThis.localStorage?.getItem(statsKey(app)) ?? 'null'));
  } catch {
    return null;
  }
}

/** Mêmes compteurs (sans la date) : rien à réécrire ni à renvoyer. */
export function sameStats(a: AppStats | null, b: AppStats | null): boolean {
  if (!a || !b) return a === b;
  return a.goal === b.goal && JSON.stringify(sortWeeks(a.weeks)) === JSON.stringify(sortWeeks(b.weeks));
}

function sortWeeks(weeks: AppStats['weeks']): [string, [string, number][]][] {
  return Object.keys(weeks)
    .sort()
    .map((w) => [w, Object.entries(weeks[w]!).sort(([x], [y]) => (x < y ? -1 : 1))]);
}

/** Ne garde que les semaines récentes (deux ans) : la ligne reste petite. */
export function trimWeeks(weeks: AppStats['weeks'], today: string, keep = 104): AppStats['weeks'] {
  const from = addWeeks(weekStart(today), -(keep - 1));
  const out: AppStats['weeks'] = {};
  for (const [w, c] of Object.entries(weeks)) if (w >= from && Object.values(c).some((v) => v > 0)) out[w] = c;
  return out;
}

/**
 * Fusion de deux lignes qui accumulent leur historique (myRaveLoc : ses groupes expirent, la ligne est
 * leur seule trace) : par semaine et par compteur, le plus grand. Deux appareils ne s'effacent jamais.
 */
export function mergeStats(a: AppStats | null, b: AppStats | null): AppStats | null {
  if (!a || !b) return a ?? b;
  const weeks: AppStats['weeks'] = {};
  for (const src of [a.weeks, b.weeks]) {
    for (const [w, c] of Object.entries(src)) {
      const into = (weeks[w] ??= {});
      for (const [k, v] of Object.entries(c)) into[k] = Math.max(into[k] ?? 0, v);
    }
  }
  const goal = b.at >= a.at ? (b.goal ?? a.goal) : (a.goal ?? b.goal);
  return { v: 1, at: Math.max(a.at, b.at), weeks, ...(goal !== undefined ? { goal } : {}) };
}

/** Les apps dont la ligne s'accumule (fusionnée) plutôt que recalculée (la plus récente gagne). */
export const MERGED_STATS: readonly StatsApp[] = ['raveloc'];
