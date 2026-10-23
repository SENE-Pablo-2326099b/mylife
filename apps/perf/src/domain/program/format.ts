import { EQUIPMENTS, MUSCLES, type Equipment, type Muscle } from '../types';

/**
 * Format d'échange d'un programme MyPerf (import, export, programmes prêts). Pensé pour être produit par
 * n'importe quel LLM gratuit à partir d'un texte, d'un PDF ou d'une photo : clés simples, valeurs plates.
 * La lecture est tolérante (JSON entouré de texte, virgules en trop, clés en français, unités dans les
 * chaînes) ; ce qui n'est pas compris est signalé, jamais inventé.
 */

export const PROGRAM_FORMAT = 'myperf-program';
export const PROGRAM_VERSION = 1;

/** Le fichier tel qu'on l'échange. */
export interface ProgramFile {
  format: typeof PROGRAM_FORMAT;
  version: 1;
  name: string;
  notes?: string;
  sessions: {
    name: string;
    /** Jours de la semaine (« lundi »…). */
    days?: string[];
    notes?: string;
    exercises: {
      name: string;
      sets: number;
      /** « 8 », « 6-8 », « max », « 30s ». */
      reps?: string;
      kg?: number;
      percent1RM?: number;
      rpe?: number;
      restSeconds?: number;
      notes?: string;
      equipment?: Equipment;
      muscles?: Muscle[];
      /** Exercice au poids du corps qu'on peut lester (tractions, dips) : la charge notée est le lest. */
      bodyweight?: boolean;
    }[];
  }[];
  oneRepMaxes?: { exercise: string; kg: number }[];
}

/** Un exercice lu, prêt à être rapproché de la bibliothèque. */
export interface ParsedExercise {
  name: string;
  sets: number;
  repMin: number | null;
  repMax: number | null;
  /** Jusqu'à l'échec (« max », « AMRAP »). */
  amrap: boolean;
  /** Exercice en durée (gainage : « 30s »). */
  seconds: number | null;
  kg: number | null;
  percent: number | null;
  rpe: number | null;
  restSeconds: number | null;
  notes: string;
  equipment: Equipment | null;
  muscles: Muscle[];
  bodyweight: boolean | null;
}

export interface ParsedSession {
  name: string;
  /** 0 = lundi … 6 = dimanche. */
  weekdays: number[];
  notes: string;
  exercises: ParsedExercise[];
}

export interface ParsedProgram {
  name: string;
  notes: string;
  sessions: ParsedSession[];
  oneRms: { name: string; kg: number }[];
}

export interface ParseResult {
  program: ParsedProgram | null;
  /** Ce qui a été ignoré ou corrigé, en clair. */
  issues: string[];
  source: 'json' | 'text' | null;
}

// ---------------------------------------------------------------- outils

export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9%.,\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const WEEKDAYS: Record<string, number> = {
  lundi: 0, lun: 0, monday: 0, mon: 0,
  mardi: 1, mar: 1, tuesday: 1, tue: 1,
  mercredi: 2, mer: 2, wednesday: 2, wed: 2,
  jeudi: 3, jeu: 3, thursday: 3, thu: 3,
  vendredi: 4, ven: 4, friday: 4, fri: 4,
  samedi: 5, sam: 5, saturday: 5, sat: 5,
  dimanche: 6, dim: 6, sunday: 6, sun: 6,
};
export const WEEKDAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

export function weekdayOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v >= 1 && v <= 7 ? v - 1 : null;
  if (typeof v !== 'string') return null;
  const w = normalizeText(v).replace(/\.$/, '');
  return WEEKDAYS[w] ?? null;
}

/** Les jours cités dans un texte libre (« Lundi – Push », « mardi et jeudi »). */
export function weekdaysIn(text: string): number[] {
  const out = new Set<number>();
  for (const word of normalizeText(text).split(/[\s,/-]+/)) {
    const d = WEEKDAYS[word];
    if (d !== undefined && word.length > 3) out.add(d);
  }
  return [...out].sort((a, b) => a - b);
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const m = v.replace(',', '.').match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  return null;
};

/** « 90 », « 90s », « 2 min », « 2'30 », « 1:30 » → secondes. */
export function secondsOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 0 ? Math.round(v) : null;
  if (typeof v !== 'string') return null;
  const s = v.toLowerCase().replace(/[’']/g, ':').replace(/\s+/g, ' ');
  // « 2:30 », « 2'30 », « 1 min 30 »
  let m = s.match(/(\d+)\s*(?::|min|mn)\s*(\d{1,2})\b/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:min|mn|m\b)/);
  if (m) return Math.round(Number(m[1]!.replace(',', '.')) * 60);
  m = s.match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** « 8 », « 6-8 », « 6 à 8 », « max », « AMRAP », « 30s » → répétitions (ou durée). */
export function repsOf(v: unknown): Pick<ParsedExercise, 'repMin' | 'repMax' | 'amrap' | 'seconds'> {
  const none = { repMin: null, repMax: null, amrap: false, seconds: null };
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return { ...none, repMin: Math.round(v), repMax: Math.round(v) };
  if (typeof v !== 'string') return none;
  const s = normalizeText(v);
  if (/max|amrap|echec|failure/.test(s)) return { ...none, amrap: true };
  if (/\d\s*(s|sec|secondes?|min)\b/.test(s)) return { ...none, seconds: secondsOf(s) };
  const range = s.match(/(\d+)\s*(?:-|a|to|–)\s*(\d+)/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    return { ...none, repMin: Math.min(a, b), repMax: Math.max(a, b) };
  }
  const one = s.match(/\d+/);
  return one ? { ...none, repMin: Number(one[0]), repMax: Number(one[0]) } : none;
}

// ---------------------------------------------------------------- extraction du JSON

/** Le JSON d'une réponse de LLM : bloc ```json, ou du premier « { » au dernier « } ». */
export function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : null;
}

/** Corrections courantes d'un JSON écrit à la main ou par un LLM. */
function repairJson(s: string): string {
  return s
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\/\/[^\n"]*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1');
}

export function parseJsonLoose(text: string): unknown {
  const raw = extractJson(text);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(repairJson(raw));
    } catch {
      return undefined;
    }
  }
}

// ---------------------------------------------------------------- lecture tolérante

const pick = (o: Record<string, unknown>, keys: readonly string[]): unknown => {
  for (const k of Object.keys(o)) if (keys.includes(normalizeText(k).replace(/[\s_-]/g, ''))) return o[k];
  return undefined;
};

const K = {
  name: ['name', 'nom', 'title', 'titre', 'exercise', 'exercice'],
  notes: ['notes', 'note', 'comment', 'commentaire', 'description', 'remarques'],
  sessions: ['sessions', 'seances', 'days', 'jours', 'workouts', 'entrainements', 'program', 'programme', 'templates'],
  days: ['days', 'jours', 'weekdays', 'day', 'jour', 'schedule'],
  exercises: ['exercises', 'exercices', 'movements', 'mouvements', 'exos'],
  sets: ['sets', 'series', 'nbsets', 'set'],
  reps: ['reps', 'repetitions', 'rep', 'repetition', 'repsrange'],
  kg: ['kg', 'weight', 'poids', 'charge', 'load', 'weightkg'],
  percent: ['percent1rm', 'percent', 'pourcentage', 'intensity', 'intensite', 'pct', '%1rm', 'percentage'],
  rpe: ['rpe'],
  rest: ['restseconds', 'rest', 'repos', 'recup', 'recuperation', 'restsec'],
  equipment: ['equipment', 'equipement', 'materiel'],
  muscles: ['muscles', 'muscle', 'targetmuscles'],
  bodyweight: ['bodyweight', 'poidsducorps', 'lest', 'weighted'],
  oneRms: ['onerepmaxes', '1rm', 'onerm', 'maxes', 'records', 'rm'],
  exerciseRef: ['exercise', 'exercice', 'name', 'nom'],
} as const;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

function readExercise(raw: unknown, where: string, issues: string[]): ParsedExercise | null {
  if (typeof raw === 'string') return parseExerciseLine(raw);
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = str(pick(o, K.name));
  if (!name) {
    issues.push(`${where} : un exercice sans nom a été ignoré.`);
    return null;
  }
  const setsRaw = pick(o, K.sets);
  let sets = Math.round(num(setsRaw) ?? 0);
  const repsRaw = pick(o, K.reps);
  // « 4x8 » rangé dans `sets` ou dans `reps`.
  const combo = [setsRaw, repsRaw].map(str).map((s) => s.match(/^(\d+)\s*[x×*]\s*(.+)$/i)).find(Boolean);
  const reps = repsOf(combo ? combo[2] : repsRaw);
  if (combo) sets = Number(combo[1]);
  if (sets <= 0) {
    issues.push(`${where} · ${name} : nombre de séries absent, 3 par défaut.`);
    sets = 3;
  }
  if (sets > 12) {
    issues.push(`${where} · ${name} : ${sets} séries, ramené à 12.`);
    sets = 12;
  }
  let percent = num(pick(o, K.percent));
  if (percent !== null && percent > 0 && percent <= 1.2) percent = Math.round(percent * 1000) / 10;
  const equipment = str(pick(o, K.equipment)).toLowerCase();
  const muscles = pick(o, K.muscles);
  const bw = pick(o, K.bodyweight);
  return {
    name,
    sets,
    ...reps,
    kg: num(pick(o, K.kg)),
    percent: percent !== null && percent > 0 && percent <= 120 ? percent : null,
    rpe: ((r) => (r !== null && r >= 1 && r <= 10 ? r : null))(num(pick(o, K.rpe))),
    restSeconds: secondsOf(pick(o, K.rest)),
    notes: str(pick(o, K.notes)),
    equipment: (EQUIPMENTS as readonly string[]).includes(equipment) ? (equipment as Equipment) : null,
    muscles: (Array.isArray(muscles) ? muscles : typeof muscles === 'string' ? muscles.split(/[,;]/) : [])
      .map((m) => normalizeText(String(m)).replace(/\s/g, '_'))
      .filter((m): m is Muscle => (MUSCLES as readonly string[]).includes(m)),
    bodyweight: typeof bw === 'boolean' ? bw : null,
  };
}

function readSession(raw: unknown, index: number, issues: string[]): ParsedSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = str(pick(o, K.name)) || `Séance ${String.fromCharCode(65 + (index % 26))}`;
  const daysRaw = pick(o, K.days);
  const days = (Array.isArray(daysRaw) ? daysRaw : typeof daysRaw === 'string' ? daysRaw.split(/[,;/]| et | and /) : daysRaw === undefined ? [] : [daysRaw]).map(weekdayOf).filter((d): d is number => d !== null);
  const list = pick(o, K.exercises);
  const exercises = (Array.isArray(list) ? list : []).map((e) => readExercise(e, name, issues)).filter((e): e is ParsedExercise => e !== null);
  if (!exercises.length) {
    issues.push(`« ${name} » : aucun exercice reconnu, séance ignorée.`);
    return null;
  }
  return { name, weekdays: [...new Set([...days, ...weekdaysIn(name)])].sort((a, b) => a - b), notes: str(pick(o, K.notes)), exercises };
}

/** Un programme à partir d'un objet JSON déjà lu (clés tolérées en français, versions inconnues refusées). */
export function readProgram(raw: unknown): ParseResult {
  const issues: string[] = [];
  let root = raw;
  // Un tableau de séances seul, ou un programme rangé sous une clé.
  if (Array.isArray(root)) root = { sessions: root };
  if (!root || typeof root !== 'object') return { program: null, issues: ['Ce n’est pas un programme.'], source: 'json' };
  const o = root as Record<string, unknown>;
  const version = pick(o, ['version']);
  if (typeof version === 'number' && version > PROGRAM_VERSION) return { program: null, issues: ['Programme créé par une version plus récente de MyPerf.'], source: 'json' };
  const list = pick(o, K.sessions);
  const sessions = (Array.isArray(list) ? list : []).map((s, i) => readSession(s, i, issues)).filter((s): s is ParsedSession => s !== null);
  const oneRmsRaw = pick(o, K.oneRms);
  const oneRms = (Array.isArray(oneRmsRaw) ? oneRmsRaw : [])
    .map((r) => {
      if (!r || typeof r !== 'object') return null;
      const name = str(pick(r as Record<string, unknown>, K.exerciseRef));
      const kg = num(pick(r as Record<string, unknown>, ['kg', 'value', 'valeur', 'weight', 'poids', '1rm']));
      return name && kg !== null && kg > 0 ? { name, kg } : null;
    })
    .filter((r): r is { name: string; kg: number } => r !== null);
  if (!sessions.length) return { program: null, issues: issues.length ? issues : ['Aucune séance trouvée.'], source: 'json' };
  return { program: { name: str(pick(o, K.name)) || 'Programme importé', notes: str(pick(o, K.notes)), sessions, oneRms }, issues, source: 'json' };
}

// ---------------------------------------------------------------- texte libre (sans LLM)

const EXERCISE_LINE = /^(?:[-*•·>]|\d+[.)])?\s*(.+?)\s*[:–—-]?\s*(\d+)\s*(?:[x×*]|s[ée]ries?\s*(?:de|x)?)\s*(\d+(?:\s*(?:-|–|à|a)\s*\d+)?\s*(?:s|sec|min)?|max|amrap)\b(.*)$/i;

/** Une ligne « Squat 4x8 @75% repos 2min » (ou « Tractions : 3 séries de max »). */
export function parseExerciseLine(line: string): ParsedExercise | null {
  const m = line.trim().match(EXERCISE_LINE);
  if (!m) return null;
  const name = m[1]!.replace(/[:–—-]+$/, '').trim();
  if (!name || /^\d+$/.test(name)) return null;
  const tail = m[4] ?? '';
  const pct = tail.match(/(\d+(?:[.,]\d+)?)\s*%/);
  const kg = tail.match(/(\d+(?:[.,]\d+)?)\s*kg/i);
  const rpe = tail.match(/rpe\s*(\d+(?:[.,]\d)?)/i);
  const rest = tail.match(/(?:repos|rest|r[ée]cup)\s*:?\s*([\d.,:'’]+\s*(?:s|sec|min|mn)?)/i);
  const note = tail
    .replace(pct?.[0] ?? '', '')
    .replace(kg?.[0] ?? '', '')
    .replace(rpe?.[0] ?? '', '')
    .replace(rest?.[0] ?? '', '')
    .replace(/^[\s@,;·()-]+|[\s@,;·()-]+$/g, '')
    .trim();
  return {
    name,
    sets: Math.min(12, Math.max(1, Number(m[2]))),
    ...repsOf(m[3]!),
    kg: kg ? Number(kg[1]!.replace(',', '.')) : null,
    percent: pct ? Number(pct[1]!.replace(',', '.')) : null,
    rpe: rpe ? Number(rpe[1]!.replace(',', '.')) : null,
    restSeconds: rest ? secondsOf(rest[1]) : null,
    notes: note,
    equipment: null,
    muscles: [],
    bodyweight: null,
  };
}

/**
 * Un programme écrit en texte : des titres de séance (« Jour 1 – Push », « Lundi : jambes », « ## Séance A »)
 * suivis de lignes d'exercices. Les lignes incomprises sont signalées.
 */
export function parseProgramText(text: string): ParseResult {
  const issues: string[] = [];
  const sessions: ParsedSession[] = [];
  let current: ParsedSession | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\*\*/g, '').trim();
    if (!line) continue;
    const ex = parseExerciseLine(line);
    if (ex) {
      if (!current) {
        current = { name: 'Séance A', weekdays: [], notes: '', exercises: [] };
        sessions.push(current);
      }
      current.exercises.push(ex);
      continue;
    }
    const header = line.replace(/^#+\s*/, '').replace(/[:：]\s*$/, '').trim();
    if (header.length <= 60 && !/\d+\s*[x×]\s*\d+/.test(header)) {
      current = { name: header, weekdays: weekdaysIn(header), notes: '', exercises: [] };
      sessions.push(current);
    } else {
      issues.push(`Ligne non comprise : « ${line.slice(0, 60)} »`);
    }
  }
  const kept = sessions.filter((s) => s.exercises.length > 0);
  if (!kept.length) return { program: null, issues: ['Aucun exercice reconnu. Écris une ligne par exercice, par exemple « Squat 4x8 @75% ».', ...issues], source: 'text' };
  // Le premier titre sans exercice peut être le nom du programme.
  const title = sessions[0] && sessions[0].exercises.length === 0 && sessions.length > 1 ? sessions[0].name : 'Programme importé';
  return { program: { name: title, notes: '', sessions: kept, oneRms: [] }, issues, source: 'text' };
}

/** Tout ce qu'on peut coller : JSON (de n'importe quel LLM) ou texte. */
export function parseProgramInput(text: string): ParseResult {
  if (!text.trim()) return { program: null, issues: [], source: null };
  const json = parseJsonLoose(text);
  if (json !== undefined) {
    const r = readProgram(json);
    if (r.program) return r;
  }
  return parseProgramText(text);
}
