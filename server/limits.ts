import { HttpError } from './core.js';

/**
 * Taille maximale du corps d'une requête, vérifiée **avant** de le lire : un corps démesuré est refusé sans être
 * analysé. Les points d'entrée qui portent des lignes chiffrées (synchro, espaces, MyRave) gardent la limite de
 * l'hébergeur actuel (Vercel : 4,5 Mo), pour ne rien refuser qui passe aujourd'hui ; les autres n'échangent que
 * quelques centaines d'octets (compte, notifications, support : un message de 2 000 caractères au plus).
 */
export const BODY_LIMITS = { small: 64 * 1024, large: 4_500_000 } as const;
const SMALL = new Set(['/api/auth', '/api/push', '/api/support']);

export function bodyLimit(url: string | undefined): number {
  const path = (url ?? '').split('?')[0]!.replace(/\/+$/, '');
  return SMALL.has(path) ? BODY_LIMITS.small : BODY_LIMITS.large;
}

/** Seul du JSON est accepté (tous les clients de MyLife en envoient). */
export function checkJsonType(contentType: string | string[] | undefined): void {
  const v = (Array.isArray(contentType) ? contentType[0] : contentType) ?? '';
  if (!/^application\/json\b/i.test(v.trim())) throw new HttpError(415, 'Corps attendu en JSON.');
}

/** Taille annoncée par l'en-tête, refusée si elle dépasse la limite (sans rien lire). */
export function checkDeclaredLength(contentLength: string | string[] | undefined, max: number): void {
  const v = Array.isArray(contentLength) ? contentLength[0] : contentLength;
  if (v !== undefined && v !== '' && !(Number(v) <= max)) throw new HttpError(413, 'Requête trop volumineuse.');
}

/** Lit un flux (serveur local, auto-hébergement) en s'arrêtant dès que la limite est dépassée. */
export async function readLimited(stream: AsyncIterable<unknown>, max: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of stream) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(String(c));
    size += b.length;
    if (size > max) throw new HttpError(413, 'Requête trop volumineuse.');
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString();
}
