/**
 * État de l'app et échanges avec le serveur.
 *
 * Une seule boucle d'échange : le groupe affiché (toutes les 4 s pendant la navigation, 10 s sur le
 * groupe, 30 s ailleurs) et, en plus, les groupes où je partage (30 s). Chaque échange envoie ma
 * position si elle a changé (ou pour un signe de vie) et rapporte celles des amis. Rien quand l'app
 * est cachée ou hors ligne ; reprise immédiate au retour.
 */
import { ApiError, createApi, type GroupSummary, type InviteInfo, type MemberView, type PollResult } from '../lib/api';
import { inviteLink, newGroupId, newGroupKey, openName, openPosition, openProfile, sealName, sealPosition, sealProfile, unwrapGroupKey, wrapGroupKey } from '../lib/groupCrypto';
import { observable } from '../lib/observable';
import { currentSession, onSessionChange, platform, uidOf } from '../lib/session';
import { heartbeatMs, pollDelay, shouldSend, type FriendFix, type Screen, type SentFix, type Sharing } from '../domain/status';
import { location, needLocation } from '../services/location';
import { fromB64, signOut as mylifeSignOut, type Session } from '../vendor/mylife-sync';

export interface Group {
  id: string;
  /** Nom déchiffré ; null si la clé manque ou ne convient pas. */
  name: string | null;
  role: 'admin' | 'member';
  expiresAt: number;
  members: number;
  sharing: Sharing;
  shareUntil: number | null;
}

export interface Member {
  uid: string;
  name: string | null;
  role: 'admin' | 'member';
  me: boolean;
  sharing: Sharing;
  shareUntil: number | null;
  /** Dernière requête du membre (notre horloge, ms). */
  seenAt: number;
  fix: FriendFix | null;
  /** Position reçue mais illisible (clé différente, données abîmées) : on le dit au lieu de l'ignorer. */
  unreadable: boolean;
}

export interface Live {
  gid: string;
  status: 'loading' | 'ready' | 'error';
  members: Member[];
  name: string | null;
  expiresAt: number | null;
  /** Instant (notre horloge) du dernier échange réussi pour ce groupe. */
  syncedAt: number | null;
  error: string | null;
}

export interface Net {
  /** Le navigateur se dit connecté (événements online/offline). */
  online: boolean;
  /** Le dernier échange a échoué faute de réseau (connecté sans Internet, coupure) : on réessaie en espaçant. */
  unreachable: boolean;
  /** Dernier échange réussi (n'importe quel groupe). */
  okAt: number | null;
  failures: number;
  error: string | null;
  /** Le serveur ne répond plus du tout ou répond en erreur. */
  serverDown: boolean;
}

export interface Transmission {
  /** Dernière position acceptée par le serveur (notre horloge). */
  sentAt: number | null;
  /** Raison pour laquelle rien ne part, si c'est le cas. */
  blocked: string | null;
}

export interface AppState {
  session: Session | null;
  uid: string | null;
  sessionExpired: boolean;
  groups: { status: 'idle' | 'loading' | 'ready' | 'error'; list: Group[]; error: string | null; cached: boolean };
  activeId: string | null;
  screen: Screen;
  live: Live | null;
  net: Net;
  transmission: Record<string, Transmission>;
}

const ACTIVE_KEY = 'raveloc:active';
const cacheKey = (uid: string) => `raveloc:groups:${uid}`;

const initialSession = typeof localStorage === 'undefined' ? null : currentSession();

export const app = observable<AppState>({
  session: initialSession,
  uid: uidOf(initialSession),
  sessionExpired: false,
  groups: { status: 'idle', list: [], error: null, cached: false },
  activeId: readLocal(ACTIVE_KEY),
  screen: 'list',
  live: null,
  net: { online: typeof navigator === 'undefined' ? true : navigator.onLine, unreachable: false, okAt: null, failures: 0, error: null, serverDown: false },
  transmission: {},
});

export const api = createApi(() => app.get().session?.token ?? null);

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible */
  }
}

// ---------------------------------------------------------------- clés de groupe

const keys = new Map<string, Uint8Array>();
const wrapped = new Map<string, string>();

function groupKey(gid: string): Uint8Array | null {
  const k = keys.get(gid);
  if (k) return k;
  const session = app.get().session;
  const w = wrapped.get(gid);
  if (!session || !w) return null;
  try {
    const key = unwrapGroupKey(fromB64(session.dek), gid, w);
    keys.set(gid, key);
    return key;
  } catch {
    return null;
  }
}

function toGroup(g: GroupSummary): Group {
  wrapped.set(g.id, g.wrappedKey);
  const key = groupKey(g.id);
  let name: string | null = null;
  if (key) {
    try {
      name = openName(key, g.id, g.name) || null;
    } catch {
      name = null;
    }
  }
  return { id: g.id, name, role: g.role, expiresAt: g.expiresAt, members: g.members, sharing: g.sharing, shareUntil: g.shareUntil };
}

// ---------------------------------------------------------------- erreurs réseau

function onFailure(e: unknown): string {
  const err = e instanceof ApiError ? e : new ApiError(500, e instanceof Error ? e.message : String(e));
  if (err.status === 401) {
    app.set({ sessionExpired: true });
    stopLoop();
  }
  app.set((s) => ({ ...s, net: { ...s.net, unreachable: err.status === 0, failures: s.net.failures + 1, error: err.message, serverDown: err.status >= 500 } }));
  return err.message;
}

function onSuccess() {
  app.set((s) => ({ ...s, net: { online: true, unreachable: false, okAt: Date.now(), failures: 0, error: null, serverDown: false } }));
}

// ---------------------------------------------------------------- groupes

let groupsReq = 0;

export async function loadGroups(): Promise<void> {
  const { uid, session } = app.get();
  if (!session || !uid) return;
  const req = ++groupsReq;
  if (app.get().groups.status === 'idle') {
    const cached = readLocal(cacheKey(uid));
    if (cached) {
      try {
        const list = (JSON.parse(cached) as GroupSummary[]).filter((g) => g.expiresAt > Date.now()).map(toGroup);
        app.set((s) => ({ ...s, groups: { status: 'ready', list, error: null, cached: true } }));
      } catch {
        /* cache abîmé : ignoré */
      }
    }
  }
  if (app.get().groups.status !== 'ready') app.set((s) => ({ ...s, groups: { ...s.groups, status: 'loading', error: null } }));
  try {
    const r = await api.groups();
    if (req !== groupsReq) return;
    onSuccess();
    writeLocal(cacheKey(uid), JSON.stringify(r.groups));
    const list = r.groups.map(toGroup);
    app.set((s) => ({ ...s, groups: { status: 'ready', list, error: null, cached: false } }));
    const active = app.get().activeId;
    if (!active || !list.some((g) => g.id === active)) setActive(list[0]?.id ?? null);
    syncLocationNeeds();
    schedule(0);
  } catch (e) {
    if (req !== groupsReq) return;
    const msg = onFailure(e);
    app.set((s) => ({ ...s, groups: { ...s.groups, status: s.groups.list.length || s.groups.cached ? 'ready' : 'error', error: msg } }));
  }
}

export function setActive(gid: string | null): void {
  writeLocal(ACTIVE_KEY, gid);
  const prev = app.get().live;
  app.set({ activeId: gid, live: gid ? (prev?.gid === gid ? prev : { gid, status: 'loading', members: [], name: nameOf(gid), expiresAt: null, syncedAt: null, error: null }) : null });
  schedule(0);
}

const nameOf = (gid: string) => app.get().groups.list.find((g) => g.id === gid)?.name ?? null;

function patchGroup(gid: string, patch: Partial<Group>) {
  app.set((s) => ({ ...s, groups: { ...s.groups, list: s.groups.list.map((g) => (g.id === gid ? { ...g, ...patch } : g)) } }));
}

function dropGroup(gid: string) {
  keys.delete(gid);
  wrapped.delete(gid);
  lastSent.delete(gid);
  app.set((s) => {
    const list = s.groups.list.filter((g) => g.id !== gid);
    const { [gid]: _gone, ...transmission } = s.transmission;
    return { ...s, groups: { ...s.groups, list }, transmission, live: s.live?.gid === gid ? null : s.live };
  });
  const uid = app.get().uid;
  if (uid) {
    const cached = readLocal(cacheKey(uid));
    try {
      if (cached) writeLocal(cacheKey(uid), JSON.stringify((JSON.parse(cached) as GroupSummary[]).filter((g) => g.id !== gid)));
    } catch {
      writeLocal(cacheKey(uid), null);
    }
  }
  if (app.get().activeId === gid) setActive(app.get().groups.list[0]?.id ?? null);
  syncLocationNeeds();
}

export const GROUP_DURATIONS = [
  { label: 'Ce soir', hint: '12 h', ms: 12 * 3_600_000 },
  { label: '24 h', hint: '1 jour', ms: 24 * 3_600_000 },
  { label: 'Week-end', hint: '3 jours', ms: 3 * 86_400_000 },
  { label: 'Semaine', hint: '7 jours', ms: 7 * 86_400_000 },
] as const;

export async function createGroup(input: { name: string; pseudo: string; durationMs: number }): Promise<string> {
  const { session, uid } = app.get();
  if (!session || !uid) throw new ApiError(401, 'Session expirée : reconnecte-toi.');
  const gid = newGroupId();
  const key = newGroupKey();
  await api.create({
    gid,
    name: sealName(key, gid, input.name.trim()),
    profile: sealProfile(key, gid, uid, input.pseudo.trim()),
    wrappedKey: wrapGroupKey(fromB64(session.dek), gid, key),
    durationMs: input.durationMs,
  });
  keys.set(gid, key);
  rememberPseudo(input.pseudo);
  await loadGroups();
  setActive(gid);
  return gid;
}

export async function leaveGroup(gid: string): Promise<void> {
  await api.leave({ gid });
  dropGroup(gid);
}

export async function deleteGroup(gid: string): Promise<void> {
  await api.delete({ gid });
  dropGroup(gid);
}

export async function removeMember(gid: string, uid: string): Promise<void> {
  await api.remove({ gid, uid });
  await pollNow(gid);
}

export async function setRole(gid: string, uid: string, role: 'admin' | 'member'): Promise<void> {
  await api.role({ gid, uid, role });
  await pollNow(gid);
  await loadGroups();
}

export async function renameMe(gid: string, pseudo: string): Promise<void> {
  const { uid } = app.get();
  const key = groupKey(gid);
  if (!uid || !key) throw new Error('Clé du groupe indisponible.');
  await api.profile({ gid, profile: sealProfile(key, gid, uid, pseudo.trim()) });
  rememberPseudo(pseudo);
  await pollNow(gid);
}

// ---------------------------------------------------------------- invitations

export function appUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

export async function createInvite(gid: string, ttlMs: number, maxUses: number | null): Promise<{ link: string; invite: InviteInfo }> {
  const key = groupKey(gid);
  if (!key) throw new Error('Clé du groupe indisponible sur cet appareil.');
  const r = await api.invite({ gid, ttlMs, maxUses });
  return { link: inviteLink(appUrl(), r.token, key), invite: r.invite };
}

export async function previewInvite(token: string, key: Uint8Array): Promise<{ gid: string; name: string | null; expiresAt: number; member: boolean }> {
  const r = await api.peek({ token });
  let name: string | null = null;
  try {
    name = openName(key, r.gid, r.name) || null;
  } catch {
    name = null;
  }
  return { ...r, name };
}

export async function joinGroup(token: string, key: Uint8Array, gid: string, pseudo: string): Promise<void> {
  const { session, uid } = app.get();
  if (!session || !uid) throw new ApiError(401, 'Session expirée : reconnecte-toi.');
  const r = await api.join({ token, profile: sealProfile(key, gid, uid, pseudo.trim()), wrappedKey: wrapGroupKey(fromB64(session.dek), gid, key) });
  if (r.gid !== gid) throw new Error('Invitation incohérente.');
  if (!r.already) keys.set(gid, key);
  rememberPseudo(pseudo);
  await loadGroups();
  setActive(gid);
}

// ---------------------------------------------------------------- partage

export const SHARE_DURATIONS = [
  { label: '1 h', ms: 3_600_000 },
  { label: '3 h', ms: 3 * 3_600_000 },
  { label: '8 h', ms: 8 * 3_600_000 },
  { label: 'Jusqu’à la fin du groupe', ms: null },
] as const;

export async function share(gid: string, mode: Sharing, durationMs?: number | null): Promise<void> {
  const g = app.get().groups.list.find((x) => x.id === gid);
  const until = mode === 'on' ? (durationMs ? Date.now() + durationMs : (g?.expiresAt ?? Date.now() + 3_600_000)) : undefined;
  const r = await api.share({ gid, mode, until });
  patchGroup(gid, { sharing: r.sharing, shareUntil: r.shareUntil });
  if (r.sharing !== 'on') lastSent.delete(gid);
  syncLocationNeeds();
  await pollNow(gid);
}

/** Reprendre après une pause : même échéance qu'avant. */
export async function resume(gid: string): Promise<void> {
  const g = app.get().groups.list.find((x) => x.id === gid);
  if (!g?.shareUntil) return share(gid, 'on', null);
  await share(gid, 'on', Math.max(5 * 60_000 + 1000, g.shareUntil - Date.now()));
}

const releases = new Map<string, () => void>();

/** GPS allumé tant qu'un groupe partage (et que l'app est visible : voir services/location). */
function syncLocationNeeds() {
  const sharing = new Set(app.get().groups.list.filter((g) => g.sharing === 'on' && (g.shareUntil ?? 0) > Date.now()).map((g) => g.id));
  for (const [gid, release] of releases) {
    if (!sharing.has(gid)) {
      release();
      releases.delete(gid);
    }
  }
  for (const gid of sharing) if (!releases.has(gid)) releases.set(gid, needLocation(`share:${gid}`, 'share'));
}

// ---------------------------------------------------------------- boucle d'échange

const lastSent = new Map<string, SentFix>();
const lastPollAt = new Map<string, number>();
const inflight = new Set<string>();
const reqSeq = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

/** Groupes à échanger et leur rythme. */
function targets(): { gid: string; every: number }[] {
  const s = app.get();
  const base = pollDelay({ screen: s.screen, visible: visible(), online: s.net.online, failures: s.net.failures });
  if (base == null || !s.session || s.sessionExpired) return [];
  const out = new Map<string, number>();
  if (s.activeId) out.set(s.activeId, base);
  const slow = pollDelay({ screen: 'list', visible: true, online: true, failures: s.net.failures })!;
  for (const g of s.groups.list) if (g.sharing === 'on' && !out.has(g.id)) out.set(g.id, slow);
  return [...out].map(([gid, every]) => ({ gid, every }));
}

function schedule(delay?: number) {
  if (!running) return;
  if (timer) clearTimeout(timer);
  timer = null;
  const t = targets();
  if (!t.length) return;
  const now = Date.now();
  const next = delay ?? Math.max(0, Math.min(...t.map(({ gid, every }) => (lastPollAt.get(gid) ?? 0) + every - now)));
  timer = setTimeout(tick, next);
}

async function tick() {
  timer = null;
  const now = Date.now();
  const due = targets().filter(({ gid, every }) => now - (lastPollAt.get(gid) ?? 0) >= every - 250);
  await Promise.all(due.map(({ gid }) => pollNow(gid)));
  schedule();
}

/** Position à envoyer pour ce groupe maintenant, ou null. */
function outgoing(gid: string): { payload: string; clientAt: number; sent: SentFix } | null {
  const s = app.get();
  const g = s.groups.list.find((x) => x.id === gid);
  const loc = location.get();
  const key = groupKey(gid);
  if (!g || g.sharing !== 'on' || !s.uid || !key) return null;
  if (loc.status !== 'ok' || !loc.fix) return null;
  const now = Date.now();
  const fix = loc.fix;
  const screen = s.activeId === gid ? s.screen : 'list';
  if (!shouldSend(lastSent.get(gid) ?? null, fix, now, { heartbeatMs: heartbeatMs(screen), minMoveM: 8 })) return null;
  return {
    payload: sealPosition(key, gid, s.uid, { lat: fix.lat, lon: fix.lon, acc: fix.acc, age: now - fix.at }),
    clientAt: now,
    sent: { lat: fix.lat, lon: fix.lon, acc: fix.acc, sentAt: now },
  };
}

export async function pollNow(gid: string): Promise<void> {
  if (inflight.has(gid) || !app.get().session) return;
  inflight.add(gid);
  lastPollAt.set(gid, Date.now());
  const seq = (reqSeq.get(gid) ?? 0) + 1;
  reqSeq.set(gid, seq);
  const out = outgoing(gid);
  try {
    const r = await api.poll({ gid, ...(out ? { position: { payload: out.payload, clientAt: out.clientAt } } : {}) });
    onSuccess();
    if (out && r.accepted) {
      lastSent.set(gid, out.sent);
      setTransmission(gid, { sentAt: Date.now(), blocked: null });
    } else setTransmission(gid, { sentAt: app.get().transmission[gid]?.sentAt ?? null, blocked: blockedReason(gid) });
    // Réponse plus ancienne qu'une autre déjà appliquée (réseau qui livre dans le désordre) : ignorée.
    if (seq === reqSeq.get(gid)) applyPoll(gid, r);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      dropGroup(gid);
      app.set((s) => ({ ...s, groups: { ...s.groups, error: e.message } }));
    } else {
      if (e instanceof ApiError && e.status === 409) void loadGroups();
      const msg = onFailure(e);
      app.set((s) => (s.live?.gid === gid ? { ...s, live: { ...s.live, status: s.live.syncedAt ? 'ready' : 'error', error: msg } } : s));
    }
  } finally {
    inflight.delete(gid);
  }
}

function blockedReason(gid: string): string | null {
  const g = app.get().groups.list.find((x) => x.id === gid);
  if (!g || g.sharing !== 'on') return null;
  const loc = location.get();
  if (loc.status === 'denied') return 'Localisation refusée : ta position n’est pas transmise.';
  if (loc.status === 'insecure' || loc.status === 'unavailable') return loc.error ?? 'Localisation indisponible.';
  if (loc.status !== 'ok') return 'En attente du GPS…';
  return null;
}

function setTransmission(gid: string, t: Transmission) {
  const cur = app.get().transmission[gid];
  if (cur && cur.sentAt === t.sentAt && cur.blocked === t.blocked) return;
  app.set((s) => ({ ...s, transmission: { ...s.transmission, [gid]: t } }));
}

function applyPoll(gid: string, r: PollResult) {
  const s = app.get();
  const key = groupKey(gid);
  const receivedAt = Date.now();
  const members: Member[] = r.members.map((m: MemberView) => {
    let name: string | null = null;
    let fix: FriendFix | null = null;
    let unreadable = false;
    if (key) {
      try {
        name = openProfile(key, gid, m.uid, m.profile) || null;
      } catch {
        name = null;
      }
      if (m.position) {
        try {
          const p = openPosition(key, gid, m.uid, m.position.payload);
          if (p) fix = { lat: p.lat, lon: p.lon, acc: p.acc, ageAtReceipt: p.age + m.position.age, receivedAt };
          else unreadable = true;
        } catch {
          unreadable = true;
        }
      }
    } else unreadable = !!m.position;
    return { uid: m.uid, name, role: m.role, me: m.uid === s.uid, sharing: m.sharing, shareUntil: m.shareUntil, seenAt: receivedAt - m.seenAgo, fix, unreadable };
  });
  const mine = members.find((m) => m.me);
  if (mine) {
    const g = s.groups.list.find((x) => x.id === gid);
    if (g && (g.sharing !== mine.sharing || g.shareUntil !== mine.shareUntil || g.members !== members.length || g.role !== mine.role)) {
      patchGroup(gid, { sharing: mine.sharing, shareUntil: mine.shareUntil, members: members.length, role: mine.role });
      syncLocationNeeds();
    }
  }
  rememberFriends(gid, members);
  if (s.activeId === gid) {
    let name: string | null = null;
    try {
      name = key ? openName(key, gid, r.group.name) || null : null;
    } catch {
      name = null;
    }
    app.set({ live: { gid, status: 'ready', members, name, expiresAt: r.group.expiresAt, syncedAt: receivedAt, error: null } });
  }
}

export function setScreen(screen: Screen): void {
  if (app.get().screen === screen) return;
  app.set({ screen });
  // Passer sur la navigation : on veut des nouvelles tout de suite.
  schedule(screen === 'navigate' ? 0 : undefined);
}

function stopLoop() {
  if (timer) clearTimeout(timer);
  timer = null;
}

// Nouvelle position : si elle mérite d'être envoyée, pas besoin d'attendre le prochain tour.
location.subscribe(() => {
  const s = app.get();
  for (const g of s.groups.list) {
    if (g.sharing !== 'on' || inflight.has(g.id)) continue;
    if (Date.now() - (lastPollAt.get(g.id) ?? 0) < 3000) continue;
    if (outgoing(g.id)) void pollNow(g.id);
  }
  for (const g of s.groups.list) {
    const reason = blockedReason(g.id);
    if (g.sharing === 'on') setTransmission(g.id, { sentAt: s.transmission[g.id]?.sentAt ?? null, blocked: reason });
  }
});

// ---------------------------------------------------------------- démarrage, session, réseau

export function start(): () => void {
  running = true;
  const onVisible = () => {
    if (visible()) schedule(0);
    else stopLoop();
  };
  const onOnline = () => {
    app.set((s) => ({ ...s, net: { ...s.net, online: true, failures: 0 } }));
    void loadGroups();
    schedule(0);
  };
  const onOffline = () => {
    app.set((s) => ({ ...s, net: { ...s.net, online: false } }));
    stopLoop();
  };
  const offSession = onSessionChange(() => {
    const session = currentSession();
    const uid = uidOf(session);
    if (uid !== app.get().uid) {
      keys.clear();
      wrapped.clear();
      lastSent.clear();
      app.set((s) => ({ ...s, groups: { status: 'idle', list: [], error: null, cached: false }, live: null, transmission: {} }));
    }
    app.set({ session, uid, sessionExpired: false });
    syncLocationNeeds();
    if (session) void loadGroups();
  });
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  void loadGroups();
  return () => {
    running = false;
    stopLoop();
    offSession();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

/** Avant de quitter le compte (déconnexion, suppression) : le partage s'arrête d'abord partout. */
export async function stopAllSharing(): Promise<void> {
  const sharing = app.get().groups.list.filter((g) => g.sharing !== 'off');
  await Promise.allSettled(sharing.map((g) => api.share({ gid: g.id, mode: 'off' })));
  for (const release of releases.values()) release();
  releases.clear();
}

/** Déconnexion de MyLife (toutes les apps de l'adresse) : le partage s'arrête d'abord partout. */
export async function signOut(): Promise<void> {
  await stopAllSharing();
  await mylifeSignOut(platform);
}

// ---------------------------------------------------------------- pseudo et habitués (sur l'appareil)

const PSEUDO_KEY = 'raveloc:pseudo';
export const lastPseudo = () => readLocal(PSEUDO_KEY);
const rememberPseudo = (p: string) => writeLocal(PSEUDO_KEY, p.trim());

export interface Regular {
  uid: string;
  name: string;
  groups: string[];
  lastAt: number;
}

const regularsKey = () => `raveloc:regulars:${app.get().uid ?? ''}`;

/**
 * Habitués : les personnes croisées dans mes groupes, gardées sur CET appareil seulement (jamais
 * envoyées). Ne donne aucun droit : voir une position exige toujours d'être dans le même groupe et
 * que la personne partage.
 */
export function regulars(): Regular[] {
  try {
    const all = JSON.parse(readLocal(regularsKey()) ?? '[]') as Regular[];
    return all.sort((a, b) => b.groups.length - a.groups.length || b.lastAt - a.lastAt);
  } catch {
    return [];
  }
}

function rememberFriends(gid: string, members: Member[]) {
  const known = new Map(regulars().map((r) => [r.uid, r]));
  let changed = false;
  for (const m of members) {
    if (m.me || !m.name) continue;
    const r = known.get(m.uid);
    if (!r || r.name !== m.name || !r.groups.includes(gid) || Date.now() - r.lastAt > 3_600_000) {
      known.set(m.uid, { uid: m.uid, name: m.name, groups: [...new Set([...(r?.groups ?? []), gid])].slice(-30), lastAt: Date.now() });
      changed = true;
    }
  }
  if (changed) writeLocal(regularsKey(), JSON.stringify([...known.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, 100)));
}

export function forgetRegulars(): void {
  writeLocal(regularsKey(), null);
}
