// GÉNÉRÉ depuis MyLife/packages/sync-client — ne pas modifier ici (MyLife : npm run vendor).
/**
 * Moteur de synchronisation, commun aux apps. L'app fournit un `LocalStore` (Dexie, SQLite…) qui sait
 * lister ses modifications en attente, appliquer celles des autres appareils et tout exporter.
 *
 * - Chaque modification locale est datée ; sur le serveur, la plus récente gagne.
 * - Un appareil ne récupère que ce que les autres ont écrit depuis son dernier passage (curseur).
 * - Rejoindre un compte : s'il est vide, l'appareil y envoie ses données ; sinon l'appareil prend
 *   celles du compte (ou, au choix, les remplace par les siennes). Jamais de fusion de deux historiques
 *   saisis séparément : ce serait la porte ouverte aux doublons.
 */
import { decryptRow, encryptRow, fromB64, type RandomBytes } from './crypto';
import { ApiError, type MyLifeApi, type Session } from './account';

/** `mylife` : réglages communs à toutes les apps (apparence) ; `miniapps` : « Mes apps » et leurs saisies. */
export type AppId = 'finances' | 'perf' | 'mylife' | 'miniapps';

export interface PendingChange {
  tbl: string;
  rid: string;
  /** Compteur de la modification : n'acquitter que si la ligne n'a pas rebougé entre-temps. */
  ver: number;
  updatedAt: number;
  /** null = ligne supprimée. */
  row: unknown | null;
}

export interface RemoteRow {
  tbl: string;
  rid: string;
  deleted: boolean;
  row: unknown | null;
  /** Date de la modification gardée par le serveur (utile pour une suppression, qui n'a pas de contenu). */
  updatedAt?: number;
}

export interface SyncState {
  device: string;
  cursor: number;
  /** Compte (identifiant) auquel cet appareil a été relié pour cette app ; null = pas encore rejoint. */
  joinedAs: string | null;
  lastSyncAt: number | null;
}

export interface LocalStore {
  app: AppId;
  pending(limit: number): Promise<PendingChange[]>;
  ack(done: Pick<PendingChange, 'tbl' | 'rid' | 'ver'>[]): Promise<void>;
  apply(rows: RemoteRow[]): Promise<void>;
  /** Toutes les lignes synchronisées de l'appareil (premier envoi). */
  snapshot(): Promise<{ tbl: string; rid: string; row: unknown }[]>;
  /** Remplace les données synchronisées de l'appareil (rejoindre un compte qui a déjà des données). */
  replace(rows: RemoteRow[]): Promise<void>;
  /** Oublie les modifications en attente (après un envoi complet ou un remplacement). */
  clearPending(): Promise<void>;
  getState(): Promise<SyncState | null>;
  setState(state: SyncState): Promise<void>;
  /**
   * Efface tout ce que l'appareil garde pour un compte : données synchronisées et réglages propres à
   * l'appareil (mot de passe du relais…). Appelé quand un autre compte que celui de ces données se connecte.
   */
  forget?(): Promise<void>;
  /** Modifications envoyées par passage (400 par défaut). */
  batch?: number;
  /**
   * Lignes que le serveur a écartées parce que trop grosses. Elles sont acquittées (pas renvoyées tant
   * qu'elles ne changent pas) et ne bloquent plus les autres ; l'app peut le signaler.
   */
  tooBig?(rows: { tbl: string; rid: string }[]): Promise<void>;
}

interface SyncResponse {
  changes: { tbl: string; rid: string; seq: number; updatedAt: number; deleted: boolean; payload: string | null }[];
  cursor: number;
  more: boolean;
  accepted: number;
  /** Absent avec un serveur plus ancien. */
  tooBig?: { tbl: string; rid: string }[];
  /** Curseur d'avant une purge des traces de suppression : repartir de tout le compte. */
  resync?: boolean;
}

const BATCH = 400;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export async function loadState(store: LocalStore, random: RandomBytes): Promise<SyncState> {
  const s = await store.getState();
  if (s) return s;
  const fresh: SyncState = { device: hex(random(12)), cursor: 0, joinedAs: null, lastSyncAt: null };
  await store.setState(fresh);
  return fresh;
}

function decrypt(dek: Uint8Array, app: AppId, changes: SyncResponse['changes']): RemoteRow[] {
  return changes.map((c) => ({ tbl: c.tbl, rid: c.rid, deleted: c.deleted, updatedAt: c.updatedAt, row: c.deleted || !c.payload ? null : decryptRow(dek, app, c.tbl, c.rid, c.payload) }));
}

/** Ce que contient le compte pour cette app. */
export async function accountStatus(api: MyLifeApi, session: Session, app: AppId): Promise<{ count: number; lastUpdated: number | null }> {
  return api.call('/api/sync', { action: 'status', app }, session.token);
}

/** Envoie toutes les données de l'appareil et en fait celles du compte (remplace ce que le compte avait). */
async function uploadAll(store: LocalStore, api: MyLifeApi, session: Session, state: SyncState, random: RandomBytes): Promise<number> {
  const dek = fromB64(session.dek);
  const rows = await store.snapshot();
  const now = Date.now();
  let cursor = 0;
  for (let i = 0; i === 0 || i < rows.length; i += BATCH) {
    const changes = rows.slice(i, i + BATCH).map((r) => ({ tbl: r.tbl, rid: r.rid, updatedAt: now, deleted: false, payload: encryptRow(dek, store.app, r.tbl, r.rid, r.row, random) }));
    const res = await api.call<SyncResponse>('/api/sync', { action: 'sync', app: store.app, device: state.device, cursor: 0, changes, reset: i === 0 }, session.token);
    cursor = res.cursor;
  }
  await store.clearPending();
  return cursor;
}

/** Récupère toutes les données du compte et remplace celles de l'appareil. */
async function downloadAll(store: LocalStore, api: MyLifeApi, session: Session, state: SyncState): Promise<number> {
  const dek = fromB64(session.dek);
  const all: RemoteRow[] = [];
  let cursor = 0;
  // Appareil « neuf » pour le serveur : on reçoit tout, y compris ce qu'il aurait écrit avant.
  const device = `${state.device}-dl`;
  for (let guard = 0; guard < 500; guard++) {
    const res = await api.call<SyncResponse>('/api/sync', { action: 'sync', app: store.app, device, cursor }, session.token);
    all.push(...decrypt(dek, store.app, res.changes));
    cursor = res.cursor;
    if (!res.more) break;
  }
  await store.replace(all.filter((r) => !r.deleted));
  await store.clearPending();
  return cursor;
}

export type JoinMode = 'auto' | 'useAccount' | 'useDevice';

/**
 * Relie l'appareil au compte pour cette app. `auto` : compte vide → l'appareil l'alimente ;
 * compte non vide → l'appareil prend les données du compte.
 */
export async function join(store: LocalStore, api: MyLifeApi, session: Session, random: RandomBytes, mode: JoinMode = 'auto'): Promise<{ action: 'uploaded' | 'downloaded'; count: number }> {
  const state = await loadState(store, random);
  const status = await accountStatus(api, session, store.app);
  const upload = mode === 'useDevice' || (mode === 'auto' && status.count === 0);
  const cursor = upload ? await uploadAll(store, api, session, state, random) : await downloadAll(store, api, session, state);
  await store.setState({ ...state, cursor, joinedAs: session.login, lastSyncAt: Date.now() });
  return { action: upload ? 'uploaded' : 'downloaded', count: upload ? (await store.snapshot()).length : status.count };
}

export type AutoJoin = { action: 'uploaded' | 'downloaded'; count: number } | { action: 'ask'; account: number; lastUpdated: number | null };

/**
 * Relie l'appareil sans rien demander quand c'est sans ambiguïté, comme une app ordinaire après la
 * connexion :
 * - données d'un **autre compte** (déconnecté de cet appareil) : effacées, jamais envoyées dans celui-ci ni
 *   montrées ; l'appareil prend ce que contient le compte (rien pour un compte neuf) ;
 * - appareil sans données saisies (`deviceHasData` faux : app neuve, seulement des valeurs par défaut) :
 *   il prend celles du compte, ou y envoie ses valeurs par défaut si le compte est neuf ;
 * - sinon (données saisies avant tout compte) : `ask`, l'utilisateur choisit (jamais de fusion). Avec un
 *   compte vide (`account` 0), le choix est « partir de zéro » ou « y mettre ces données ».
 */
export async function autoJoin(store: LocalStore, api: MyLifeApi, session: Session, random: RandomBytes, deviceHasData: () => Promise<boolean>): Promise<AutoJoin> {
  const state = await loadState(store, random);
  const status = await accountStatus(api, session, store.app);
  if (state.joinedAs !== null && state.joinedAs !== session.login) {
    await store.forget?.();
    return join(store, api, session, random, 'useAccount');
  }
  if (!(await deviceHasData())) return join(store, api, session, random, status.count === 0 ? 'useDevice' : 'useAccount');
  return { action: 'ask', account: status.count, lastUpdated: status.lastUpdated };
}

/** Un passage de synchro : envoie les modifications locales, applique celles des autres appareils. */
export async function syncNow(store: LocalStore, api: MyLifeApi, session: Session, random: RandomBytes): Promise<{ pushed: number; pulled: number }> {
  let state = await loadState(store, random);
  if (state.joinedAs !== session.login) throw new ApiError(409, 'Appareil pas encore relié à ce compte.');
  const dek = fromB64(session.dek);
  let pushed = 0;
  let pulled = 0;
  const batch = store.batch ?? BATCH;
  for (let guard = 0; guard < 200; guard++) {
    const pending = await store.pending(batch);
    const changes = pending.map((p) => ({
      tbl: p.tbl,
      rid: p.rid,
      updatedAt: p.updatedAt,
      deleted: p.row === null,
      payload: p.row === null ? null : encryptRow(dek, store.app, p.tbl, p.rid, p.row, random),
    }));
    const res = await api.call<SyncResponse>('/api/sync', { action: 'sync', app: store.app, device: state.device, cursor: state.cursor, changes }, session.token);
    if (pending.length) await store.ack(pending);
    if (res.tooBig?.length) await store.tooBig?.(res.tooBig);
    if (res.resync) {
      // Absent plus longtemps que les traces de suppression ne sont gardées : toutes ses modifications partent
      // d'abord, puis il reprend tout le contenu du compte (ce qui a été supprimé ailleurs disparaît).
      for (let more = 0; more < 200; more++) {
        const rest = await store.pending(batch);
        if (!rest.length) break;
        const changes = rest.map((p) => ({ tbl: p.tbl, rid: p.rid, updatedAt: p.updatedAt, deleted: p.row === null, payload: p.row === null ? null : encryptRow(dek, store.app, p.tbl, p.rid, p.row, random) }));
        const r = await api.call<SyncResponse>('/api/sync', { action: 'sync', app: store.app, device: state.device, cursor: state.cursor, changes }, session.token);
        await store.ack(rest);
        if (r.tooBig?.length) await store.tooBig?.(r.tooBig);
        pushed += rest.length;
      }
      const cursor = await downloadAll(store, api, session, state);
      await store.setState({ ...state, cursor, lastSyncAt: Date.now() });
      return { pushed: pushed + pending.length, pulled: -1 };
    }
    if (res.changes.length) await store.apply(decrypt(dek, store.app, res.changes));
    pushed += pending.length;
    pulled += res.changes.length;
    state = { ...state, cursor: res.cursor, lastSyncAt: Date.now() };
    await store.setState(state);
    if (!res.more && pending.length < batch) break;
  }
  return { pushed, pulled };
}
