// GÉNÉRÉ depuis MyLife/packages/lumen — ne pas modifier ici (MyLife : npm run vendor).
import { addWeeks, weekStart } from './character';

/**
 * Mes apps : de petites apps personnelles SANS CODE. Une app est une description en JSON (format
 * `mylife-app`) : des champs à remplir, un objectif, des stats, un graphique. MyLife la lit, la vérifie de près
 * et l'affiche avec son propre moteur : rien ne s'exécute. On la crée à partir d'un modèle, ou en décrivant ce
 * qu'on veut à n'importe quelle IA gratuite (la demande est fournie), puis en collant sa réponse. Elle se
 * partage par un lien qui ne contient que la description, jamais les saisies.
 */

export const MINI_FIELD_TYPES = ['number', 'duration', 'rating', 'check', 'choice', 'text'] as const;
export type MiniFieldType = (typeof MINI_FIELD_TYPES)[number];

export const MINI_ICONS = ['sparkles', 'leaf', 'flame', 'moon', 'time', 'trophy', 'flag', 'bulb', 'cash', 'barbell', 'people', 'calendar', 'list', 'check', 'rocket', 'compass', 'palette', 'phone', 'tag', 'home'] as const;
export type MiniIcon = (typeof MINI_ICONS)[number];

export const MINI_COLORS = { or: ['#F5C451', '#C98A1B'], vert: ['#4ADE80', '#15803D'], bleu: ['#60A5FA', '#1D4ED8'], violet: ['#A78BFA', '#6D28D9'], rose: ['#F472B6', '#BE185D'], orange: ['#FB923C', '#C2410C'], rouge: ['#F87171', '#B91C1C'], cyan: ['#22D3EE', '#0E7490'] } as const;
export type MiniColor = keyof typeof MINI_COLORS;

export interface MiniField {
  id: string;
  label: string;
  type: MiniFieldType;
  unit?: string;
  /** Pour `choice` : 2 à 12 options. */
  options?: string[];
  required?: boolean;
}

export type MiniAgg = 'count' | 'sum' | 'avg' | 'max' | 'min' | 'top';
export type MiniPeriod = 'week' | 'month' | 'all';

export interface MiniStat {
  label: string;
  agg: MiniAgg;
  field?: string;
  period: MiniPeriod;
}

export interface MiniGoal {
  agg: 'count' | 'sum';
  field?: string;
  per: 'day' | 'week';
  target: number;
}

export interface MiniSpec {
  format: 'mylife-app';
  v: 1;
  name: string;
  description?: string;
  icon: MiniIcon;
  color: MiniColor;
  fields: MiniField[];
  goal?: MiniGoal;
  stats: MiniStat[];
  /** Graphique des 8 dernières semaines. */
  chart?: { agg: 'count' | 'sum' | 'avg'; field?: string };
}

export type MiniValue = number | string | boolean;

export interface MiniEntry {
  id: string;
  day: string;
  values: Record<string, MiniValue>;
}

/** Une app de l'utilisateur et ses saisies ; `spec: null` = supprimée (gardée vide pour que la suppression suive). */
export interface MiniApp {
  v: 1;
  id: string;
  at: number;
  created: number;
  spec: MiniSpec | null;
  entries: MiniEntry[];
}

export const MAX_MINI_APPS = 20;
export const MAX_MINI_ENTRIES = 1500;

const NUMERIC: readonly MiniFieldType[] = ['number', 'duration', 'rating'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FIELD_ID = /^[a-z][a-z0-9_]{0,23}$/;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'f$1')
    .slice(0, 24);

export type ParsedSpec = { spec: MiniSpec; error?: undefined } | { spec?: undefined; error: string };

/**
 * Lecture prudente d'une description d'app (venue d'un modèle, d'une IA ou d'un lien) : tout est vérifié et
 * borné ; ce qui manque prend une valeur par défaut ; ce qui n'a pas de sens est refusé avec une explication.
 */
export function parseSpec(raw: unknown): ParsedSpec {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Ce n’est pas une description d’app (un objet JSON est attendu).' };
  const o = raw as Record<string, unknown>;
  if (o.format !== undefined && o.format !== 'mylife-app') return { error: 'Format inconnu : « mylife-app » attendu.' };
  const name = str(o.name, 40);
  if (!name) return { error: 'Il manque le nom de l’app (« name »).' };
  if (!Array.isArray(o.fields) || o.fields.length === 0) return { error: 'Il faut au moins un champ à remplir (« fields »).' };
  if (o.fields.length > 8) return { error: '8 champs au plus.' };
  const fields: MiniField[] = [];
  for (const [i, f] of o.fields.entries()) {
    if (!f || typeof f !== 'object') return { error: `Champ n° ${i + 1} illisible.` };
    const x = f as Record<string, unknown>;
    const label = str(x.label, 40);
    if (!label) return { error: `Champ n° ${i + 1} : il manque son nom (« label »).` };
    const type = x.type;
    if (typeof type !== 'string' || !(MINI_FIELD_TYPES as readonly string[]).includes(type)) return { error: `Champ « ${label} » : type inconnu (${MINI_FIELD_TYPES.join(', ')}).` };
    let id = typeof x.id === 'string' && FIELD_ID.test(x.id) ? x.id : slug(label) || `champ_${i + 1}`;
    if (fields.some((g) => g.id === id)) id = `${id.slice(0, 20)}_${i + 1}`;
    const field: MiniField = { id, label, type: type as MiniFieldType };
    const unit = str(x.unit, 12);
    if (type === 'duration') field.unit = 'min';
    else if (type === 'number' && unit) field.unit = unit;
    if (type === 'choice') {
      const options = Array.isArray(x.options) ? [...new Set(x.options.map((v) => str(v, 30)).filter(Boolean))].slice(0, 12) : [];
      if (options.length < 2) return { error: `Champ « ${label} » : un choix demande au moins 2 options.` };
      field.options = options;
    }
    if (x.required === true) field.required = true;
    fields.push(field);
  }
  const byId = new Map(fields.map((f) => [f.id, f]));
  // Un champ cité par son nom au lieu de son identifiant est retrouvé.
  const ref = (v: unknown): MiniField | undefined => (typeof v === 'string' ? (byId.get(v) ?? fields.find((f) => f.label.toLowerCase() === v.trim().toLowerCase() || f.id === slug(v))) : undefined);

  let goal: MiniGoal | undefined;
  if (o.goal && typeof o.goal === 'object') {
    const g = o.goal as Record<string, unknown>;
    const target = typeof g.target === 'number' && Number.isFinite(g.target) && g.target > 0 ? Math.min(1_000_000, g.target) : null;
    const per = g.per === 'day' ? 'day' : 'week';
    const field = ref(g.field);
    if (target !== null) {
      if (g.agg === 'sum') {
        if (!field || !NUMERIC.includes(field.type)) return { error: 'Objectif : une somme se fait sur un champ nombre, durée ou note.' };
        goal = { agg: 'sum', field: field.id, per, target };
      } else goal = { agg: 'count', ...(field ? { field: field.id } : {}), per, target: Math.round(target) || 1 };
    }
  }

  const stats: MiniStat[] = [];
  for (const s of Array.isArray(o.stats) ? o.stats.slice(0, 4) : []) {
    if (!s || typeof s !== 'object') continue;
    const x = s as Record<string, unknown>;
    const agg = x.agg;
    if (agg !== 'count' && agg !== 'sum' && agg !== 'avg' && agg !== 'max' && agg !== 'min' && agg !== 'top') continue;
    const period: MiniPeriod = x.period === 'month' || x.period === 'all' ? x.period : 'week';
    const field = ref(x.field);
    if (agg === 'top' ? !field || (field.type !== 'choice' && field.type !== 'text') : agg !== 'count' && (!field || !NUMERIC.includes(field.type))) continue;
    stats.push({ label: str(x.label, 30) || defaultStatLabel(agg, field, period), agg, ...(field ? { field: field.id } : {}), period });
  }
  if (stats.length === 0) stats.push({ label: 'Cette semaine', agg: 'count', period: 'week' }, { label: 'Depuis le début', agg: 'count', period: 'all' });

  let chart: MiniSpec['chart'];
  if (o.chart && typeof o.chart === 'object') {
    const c = o.chart as Record<string, unknown>;
    const field = ref(c.field);
    if ((c.agg === 'sum' || c.agg === 'avg') && field && NUMERIC.includes(field.type)) chart = { agg: c.agg, field: field.id };
    else if (c.agg === 'count') chart = { agg: 'count', ...(field ? { field: field.id } : {}) };
  }

  const icon = (MINI_ICONS as readonly string[]).includes(o.icon as string) ? (o.icon as MiniIcon) : 'sparkles';
  const color = typeof o.color === 'string' && o.color in MINI_COLORS ? (o.color as MiniColor) : 'or';
  const description = str(o.description, 120);
  return { spec: { format: 'mylife-app', v: 1, name, ...(description ? { description } : {}), icon, color, fields, ...(goal ? { goal } : {}), stats, ...(chart ? { chart } : {}) } };
}

function defaultStatLabel(agg: MiniAgg, field: MiniField | undefined, period: MiniPeriod): string {
  const when = period === 'week' ? 'cette semaine' : period === 'month' ? 'ce mois' : 'en tout';
  const what = { count: 'Saisies', sum: field?.label ?? 'Total', avg: `Moyenne ${field?.label.toLowerCase() ?? ''}`.trim(), max: `Record ${field?.label.toLowerCase() ?? ''}`.trim(), min: `Minimum ${field?.label.toLowerCase() ?? ''}`.trim(), top: `${field?.label ?? 'Le plus fréquent'}` }[agg];
  return `${what} ${when}`.slice(0, 30);
}

// ---------------------------------------------------------------- saisies

/**
 * Vérifie une saisie : les valeurs hors du champ, du mauvais type ou hors bornes sont refusées. `lenient` (relecture
 * d'une saisie déjà enregistrée) : on garde ce qui est valable au lieu de tout refuser.
 */
export function cleanValues(spec: MiniSpec, values: Record<string, unknown>, lenient = false): { values: Record<string, MiniValue>; error?: string } {
  const out: Record<string, MiniValue> = {};
  for (const f of spec.fields) {
    const r = cleanValue(f, values[f.id]);
    if (r.error) {
      if (!lenient) return { values: out, error: r.error };
    } else if (r.value !== undefined) out[f.id] = r.value;
  }
  if (Object.keys(out).length === 0) return { values: out, error: 'Remplis au moins un champ.' };
  return { values: out };
}

function cleanValue(f: MiniField, v: unknown): { value?: MiniValue; error?: string } {
  const empty = v === undefined || v === null || v === '' || (typeof v === 'number' && Number.isNaN(v));
  if (empty) return f.required ? { error: `« ${f.label} » est à remplir.` } : {};
  if (f.type === 'number' || f.type === 'duration') {
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    const max = f.type === 'duration' ? 1440 : 1e9;
    if (!Number.isFinite(n) || n < 0 || n > max) return { error: `« ${f.label} » : nombre invalide.` };
    return { value: Math.round(n * 100) / 100 };
  }
  if (f.type === 'rating') return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? { value: v } : { error: `« ${f.label} » : une note de 1 à 5.` };
  if (f.type === 'check') {
    if (typeof v !== 'boolean') return { error: `« ${f.label} » : oui ou non.` };
    return v || f.required ? { value: v } : {};
  }
  if (f.type === 'choice') return typeof v === 'string' && f.options?.includes(v) ? { value: v } : { error: `« ${f.label} » : choix inconnu.` };
  const t = str(v, 200);
  return t ? { value: t } : f.required ? { error: `« ${f.label} » est à remplir.` } : {};
}

export function emptyMiniApp(id: string, spec: MiniSpec, now = Date.now()): MiniApp {
  return { v: 1, id, at: now, created: now, spec, entries: [] };
}

/** Ajoute une saisie (les plus anciennes partent au-delà de 1 500). */
export function addEntry(app: MiniApp, entry: MiniEntry, now = Date.now()): MiniApp {
  if (!DATE.test(entry.day)) return app;
  const entries = [...app.entries.filter((e) => e.id !== entry.id), entry].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)).slice(-MAX_MINI_ENTRIES);
  return { ...app, at: now, entries };
}

export const removeEntry = (app: MiniApp, id: string, now = Date.now()): MiniApp => ({ ...app, at: now, entries: app.entries.filter((e) => e.id !== id) });

/** Supprimer une app : il en reste une trace vide et datée, pour que la suppression gagne sur les autres appareils. */
export const deleteMiniApp = (app: MiniApp, now = Date.now()): MiniApp => ({ ...app, at: now, spec: null, entries: [] });

export function parseMiniApp(raw: unknown): MiniApp | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || typeof o.id !== 'string' || !/^[a-z0-9]{6,32}$/.test(o.id) || typeof o.at !== 'number' || typeof o.created !== 'number' || !Array.isArray(o.entries)) return null;
  if (o.spec === null) return { v: 1, id: o.id, at: o.at, created: o.created, spec: null, entries: [] };
  const parsed = parseSpec(o.spec);
  if (!parsed.spec) return null;
  const spec = parsed.spec;
  const entries: MiniEntry[] = [];
  for (const e of o.entries.slice(-MAX_MINI_ENTRIES)) {
    const x = (e ?? {}) as Record<string, unknown>;
    if (typeof x.id !== 'string' || typeof x.day !== 'string' || !DATE.test(x.day) || !x.values || typeof x.values !== 'object') continue;
    // Une saisie devenue incomplète (champ rendu obligatoire) reste visible : on garde ce qui est valable.
    const { values } = cleanValues(spec, x.values as Record<string, unknown>, true);
    if (Object.keys(values).length) entries.push({ id: x.id.slice(0, 32), day: x.day, values });
  }
  return { v: 1, id: o.id, at: o.at, created: o.created, spec, entries };
}

// ---------------------------------------------------------------- calculs

const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const toMs = (d: string) => Date.parse(`${d}T12:00:00Z`);
const addDays = (d: string, n: number) => new Date(toMs(d) + n * 86_400_000).toISOString().slice(0, 10);

export function periodRange(period: MiniPeriod | 'day', today: string): { from: string; to: string } {
  if (period === 'day') return { from: today, to: today };
  if (period === 'week') return { from: weekStart(today), to: addDays(weekStart(today), 6) };
  if (period === 'month') return { from: monthStart(today), to: `${today.slice(0, 7)}-31` };
  return { from: '0000-01-01', to: '9999-12-31' };
}

const within = (entries: readonly MiniEntry[], from: string, to: string) => entries.filter((e) => e.day >= from && e.day <= to);

/** Une agrégation : nombre de saisies (où le champ est rempli), somme, moyenne, max, min, valeur la plus fréquente. */
export function aggregate(entries: readonly MiniEntry[], agg: MiniAgg, field?: string): number | string | null {
  if (agg === 'count') return field ? entries.filter((e) => e.values[field] !== undefined && e.values[field] !== false).length : entries.length;
  if (agg === 'top') {
    const counts = new Map<string, number>();
    for (const e of entries) {
      const v = field ? e.values[field] : undefined;
      if (typeof v === 'string') counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let best: string | null = null;
    let n = 0;
    for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
    return best;
  }
  const nums = entries.map((e) => (field ? e.values[field] : undefined)).filter((v): v is number => typeof v === 'number');
  if (agg === 'sum') return Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
  if (nums.length === 0) return null;
  if (agg === 'avg') return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
  return agg === 'max' ? Math.max(...nums) : Math.min(...nums);
}

export function statValue(entries: readonly MiniEntry[], stat: MiniStat, today: string): number | string | null {
  const { from, to } = periodRange(stat.period, today);
  return aggregate(within(entries, from, to), stat.agg, stat.field);
}

export interface GoalProgress {
  value: number;
  target: number;
  done: boolean;
  /** Jours ou semaines d'affilée où l'objectif est tenu (la période en cours compte si elle est déjà tenue). */
  streak: number;
}

export function goalProgress(spec: MiniSpec, entries: readonly MiniEntry[], today: string): GoalProgress | null {
  const g = spec.goal;
  if (!g) return null;
  const valueAt = (day: string) => {
    const { from, to } = periodRange(g.per, day);
    return Number(aggregate(within(entries, from, to), g.agg, g.field) ?? 0);
  };
  const value = valueAt(today);
  const done = value >= g.target;
  const step = (d: string, n: number) => (g.per === 'day' ? addDays(d, n) : addWeeks(weekStart(d), n));
  let streak = done ? 1 : 0;
  const first = entries[0]?.day ?? today;
  for (let d = step(today, -1); d >= (g.per === 'day' ? first : weekStart(first)) && valueAt(d) >= g.target; d = step(d, -1)) streak += 1;
  return { value, target: g.target, done, streak };
}

/** Les 8 dernières semaines du graphique (lundi, valeur). */
export function weeklySeries(spec: MiniSpec, entries: readonly MiniEntry[], today: string, weeks = 8): { week: string; value: number }[] {
  const c = spec.chart ?? { agg: 'count' as const };
  const last = weekStart(today);
  return Array.from({ length: weeks }, (_, i) => {
    const week = addWeeks(last, i - weeks + 1);
    return { week, value: Number(aggregate(within(entries, week, addDays(week, 6)), c.agg, c.field) ?? 0) };
  });
}

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** Une valeur affichée selon son champ : « 1 h 05 », « 4/5 », « oui », « 12 pages ». */
export function formatMini(field: MiniField | undefined, v: MiniValue | null, agg?: MiniAgg): string {
  if (v === null || v === undefined) return '—';
  if (agg === 'count') return nf.format(Number(v));
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  if (typeof v === 'string') return v;
  if (field?.type === 'duration') {
    const m = Math.round(v);
    return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
  }
  if (field?.type === 'rating') return `${nf.format(v)}/5`;
  return field?.unit ? `${nf.format(v)} ${field.unit}` : nf.format(v);
}

// ---------------------------------------------------------------- partage et IA

const b64url = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Lien de partage : la description seule (jamais les saisies), dans le fragment (non envoyé au serveur). */
export const encodeSpec = (spec: MiniSpec): string => b64url(JSON.stringify(spec));

export function decodeSpec(code: string): ParsedSpec {
  try {
    const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    return parseSpec(JSON.parse(json));
  } catch {
    return { error: 'Lien abîmé : demande-le à nouveau.' };
  }
}

/** Le JSON dans la réponse d'une IA (bloc de code ou texte autour). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Aucun JSON trouvé : colle la réponse complète de l’IA.');
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error('JSON abîmé : redemande à l’IA « uniquement le JSON, complet ».');
  }
}

/** La demande à coller dans n'importe quelle IA (ChatGPT, Le Chat, Gemini, Claude…), suivie de la description de l'utilisateur. */
export function miniAppPrompt(wish: string): string {
  return `Tu crées une petite app de suivi pour l'application MyLife. Réponds UNIQUEMENT par un objet JSON valide (pas de texte autour), au format suivant :

{
  "format": "mylife-app",
  "v": 1,
  "name": "nom court (40 caractères max)",
  "description": "une phrase (120 max)",
  "icon": un de ${MINI_ICONS.map((i) => `"${i}"`).join(', ')},
  "color": un de ${Object.keys(MINI_COLORS).map((c) => `"${c}"`).join(', ')},
  "fields": [ 1 à 8 champs remplis à chaque saisie :
    { "id": "identifiant_minuscule", "label": "Nom affiché", "type": "number" | "duration" | "rating" | "check" | "choice" | "text", "unit": "unité (pour number)", "options": ["…", "…"] (pour choice, 2 à 12), "required": true|false }
  ],
  "goal": { "agg": "count" | "sum", "field": "id d'un champ (obligatoire pour sum)", "per": "day" | "week", "target": nombre } (facultatif),
  "stats": [ 1 à 4 : { "label": "texte court", "agg": "count" | "sum" | "avg" | "max" | "min" | "top", "field": "id", "period": "week" | "month" | "all" } ],
  "chart": { "agg": "count" | "sum" | "avg", "field": "id" } (facultatif : graphique des 8 dernières semaines)
}

Types : number = nombre (avec unité), duration = durée en minutes, rating = note de 1 à 5, check = oui/non, choice = un choix parmi des options, text = note libre. "sum", "avg", "max", "min" seulement sur number, duration ou rating ; "top" (valeur la plus fréquente) seulement sur choice ou text. Chaque saisie est datée automatiquement : pas de champ date. Reste simple : 2 à 4 champs suffisent souvent.

Ce que je veux suivre : ${wish.trim() || '(décris ici ce que tu veux suivre)'}`;
}

// ---------------------------------------------------------------- modèles

const T = (spec: Omit<MiniSpec, 'format' | 'v'>): MiniSpec => ({ format: 'mylife-app', v: 1, ...spec });

export const MINI_TEMPLATES: MiniSpec[] = [
  T({
    name: 'Lecture',
    description: 'Les pages lues et tes livres du moment.',
    icon: 'bulb',
    color: 'violet',
    fields: [
      { id: 'pages', label: 'Pages lues', type: 'number', unit: 'pages', required: true },
      { id: 'livre', label: 'Livre', type: 'text' },
    ],
    goal: { agg: 'sum', field: 'pages', per: 'week', target: 150 },
    stats: [
      { label: 'Pages cette semaine', agg: 'sum', field: 'pages', period: 'week' },
      { label: 'Pages ce mois', agg: 'sum', field: 'pages', period: 'month' },
      { label: 'Livre du moment', agg: 'top', field: 'livre', period: 'month' },
    ],
    chart: { agg: 'sum', field: 'pages' },
  }),
  T({
    name: 'Eau',
    description: 'Tes verres d’eau de la journée.',
    icon: 'leaf',
    color: 'cyan',
    fields: [{ id: 'verres', label: 'Verres', type: 'number', unit: 'verres', required: true }],
    goal: { agg: 'sum', field: 'verres', per: 'day', target: 8 },
    stats: [
      { label: 'Moyenne par saisie', agg: 'avg', field: 'verres', period: 'week' },
      { label: 'Verres cette semaine', agg: 'sum', field: 'verres', period: 'week' },
    ],
    chart: { agg: 'sum', field: 'verres' },
  }),
  T({
    name: 'Sommeil',
    description: 'Combien et comment tu dors.',
    icon: 'moon',
    color: 'bleu',
    fields: [
      { id: 'duree', label: 'Durée', type: 'duration', unit: 'min', required: true },
      { id: 'qualite', label: 'Qualité', type: 'rating' },
    ],
    stats: [
      { label: 'Moyenne cette semaine', agg: 'avg', field: 'duree', period: 'week' },
      { label: 'Qualité moyenne', agg: 'avg', field: 'qualite', period: 'month' },
      { label: 'Plus longue nuit', agg: 'max', field: 'duree', period: 'month' },
    ],
    chart: { agg: 'avg', field: 'duree' },
  }),
  T({
    name: 'Humeur',
    description: 'Comment tu te sens, et pourquoi.',
    icon: 'sparkles',
    color: 'rose',
    fields: [
      { id: 'humeur', label: 'Humeur', type: 'choice', options: ['Au top', 'Bien', 'Bof', 'Pas bien'], required: true },
      { id: 'note', label: 'Pourquoi ?', type: 'text' },
    ],
    stats: [
      { label: 'Humeur du mois', agg: 'top', field: 'humeur', period: 'month' },
      { label: 'Jours notés ce mois', agg: 'count', period: 'month' },
    ],
  }),
  T({
    name: 'Méditation',
    description: 'Tes minutes de calme.',
    icon: 'leaf',
    color: 'vert',
    fields: [{ id: 'minutes', label: 'Durée', type: 'duration', unit: 'min', required: true }],
    goal: { agg: 'count', per: 'week', target: 4 },
    stats: [
      { label: 'Minutes cette semaine', agg: 'sum', field: 'minutes', period: 'week' },
      { label: 'Séances en tout', agg: 'count', period: 'all' },
    ],
    chart: { agg: 'sum', field: 'minutes' },
  }),
  T({
    name: 'Habitude',
    description: 'Une habitude à tenir, cochée chaque jour.',
    icon: 'check',
    color: 'or',
    fields: [{ id: 'fait', label: 'Fait aujourd’hui', type: 'check', required: true }],
    goal: { agg: 'count', field: 'fait', per: 'week', target: 5 },
    stats: [
      { label: 'Jours cette semaine', agg: 'count', field: 'fait', period: 'week' },
      { label: 'Jours ce mois', agg: 'count', field: 'fait', period: 'month' },
    ],
    chart: { agg: 'count', field: 'fait' },
  }),
];
