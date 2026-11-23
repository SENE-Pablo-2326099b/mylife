import { formatPercent } from './math';
import type { SetGroup, SetType, StrengthWeek } from './types';

/**
 * Les groupes de séries libres d'une semaine (cycles importés, 23/11) : lecture d'une ligne lisible ou d'un objet,
 * écriture dans la même forme (réimport à l'identique), résumé, et la forme top set + backoffs qu'on en déduit pour
 * les écrans qui n'affichent qu'elle (et pour l'app d'avant).
 */
export const GROUP_LIMITS = { groups: 12, sets: 20, reps: 50, seconds: 3600, rest: 900 } as const;

const TYPES: [RegExp, SetType][] = [
  [/^top(\s?sets?)?$/, 'top_set'],
  [/^back\s?-?\s?offs?$/, 'backoff'],
  [/^(echauffements?|warm\s?-?\s?ups?)$/, 'warmup'],
  [/^(drops?(\s?sets?)?|degressives?)$/, 'drop'],
  [/^(series?(\s?droites?)?|droites?|working|straight)$/, 'working'],
];
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const typeOf = (word: string): SetType | null => TYPES.find(([re]) => re.test(plain(word).replace(/_/g, ' ')))?.[1] ?? null;
const between = (v: number, min: number, max: number) => Number.isFinite(v) && v >= min && v <= max;

/** Un % écrit 80, « 80 % », 0.8 ou « 92,5 » → fraction ; null si absent ou hors de 20 à 120 %. */
function percentOf(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace('%', '').replace(',', '.').trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const pct = n <= 1.2 ? n * 100 : n;
  return between(pct, 20, 120) ? Math.round(pct * 10) / 1000 : null;
}

/** « 90 », « 90s », « 2 min », « 1:30 » → secondes. */
function secondsOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  if (typeof v !== 'string') return null;
  const s = plain(v);
  const mmss = /^(\d+):(\d{2})$/.exec(s);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const m = /^(\d+(?:[.,]\d+)?)\s*(s|sec|secondes?|"|min|mn|minutes?|')?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  return Math.round(/^(min|mn|minutes?|')$/.test(m[2] ?? '') ? n * 60 : n);
}

function finish(g: SetGroup): { group: SetGroup } | { error: string } {
  if (!between(g.sets, 1, GROUP_LIMITS.sets)) return { error: `${g.sets} séries : de 1 à ${GROUP_LIMITS.sets}.` };
  if (!g.seconds && !between(g.reps, 1, GROUP_LIMITS.reps)) return { error: `${g.reps} reps : de 1 à ${GROUP_LIMITS.reps}.` };
  if (g.seconds && !between(g.seconds, 1, GROUP_LIMITS.seconds)) return { error: 'Durée de série invalide.' };
  if (g.restSec != null && !between(g.restSec, 0, GROUP_LIMITS.rest)) return { error: 'Repos de 0 à 15 min.' };
  if (g.everySec != null && !between(g.everySec, 10, 600)) return { error: 'Intervalle d’EMOM de 10 s à 10 min.' };
  const out: SetGroup = { type: g.type, sets: g.sets, reps: g.seconds ? 1 : g.reps };
  if (g.repsMax && g.repsMax > out.reps && !g.seconds) out.repsMax = Math.min(GROUP_LIMITS.reps, g.repsMax);
  if (g.percent != null) out.percent = g.percent;
  if (g.seconds) out.seconds = g.seconds;
  if (g.restSec != null) out.restSec = g.restSec;
  if (g.everySec != null) out.everySec = g.everySec;
  const note = (g.note ?? '').replace(/^[\s,;:·-]+|[\s,;:·-]+$/g, '').slice(0, 80);
  if (note) out.note = note;
  return { group: out };
}

const LINE = /^(\d+)\s*[x×*]\s*(\d+)(?:\s*(?:-|–|à|a)\s*(\d+))?\s*(s|sec|secondes?|")?(?=\s|@|$)/i;

/**
 * Un groupe à partir d'une ligne (« top 1x4 @80% », « backoff 4x6 @70% », « 2x3 @75% pause 2 s »,
 * « EMOM 6x2 @70% », « 3x45s », « 1x3-5 @85% repos 3 min ») ou d'un objet ({ type, sets, reps, percent… }).
 * `fallback` : le type quand la ligne n'en dit rien.
 */
export function parseGroup(spec: unknown, fallback: SetType = 'working'): { group: SetGroup } | { error: string } {
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) return parseGroupObject(spec as Record<string, unknown>, fallback);
  if (typeof spec !== 'string' || !spec.trim()) return { error: 'Groupe de séries vide.' };
  let rest = spec.trim();
  let type: SetType | null = null;
  let everySec: number | null = null;
  // Le type, puis l'EMOM, en tête (« top : », « backoffs », « EMOM », « E2MOM »).
  for (let guard = 0; guard < 3; guard++) {
    const head = /^([A-Za-zÀ-ÿ\s-]+?)\s*:?\s*(?=\d|emom|e\d+mom)/i.exec(rest);
    const em = /^e(\d*)mom\b\s*:?\s*/i.exec(rest);
    if (em) {
      everySec = (Number(em[1]) || 1) * 60;
      rest = rest.slice(em[0].length);
      continue;
    }
    if (head && typeOf(head[1]!)) {
      type = typeOf(head[1]!);
      rest = rest.slice(head[0].length);
      continue;
    }
    break;
  }
  const m = LINE.exec(rest);
  if (!m) return { error: `« ${spec.trim()} » : écris-le comme « 4x6 @70% ».` };
  rest = rest.slice(m[0].length);
  const timed = !!m[4];
  let percent: number | null = null;
  const pm = /^\s*@\s*(\d+(?:[.,]\d+)?)\s*%?/.exec(rest);
  if (pm) {
    percent = percentOf(pm[1]);
    if (percent === null) return { error: `« ${spec.trim()} » : % de 20 à 120.` };
    rest = rest.slice(pm[0].length);
  }
  let restSec: number | null = null;
  const rm = /(?:^|[\s,;·])(?:repos|rest|recup|récup)\s*:?\s*(\d+(?::\d{2})?\s*(?:s|sec|secondes?|min|mn|minutes?|'|")?)/i.exec(rest);
  if (rm) {
    restSec = secondsOf(rm[1]!.trim());
    rest = rest.replace(rm[0], ' ');
  }
  return finish({
    type: type ?? fallback,
    sets: Number(m[1]),
    reps: timed ? 1 : Number(m[2]),
    repsMax: m[3] && !timed ? Number(m[3]) : null,
    percent,
    seconds: timed ? Number(m[2]) : null,
    restSec,
    everySec,
    note: rest,
  });
}

function parseGroupObject(o: Record<string, unknown>, fallback: SetType): { group: SetGroup } | { error: string } {
  const get = (...keys: string[]) => {
    for (const k of Object.keys(o)) if (keys.includes(plain(k).replace(/[\s_-]/g, ''))) return o[k];
    return undefined;
  };
  const typeRaw = get('type', 'kind', 'role');
  const type = (typeof typeRaw === 'string' ? typeOf(typeRaw) : null) ?? fallback;
  const sets = Number(get('sets', 'series', 'set'));
  const repsRaw = get('reps', 'repetitions', 'rep');
  const repsText = typeof repsRaw === 'number' ? String(repsRaw) : typeof repsRaw === 'string' ? repsRaw.trim() : '';
  const timed = /^\d+\s*(s|sec|secondes?|")$/i.exec(repsText);
  const range = /^(\d+)(?:\s*(?:-|–|à|a)\s*(\d+))?$/.exec(repsText);
  const seconds = timed ? Number(/\d+/.exec(repsText)![0]) : secondsOf(get('seconds', 'secondes', 'duration', 'duree', 'time'));
  const percentRaw = get('percent', 'percent1rm', 'pourcentage', 'pct', 'intensity', 'intensite');
  const percent = percentRaw === undefined || percentRaw === null ? null : percentOf(percentRaw);
  if (percentRaw !== undefined && percentRaw !== null && percent === null) return { error: '% de 20 à 120.' };
  const every = get('every', 'everyseconds', 'everysec', 'interval', 'emom');
  return finish({
    type,
    sets: Number.isFinite(sets) ? Math.round(sets) : 0,
    reps: range ? Number(range[1]) : seconds ? 1 : 0,
    repsMax: range?.[2] ? Number(range[2]) : null,
    percent,
    seconds: seconds || null,
    restSec: secondsOf(get('rest', 'restseconds', 'restsec', 'repos')),
    everySec: every === true ? 60 : secondsOf(every),
    note: typeof get('note', 'notes', 'consigne', 'comment') === 'string' ? String(get('note', 'notes', 'consigne', 'comment')) : '',
  });
}

/** Une liste de groupes (tableau de lignes ou d'objets, ou { sets: [...] }, ou { top, backoff }) ; les erreurs à part. */
export function parseGroups(spec: unknown): { groups: SetGroup[]; issues: string[] } {
  const issues: string[] = [];
  let list: unknown[] = [];
  if (Array.isArray(spec)) list = spec;
  else if (spec && typeof spec === 'object') {
    const o = spec as Record<string, unknown>;
    const inner = o.sets ?? o.series ?? o.groups ?? o.groupes;
    if (Array.isArray(inner)) list = inner;
    else {
      // Raccourci { top, backoff } (ou backoffs).
      const top = o.top ?? o.topSet ?? o.top_set;
      const backoff = o.backoff ?? o.backoffs ?? o['back-off'];
      const groups: SetGroup[] = [];
      for (const [v, t] of [[top, 'top_set'], [backoff, 'backoff']] as const) {
        if (v === undefined) continue;
        const r = parseGroup(v, t);
        if ('error' in r) issues.push(r.error);
        else groups.push({ ...r.group, type: typeof v === 'string' && typeOf(v.split(/\s/)[0] ?? '') ? r.group.type : t });
      }
      return { groups, issues };
    }
  } else if (typeof spec === 'string') list = spec.split(/\s*[+;\n]\s*/);
  const groups: SetGroup[] = [];
  for (const item of list.slice(0, GROUP_LIMITS.groups)) {
    const r = parseGroup(item);
    if ('error' in r) issues.push(r.error);
    else groups.push(r.group);
  }
  if (list.length > GROUP_LIMITS.groups) issues.push(`Plus de ${GROUP_LIMITS.groups} groupes dans une semaine : les suivants sont ignorés.`);
  return { groups, issues };
}

const TYPE_SPEC: Record<SetType, string> = { top_set: 'top', backoff: 'backoff', warmup: 'échauffement', drop: 'drop', working: '' };
const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

/** La ligne qui relit ce groupe à l'identique (export, partage) : « backoff 4x6 @70% repos 3 min ». */
export function groupToSpec(g: SetGroup): string {
  const reps = g.seconds ? `${g.seconds}s` : `${g.reps}${g.repsMax ? `-${g.repsMax}` : ''}`;
  return [
    TYPE_SPEC[g.type],
    g.everySec ? (g.everySec === 60 ? 'EMOM' : `E${Math.round(g.everySec / 60)}MOM`) : '',
    `${g.sets}x${reps}`,
    g.percent != null ? `@${num(g.percent * 100)}%` : '',
    g.note ?? '',
    g.restSec != null ? `repos ${g.restSec % 60 === 0 && g.restSec > 0 ? `${g.restSec / 60} min` : `${g.restSec}s`}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

const TYPE_LABEL: Record<SetType, string> = { top_set: 'Top', backoff: 'Backoffs', warmup: 'Échauffement', drop: 'Dégressives', working: '' };

/** Le groupe à l'écran : « Backoffs 4×6 @ 70 % · pause 2 s ». */
export function describeGroup(g: SetGroup): string {
  const reps = g.seconds ? `${g.seconds} s` : `${g.reps}${g.repsMax ? `-${g.repsMax}` : ''}`;
  const head = [TYPE_LABEL[g.type], g.everySec ? (g.everySec === 60 ? 'EMOM' : `toutes les ${g.everySec} s`) : '', `${g.sets}×${reps}`].filter(Boolean).join(' ');
  return [`${head}${g.percent != null ? ` @ ${formatPercent(g.percent)}` : ''}`, g.note ?? ''].filter(Boolean).join(' · ');
}

export const describeGroups = (groups: readonly SetGroup[]): string => groups.map(describeGroup).join(' + ');

/**
 * La forme top set + backoffs qu'on déduit des groupes (premier top set, premier backoff ; à défaut, les deux premiers
 * groupes), pour les écrans qui n'affichent qu'elle et pour l'app d'avant ; les groupes restent la vérité.
 */
export function weekFromGroups(groups: readonly SetGroup[], base: StrengthWeek): StrengthWeek {
  const top = groups.find((g) => g.type === 'top_set') ?? groups.find((g) => g.type !== 'warmup') ?? null;
  const backoff = groups.find((g) => g.type === 'backoff') ?? groups.find((g) => g !== top && g.type !== 'warmup') ?? null;
  return {
    groups: groups.map((g) => ({ ...g })),
    topSets: top?.sets ?? 0,
    topRepsMin: top?.reps ?? base.topRepsMin,
    topRepsMax: top?.repsMax ?? top?.reps ?? base.topRepsMax,
    topPercent: top?.percent ?? base.topPercent,
    backoffSets: backoff?.sets ?? 0,
    backoffReps: backoff?.reps ?? base.backoffReps,
    backoffPercent: backoff?.percent ?? base.backoffPercent,
  };
}

/** Les groupes d'une semaine : les siens, ou ceux qu'on lit dans sa forme top set + backoffs. */
export function groupsOfWeek(w: StrengthWeek): SetGroup[] {
  if (w.groups?.length) return w.groups;
  const out: SetGroup[] = [];
  if (w.topSets > 0) out.push({ type: 'top_set', sets: w.topSets, reps: w.topRepsMin, ...(w.topRepsMax > w.topRepsMin ? { repsMax: w.topRepsMax } : {}), percent: w.topPercent });
  if (w.backoffSets > 0) out.push({ type: 'backoff', sets: w.backoffSets, reps: w.backoffReps, percent: w.backoffPercent });
  return out;
}
