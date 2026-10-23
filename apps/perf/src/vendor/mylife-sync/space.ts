// GÉNÉRÉ depuis MyLife/packages/sync-client — ne pas modifier ici (MyLife : npm run vendor).
import { ApiError, type MyLifeApi, type Session } from './account';
import { decryptRow, encryptRow, fromB64, toB64, type RandomBytes } from './crypto';

/**
 * Espaces partagés, côté appareil : la brique des fonctions « à plusieurs » (Crew, Sortie, Pacte…).
 * Serveur : server/space.ts (POST /api/space).
 *
 * - Chaque espace a une clé aléatoire de 256 bits, créée par l'appareil du créateur, qui voyage entre
 *   amis dans le fragment `#` du lien d'invitation (jamais envoyé au serveur) et que chaque membre range
 *   sur le serveur emballée par SA clé de données MyLife.
 * - Nom, pseudos et lignes sont chiffrés avec elle, liés à leur emplacement (espace, table, ligne) :
 *   le serveur ne peut ni les lire, ni les déplacer.
 */

const APP = 'space';

export type SpaceKind = 'crew' | 'sortie' | 'pacte' | 'liste';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const newSpaceId = (random: RandomBytes) => hex(random(16));
export const newSpaceKey = (random: RandomBytes) => random(32);

export const wrapSpaceKey = (dek: Uint8Array, sid: string, key: Uint8Array, random: RandomBytes) => encryptRow(dek, APP, 'key', sid, toB64(key), random);

export function unwrapSpaceKey(dek: Uint8Array, sid: string, wrapped: string): Uint8Array {
  const b64 = decryptRow(dek, APP, 'key', sid, wrapped);
  if (typeof b64 !== 'string') throw new Error('Clé d’espace illisible');
  const key = fromB64(b64);
  if (key.length !== 32) throw new Error('Clé d’espace illisible');
  return key;
}

export const sealSpaceName = (key: Uint8Array, sid: string, name: string, random: RandomBytes) => encryptRow(key, APP, 'name', sid, { name }, random);
export function openSpaceName(key: Uint8Array, sid: string, sealed: string): string {
  try {
    const v = decryptRow(key, APP, 'name', sid, sealed) as { name?: unknown };
    return typeof v?.name === 'string' ? v.name : '';
  } catch {
    return '';
  }
}

export const sealProfile = (key: Uint8Array, sid: string, uid: string, pseudo: string, random: RandomBytes) => encryptRow(key, APP, 'member', `${sid}/${uid}`, { pseudo }, random);
export function openProfile(key: Uint8Array, sid: string, uid: string, sealed: string): string {
  try {
    const v = decryptRow(key, APP, 'member', `${sid}/${uid}`, sealed) as { pseudo?: unknown };
    return typeof v?.pseudo === 'string' ? v.pseudo : '';
  } catch {
    return '';
  }
}

export const sealRecord = (key: Uint8Array, sid: string, tbl: string, rid: string, row: unknown, random: RandomBytes) => encryptRow(key, APP, `${sid}/${tbl}`, rid, row, random);
export function openRecord(key: Uint8Array, sid: string, tbl: string, rid: string, payload: string): unknown {
  try {
    return decryptRow(key, APP, `${sid}/${tbl}`, rid, payload);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- lien d'invitation

const b64url = (b: Uint8Array) => toB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

/** `…/crew/rejoindre#espace=<jeton>.<clé>` : jeton (vérifié par le serveur) + clé (jamais envoyée). */
export function spaceInviteLink(url: string, token: string, key: Uint8Array): string {
  return `${url}#espace=${token}.${b64url(key)}`;
}

export function parseSpaceInvite(text: string): { token: string; key: Uint8Array } | null {
  const m = /espace=([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(text);
  if (!m) return null;
  try {
    const key = fromB64url(m[2]!);
    return key.length === 32 ? { token: m[1]!, key } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- appels

export interface Space {
  id: string;
  kind: SpaceKind;
  name: string;
  role: 'admin' | 'member';
  members: number;
  key: Uint8Array;
}

export interface SpaceMember {
  uid: string;
  role: 'admin' | 'member';
  pseudo: string;
  joinedAt: number;
  lastSeen: number;
}

export interface SpaceRecord<T = unknown> {
  tbl: string;
  rid: string;
  author: string;
  open: boolean;
  updatedAt: number;
  row: T;
}

interface RawSpace {
  id: string;
  kind: string;
  name: string;
  role: string;
  wrappedKey: string;
  members: number;
}

/** Les appels de l'espace, liés à une session (jeton + clé de données). */
export class SpaceClient {
  constructor(
    private api: MyLifeApi,
    private session: Session,
    private random: RandomBytes,
  ) {}

  private call<T>(body: Record<string, unknown>): Promise<T> {
    return this.api.call<T>('/api/space', body, this.session.token);
  }

  private get dek() {
    return fromB64(this.session.dek);
  }

  /** Mes espaces (clés déballées, noms déchiffrés) et mon identifiant de compte. */
  async list(): Promise<{ uid: string; spaces: Space[] }> {
    const r = await this.call<{ uid: string; spaces: RawSpace[] }>({ action: 'spaces' });
    const spaces: Space[] = [];
    for (const s of r.spaces) {
      try {
        const key = unwrapSpaceKey(this.dek, s.id, s.wrappedKey);
        spaces.push({ id: s.id, kind: s.kind as SpaceKind, name: openSpaceName(key, s.id, s.name), role: s.role === 'admin' ? 'admin' : 'member', members: s.members, key });
      } catch {
        /* clé illisible (autre compte ?) : espace ignoré */
      }
    }
    return { uid: r.uid, spaces };
  }

  async create(kind: SpaceKind, name: string, pseudo: string, uid: string): Promise<Space> {
    const id = newSpaceId(this.random);
    const key = newSpaceKey(this.random);
    await this.call({ action: 'create', id, kind, name: sealSpaceName(key, id, name, this.random), profile: sealProfile(key, id, uid, pseudo, this.random), wrappedKey: wrapSpaceKey(this.dek, id, key, this.random) });
    return { id, kind, name, role: 'admin', members: 1, key };
  }

  async invite(space: Space, url: string, opts: { ttlMs?: number; maxUses?: number } = {}): Promise<{ link: string; expiresAt: number }> {
    const r = await this.call<{ token: string; expiresAt: number }>({ action: 'invite', sid: space.id, ...opts });
    return { link: spaceInviteLink(url, r.token, space.key), expiresAt: r.expiresAt };
  }

  /** Avant de rejoindre : le nom de l'espace (déchiffré avec la clé du lien) et si on en fait déjà partie. */
  async peek(invite: { token: string; key: Uint8Array }): Promise<{ sid: string; kind: SpaceKind; name: string; member: boolean }> {
    const r = await this.call<{ sid: string; kind: string; name: string; member: boolean }>({ action: 'peek', token: invite.token });
    const name = openSpaceName(invite.key, r.sid, r.name);
    if (!name) throw new ApiError(400, 'Ce lien est abîmé : demande-le à nouveau.');
    return { sid: r.sid, kind: r.kind as SpaceKind, name, member: r.member };
  }

  async join(invite: { token: string; key: Uint8Array }, sid: string, pseudo: string, uid: string): Promise<{ sid: string; already: boolean }> {
    return this.call({ action: 'join', token: invite.token, profile: sealProfile(invite.key, sid, uid, pseudo, this.random), wrappedKey: wrapSpaceKey(this.dek, sid, invite.key, this.random) });
  }

  async members(space: Space): Promise<SpaceMember[]> {
    const r = await this.call<{ members: { uid: string; role: string; profile: string; joinedAt: number; lastSeen: number }[] }>({ action: 'members', sid: space.id });
    return r.members.map((m) => ({ uid: m.uid, role: m.role === 'admin' ? 'admin' : 'member', pseudo: openProfile(space.key, space.id, m.uid, m.profile) || 'Membre', joinedAt: m.joinedAt, lastSeen: m.lastSeen }));
  }

  setPseudo(space: Space, uid: string, pseudo: string): Promise<unknown> {
    return this.call({ action: 'profile', sid: space.id, profile: sealProfile(space.key, space.id, uid, pseudo, this.random) });
  }

  leave(space: Space): Promise<unknown> {
    return this.call({ action: 'leave', sid: space.id });
  }

  remove(space: Space, uid: string): Promise<unknown> {
    return this.call({ action: 'remove', sid: space.id, uid });
  }

  rename(space: Space, name: string): Promise<unknown> {
    return this.call({ action: 'rename', sid: space.id, name: sealSpaceName(space.key, space.id, name, this.random) });
  }

  /**
   * Envoie des lignes (chiffrées ici) et récupère tout ce qui a changé depuis `cursor` (déchiffré).
   * Les lignes illisibles sont ignorées ; les écritures refusées par le serveur sont renvoyées.
   */
  async sync(
    space: Space,
    cursor: number,
    changes: { tbl: string; rid: string; row: unknown | null; open?: boolean }[] = [],
  ): Promise<{ records: SpaceRecord[]; deleted: { tbl: string; rid: string }[]; cursor: number; refused: { tbl: string; rid: string }[] }> {
    const records: SpaceRecord[] = [];
    const deleted: { tbl: string; rid: string }[] = [];
    let refused: { tbl: string; rid: string }[] = [];
    let first = true;
    for (let guard = 0; guard < 50; guard++) {
      const r = await this.call<{ changes: { tbl: string; rid: string; author: string; open: boolean; updatedAt: number; deleted: boolean; payload: string | null }[]; cursor: number; more: boolean; refused: { tbl: string; rid: string }[] }>({
        action: 'sync',
        sid: space.id,
        cursor,
        changes: first ? changes.map((c) => ({ tbl: c.tbl, rid: c.rid, deleted: c.row === null, open: c.open === true, ...(c.row === null ? {} : { payload: sealRecord(space.key, space.id, c.tbl, c.rid, c.row, this.random) }) })) : [],
      });
      if (first) refused = r.refused;
      first = false;
      for (const c of r.changes) {
        if (c.deleted || !c.payload) deleted.push({ tbl: c.tbl, rid: c.rid });
        else {
          const row = openRecord(space.key, space.id, c.tbl, c.rid, c.payload);
          if (row !== null) records.push({ tbl: c.tbl, rid: c.rid, author: c.author, open: c.open, updatedAt: c.updatedAt, row });
        }
      }
      cursor = r.cursor;
      if (!r.more) break;
    }
    return { records, deleted, cursor, refused };
  }
}
