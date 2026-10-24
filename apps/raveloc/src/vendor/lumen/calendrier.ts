// GÉNÉRÉ depuis MyLife/packages/lumen — ne pas modifier ici (MyLife : npm run vendor).
import type { AgendaEvent } from './agenda';

/**
 * MyAgenda (V4, 3.2) : un agenda qui se remplit tout seul (l'agenda commun des apps : séances, paie, prélèvements,
 * sorties, repas) et tes agendas Google, Apple ou Outlook importés **par lien ICS ou par fichier**, lus sur l'appareil,
 * sans connexion à ton compte. Moteur pur : lecture ICS (répétitions courantes comprises), fusion, conflits.
 */

export interface CalendarSource {
  v: 1;
  name: string;
  /** Lien ICS (adresse secrète de l'agenda) ; absent pour un fichier importé une fois. */
  url?: string;
  /** Dernière lecture (ms). */
  syncedAt?: number;
}

/** Un événement importé (une occurrence, répétitions dépliées). */
export interface CalendarEvent {
  v: 1;
  source: string;
  title: string;
  /** AAAA-MM-JJ, heure locale. */
  date: string;
  /** HH:MM, heure locale ; absent pour un événement sur la journée. */
  time?: string;
  endDate?: string;
  endTime?: string;
  place?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function parseCalendarSource(raw: unknown): CalendarSource | null {
  const o = raw as Partial<CalendarSource> | null;
  const name = text(o?.name, 60);
  if (!o || o.v !== 1 || !name) return null;
  const url = typeof o.url === 'string' && /^(https|webcal):\/\/[\x21-\x7e]{4,2000}$/.test(o.url) ? o.url : undefined;
  return { v: 1, name, ...(url ? { url } : {}), ...(typeof o.syncedAt === 'number' ? { syncedAt: o.syncedAt } : {}) };
}

export function parseCalendarEvent(raw: unknown): CalendarEvent | null {
  const o = raw as Partial<CalendarEvent> | null;
  const title = text(o?.title, 120);
  if (!o || o.v !== 1 || !title || typeof o.source !== 'string' || typeof o.date !== 'string' || !DATE.test(o.date)) return null;
  return {
    v: 1,
    source: o.source.slice(0, 40),
    title,
    date: o.date,
    ...(typeof o.time === 'string' && TIME.test(o.time) ? { time: o.time } : {}),
    ...(typeof o.endDate === 'string' && DATE.test(o.endDate) && o.endDate >= o.date ? { endDate: o.endDate } : {}),
    ...(typeof o.endTime === 'string' && TIME.test(o.endTime) ? { endTime: o.endTime } : {}),
    ...(text(o.place, 120) ? { place: text(o.place, 120) } : {}),
  };
}

// ---------------------------------------------------------------- lecture ICS

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const unescape = (s: string) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

interface When {
  date: Date;
  allDay: boolean;
}

/** DTSTART / DTEND : « 20261024 » (journée), « 20261024T183000 » (heure locale ou TZID, gardée telle quelle), « …Z » (UTC → locale). */
function parseWhen(value: string, params: string): When | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (h === undefined || /VALUE=DATE(?!-)/i.test(params)) return { date: new Date(Number(y), Number(mo) - 1, Number(d)), allDay: true };
  const date = z ? new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi))) : new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  return { date, allDay: false };
}

interface RawEvent {
  uid: string;
  title: string;
  place?: string;
  start: When;
  end?: When;
  rrule?: Record<string, string>;
  exdates: Set<string>;
}

function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
}

/** Les événements d'un fichier ICS, répétitions dépliées sur [from, to] (jours inclus), 2 000 au plus. */
export function parseIcs(ics: string, source: string, from: string, to: string): CalendarEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(ics)) throw new Error('Ce n’est pas un agenda ICS (le fichier doit commencer par BEGIN:VCALENDAR).');
  const raws: RawEvent[] = [];
  let cur: Partial<RawEvent> & { exdates?: Set<string> } | null = null;
  for (const line of unfold(ics)) {
    if (/^BEGIN:VEVENT/i.test(line)) cur = { exdates: new Set() };
    else if (/^END:VEVENT/i.test(line)) {
      if (cur?.start && cur.title !== undefined) raws.push({ uid: cur.uid ?? `${raws.length}`, title: cur.title || 'Sans titre', start: cur.start, exdates: cur.exdates!, ...(cur.end ? { end: cur.end } : {}), ...(cur.place ? { place: cur.place } : {}), ...(cur.rrule ? { rrule: cur.rrule } : {}) });
      cur = null;
    } else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const head = line.slice(0, i);
      const value = line.slice(i + 1);
      const [name = '', ...params] = head.split(';');
      const p = params.join(';');
      switch (name.toUpperCase()) {
        case 'UID': cur.uid = value.trim().slice(0, 120); break;
        case 'SUMMARY': cur.title = unescape(value).slice(0, 120); break;
        case 'LOCATION': cur.place = unescape(value).slice(0, 120); break;
        case 'DTSTART': cur.start = parseWhen(value, p) ?? undefined; break;
        case 'DTEND': cur.end = parseWhen(value, p) ?? undefined; break;
        case 'RRULE': cur.rrule = Object.fromEntries(value.split(';').map((kv) => kv.split('=') as [string, string]).filter(([k, v]) => k && v).map(([k, v]) => [k.toUpperCase(), v])); break;
        case 'EXDATE': for (const v of value.split(',')) { const w = parseWhen(v, p); if (w) cur.exdates!.add(isoDay(w.date)); } break;
      }
    }
  }
  const out: CalendarEvent[] = [];
  const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  for (const r of raws) {
    const durationMs = r.end ? r.end.date.getTime() - r.start.date.getTime() : 0;
    const emit = (start: Date) => {
      const date = isoDay(start);
      if (date < from || date > to || r.exdates.has(date) || out.length >= 2000) return;
      const end = durationMs > 0 ? new Date(start.getTime() + durationMs - (r.start.allDay ? 86_400_000 : 0)) : null;
      out.push({ v: 1, source, title: r.title, date, ...(r.start.allDay ? {} : { time: hhmm(start) }), ...(end && isoDay(end) > date ? { endDate: isoDay(end) } : {}), ...(end && !r.start.allDay ? { endTime: hhmm(end) } : {}), ...(r.place ? { place: r.place } : {}) });
    };
    if (!r.rrule) {
      emit(r.start.date);
      continue;
    }
    const freq = r.rrule.FREQ;
    const interval = Math.max(1, Number(r.rrule.INTERVAL ?? 1) || 1);
    const count = r.rrule.COUNT ? Number(r.rrule.COUNT) : Infinity;
    const until = r.rrule.UNTIL ? parseWhen(r.rrule.UNTIL, '')?.date : undefined;
    const byday = (r.rrule.BYDAY ?? '').split(',').map((d) => DAYS.indexOf(d.replace(/^[+-]?\d+/, ''))).filter((d) => d >= 0);
    let n = 0;
    const d = new Date(r.start.date);
    for (let guard = 0; guard < 3000 && n < count; guard++) {
      if (until && d > until) break;
      if (isoDay(d) > to) break;
      if (freq === 'WEEKLY' && byday.length) {
        // Les jours de la semaine demandés, la semaine de `d` (qui avance de `interval` semaines).
        const monday = new Date(d);
        monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        for (const wd of [...byday].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) {
          const day = new Date(monday);
          day.setDate(monday.getDate() + ((wd + 6) % 7));
          day.setHours(r.start.date.getHours(), r.start.date.getMinutes());
          if (day < r.start.date || (until && day > until) || n >= count) continue;
          n++;
          emit(day);
        }
        d.setDate(d.getDate() + 7 * interval);
        continue;
      }
      n++;
      emit(new Date(d));
      if (freq === 'DAILY') d.setDate(d.getDate() + interval);
      else if (freq === 'WEEKLY') d.setDate(d.getDate() + 7 * interval);
      else if (freq === 'MONTHLY') d.setMonth(d.getMonth() + interval);
      else if (freq === 'YEARLY') d.setFullYear(d.getFullYear() + interval);
      else break;
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
}

// ---------------------------------------------------------------- vue et conflits

/** Un élément de l'agenda, d'une app ou importé, dans la même forme. */
export interface AgendaItem {
  key: string;
  title: string;
  date: string;
  end?: string;
  time?: string;
  endTime?: string;
  /** D'où il vient : l'app (agenda commun) ou le nom de l'agenda importé. */
  from: string;
  kind: AgendaEvent['kind'] | 'imported';
  url?: string;
  place?: string;
}

export function mergeAgenda(apps: readonly AgendaEvent[], imported: readonly { id: string; value: CalendarEvent }[], sources: ReadonlyMap<string, string>): AgendaItem[] {
  return [
    ...apps.map((e) => ({ key: `${e.app}:${e.id}`, title: e.title, date: e.date, ...(e.end ? { end: e.end } : {}), ...(e.time ? { time: e.time } : {}), from: e.app, kind: e.kind, ...(e.url ? { url: e.url } : {}) })),
    ...imported.map((i) => ({ key: `ics:${i.id}`, title: i.value.title, date: i.value.date, ...(i.value.endDate ? { end: i.value.endDate } : {}), ...(i.value.time ? { time: i.value.time } : {}), ...(i.value.endTime ? { endTime: i.value.endTime } : {}), from: sources.get(i.value.source) ?? 'Agenda importé', kind: 'imported' as const, ...(i.value.place ? { place: i.value.place } : {}) })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '99').localeCompare(b.time ?? '99') || a.title.localeCompare(b.title));
}

export interface Conflict {
  date: string;
  text: string;
  keys: string[];
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const addDay = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
};
const covers = (i: AgendaItem, day: string) => i.date <= day && (i.end ?? i.date) >= day;

/**
 * Les conflits à signaler : deux rendez-vous à l'heure qui se chevauchent ; une séance de jambes la veille d'une
 * sortie ; un repas prévu un soir où un rendez-vous commence après 18 h.
 */
export function findConflicts(items: readonly AgendaItem[]): Conflict[] {
  const out: Conflict[] = [];
  const timed = items.filter((i) => i.time && i.kind !== 'meal' && i.kind !== 'income' && i.kind !== 'charge' && i.kind !== 'savings');
  for (let a = 0; a < timed.length; a++) {
    for (let b = a + 1; b < timed.length; b++) {
      const x = timed[a]!;
      const y = timed[b]!;
      if (x.date !== y.date) continue;
      const xs = minutes(x.time!);
      const ys = minutes(y.time!);
      const xe = x.endTime ? minutes(x.endTime) : xs + 60;
      const ye = y.endTime ? minutes(y.endTime) : ys + 60;
      if (xs < ye && ys < xe) out.push({ date: x.date, text: `« ${x.title} » et « ${y.title} » se chevauchent`, keys: [x.key, y.key] });
    }
  }
  for (const s of items.filter((i) => i.kind === 'session' && /jambe|leg|squat|bas du corps|lower/i.test(i.title))) {
    const tomorrow = addDay(s.date, 1);
    const out2 = items.find((i) => i.kind === 'sortie' && i.date === tomorrow);
    if (out2) out.push({ date: s.date, text: `Séance « ${s.title} » la veille de « ${out2.title} » : tu seras courbaturé`, keys: [s.key, out2.key] });
  }
  for (const m of items.filter((i) => i.kind === 'meal' && /soir/i.test(i.title))) {
    const busy = items.find((i) => i.kind === 'imported' && covers(i, m.date) && i.time && minutes(i.time) >= 18 * 60);
    if (busy) out.push({ date: m.date, text: `Repas prévu ce soir, mais « ${busy.title} » à ${busy.time}`, keys: [m.key, busy.key] });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
