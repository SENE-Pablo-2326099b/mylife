import { HttpError, verifyToken, type Db } from './core.js';

/**
 * Relais des agendas ICS de MyAgenda (POST /api/calendar) : un navigateur ne peut pas lire directement le lien ICS d'un
 * agenda Google, Apple ou Outlook (CORS). Le serveur va chercher le fichier, le renvoie tel quel et **ne garde rien**
 * (ni le lien, ni le contenu). Garde-fous : session requise, https seulement (webcal:// est converti), pas d'adresse
 * interne (localhost, réseaux privés, y compris après une redirection), 3 Mo, 10 s, 30 lectures par heure et par compte.
 */
const RATE = { max: 30, windowMs: 60 * 60_000 };
const MAX_BYTES = 3_000_000;

async function limited(db: Db, uid: string, now: number): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS calendar_rate (k TEXT PRIMARY KEY, win BIGINT NOT NULL, n INTEGER NOT NULL)`);
  if (Math.random() < 0.02) await db.query('DELETE FROM calendar_rate WHERE win < $1', [Math.floor((now - 2 * 86_400_000) / RATE.windowMs)]);
  const win = Math.floor(now / RATE.windowMs);
  const { rows } = await db.query<{ n: number }>(
    `INSERT INTO calendar_rate (k, win, n) VALUES ($1, $2, 1)
     ON CONFLICT (k) DO UPDATE SET n = CASE WHEN calendar_rate.win = EXCLUDED.win THEN calendar_rate.n + 1 ELSE 1 END, win = EXCLUDED.win RETURNING n`,
    [uid, win],
  );
  if (Number(rows[0]?.n ?? 0) > RATE.max) throw new HttpError(429, 'Trop de mises à jour d’agenda : réessaie dans une heure.');
}

/** Une adresse qu'on accepte de lire : https, nom d'hôte public (pas d'IP privée ni de nom local). */
export function publicHttpsUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/^webcal:\/\//i, 'https://'));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return null;
  }
  if (host.includes(':')) return null; // IPv6 littérale : refusée (pas besoin pour un agenda)
  return url;
}

export type FetchText = (url: string) => Promise<{ ok: boolean; status: number; url: string; text: string }>;

const defaultFetch: FetchText = async (url) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'text/calendar, text/plain;q=0.8' }, redirect: 'follow' });
    const reader = res.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          throw new HttpError(413, 'Agenda trop gros (3 Mo au plus).');
        }
        chunks.push(value);
      }
    }
    return { ok: res.ok, status: res.status, url: res.url || url, text: new TextDecoder().decode(Buffer.concat(chunks)) };
  } finally {
    clearTimeout(timer);
  }
};

export async function calendarDispatch(db: Db, env: { secret: string }, auth: string | undefined, body: Record<string, unknown>, get: FetchText = defaultFetch, now = Date.now()): Promise<unknown> {
  const uid = verifyToken(auth, env.secret, now);
  if (!uid) throw new HttpError(401, 'Session expirée : reconnecte-toi.');
  if (body.action !== 'fetch') throw new HttpError(400, 'Action inconnue');
  const url = typeof body.url === 'string' ? publicHttpsUrl(body.url) : null;
  if (!url) throw new HttpError(400, 'Lien d’agenda invalide : il doit commencer par https:// ou webcal://.');
  await limited(db, uid, now);
  let res: Awaited<ReturnType<FetchText>>;
  try {
    res = await get(url.toString());
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'Agenda injoignable : vérifie le lien.');
  }
  // Une redirection vers une adresse interne est refusée.
  if (!publicHttpsUrl(res.url)) throw new HttpError(400, 'Lien d’agenda refusé.');
  if (!res.ok) throw new HttpError(502, `L’agenda a répondu ${res.status} : vérifie que le lien est bien l’adresse ICS (secrète) de l’agenda.`);
  if (!/BEGIN:VCALENDAR/i.test(res.text.slice(0, 2000))) throw new HttpError(422, 'Ce lien ne mène pas à un agenda ICS.');
  return { ics: res.text };
}
