const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayTime = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** « 21:40 » aujourd'hui, « sam. 03:00 » un autre jour. */
export function when(ts: number, now = Date.now()): string {
  const a = new Date(ts);
  const b = new Date(now);
  return a.toDateString() === b.toDateString() ? time.format(a) : dayTime.format(a);
}

/** « dans 2 h 10 », « dans 3 j ». */
export function remaining(ts: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((ts - now) / 60_000));
  if (m < 60) return `dans ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `dans ${h} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
  return `dans ${Math.round(h / 24)} j`;
}

/** Couleur stable d'un membre (dérivée de son identifiant), dans la famille de lumières de l'app. */
export function hueOf(uid: string): string {
  let h = 0;
  for (const c of uid) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 90% 68%)`;
}

export const initial = (name: string | null) => (name?.trim()[0] ?? '?').toUpperCase();
