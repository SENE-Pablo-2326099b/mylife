import { uid } from '../core/text';
import { facts, factsChanged, getMeta, setMeta, type FactsDB, type RawAccount } from '../data/facts';
import type { EbAspsp } from './ebTypes';
import { mapEbAccount } from './mapping';
import type { Relay } from './relay';

/**
 * Relier une banque : on part vers la page d'authentification de la banque, qui renvoie à l'adresse de retour avec un
 * code ; ce code s'échange contre un accès (90 à 180 jours selon la banque) et la liste des comptes.
 *
 * L'adresse de retour est celle déclarée auprès d'Enable Banking, `/finances/connexion/retour` : tant que l'ancienne
 * app existe, c'est elle qui la sert ; elle termine la connexion dans la base commune puis renvoie ici (`returnTo`).
 */
export const CALLBACK_URL_PATH = '/finances/connexion/retour';
export const RETURN_TO = '/argent/banques';
const PENDING_KEY = 'pendingAuth';
const MAX_VALIDITY_S = 180 * 86400;

export interface PendingAuth {
  state: string;
  aspsp: { name: string; country: string };
  createdAt: number;
  /** Où revenir une fois la connexion terminée (lu par l'ancienne app). */
  returnTo?: string;
}

export async function startBankConnection(relay: Relay, aspsp: EbAspsp, database: FactsDB = facts, go: (url: string) => void = (url) => window.location.assign(url), origin = window.location.origin): Promise<void> {
  const state = uid('s');
  const validitySeconds = Math.min(aspsp.maximum_consent_validity ?? 90 * 86400, MAX_VALIDITY_S) - 3600;
  const pending: PendingAuth = { state, aspsp: { name: aspsp.name, country: aspsp.country }, createdAt: Date.now(), returnTo: RETURN_TO };
  await setMeta(PENDING_KEY, pending, database);
  const { url } = await relay.startAuth({ aspsp: pending.aspsp, redirectUrl: origin + CALLBACK_URL_PATH, state, validUntil: new Date(Date.now() + validitySeconds * 1000).toISOString() });
  go(url);
}

export const getPendingAuth = (database: FactsDB = facts) => getMeta<PendingAuth>(PENDING_KEY, database);

/** Le code, l'état et l'erreur d'une adresse de retour (ou d'un code collé tel quel). */
export function parseCallback(input: string): { code: string | null; state: string | null; error: string | null } {
  const trimmed = input.trim();
  let params: URLSearchParams;
  try {
    params = new URL(trimmed).searchParams;
  } catch {
    if (trimmed.includes('=')) params = new URLSearchParams(trimmed.replace(/^\?/, ''));
    else return { code: trimmed || null, state: null, error: null };
  }
  const error = params.get('error');
  const desc = params.get('error_description');
  return { code: params.get('code'), state: params.get('state'), error: error ? `${error}${desc ? ' : ' + desc : ''}` : null };
}

/** Échange le code de retour contre un accès et enregistre les comptes (un compte déjà connu garde son historique). */
export async function completeBankConnection(relay: Relay, code: string, state: string | null, database: FactsDB = facts): Promise<RawAccount[]> {
  const pending = await getPendingAuth(database);
  if (pending && state && pending.state !== state) throw new Error('Le lien de retour ne correspond pas à la connexion en cours. Relance la connexion.');
  const session = await relay.createSession(code);
  const accounts: RawAccount[] = [];
  await database.transaction('rw', [database.accounts, database.connections, database.meta], async () => {
    for (const raw of session.accounts) {
      if (!raw.uid) continue; // compte non consultable (bloqué, clos…)
      const mapped = mapEbAccount(raw, session.aspsp.name, session.session_id);
      const existing = await database.accounts.get(mapped.id);
      const account: RawAccount = existing ? { ...existing, remoteUid: mapped.remoteUid, connectionId: session.session_id, iban: mapped.iban ?? existing.iban, lastSyncError: null } : mapped;
      await database.accounts.put(account);
      accounts.push(account);
    }
    await database.connections.put({ id: session.session_id, aspspName: session.aspsp.name, aspspCountry: session.aspsp.country, validUntil: session.access.valid_until, createdAt: Date.now(), status: 'active', accountIds: accounts.map((a) => a.id) });
    await database.meta.delete(PENDING_KEY);
  });
  factsChanged();
  return accounts;
}

/** Ferme l'accès côté banque et détache les comptes (l'historique est gardé). */
export async function disconnectBank(relay: Relay | null, connectionId: string, database: FactsDB = facts): Promise<void> {
  try {
    await relay?.deleteSession(connectionId);
  } catch {
    /* l'accès est peut-être déjà expiré */
  }
  await database.transaction('rw', [database.accounts, database.connections], async () => {
    await database.connections.update(connectionId, { status: 'revoked' });
    for (const a of await database.accounts.where('connectionId').equals(connectionId).toArray()) await database.accounts.update(a.id, { remoteUid: null });
  });
  factsChanged();
}
