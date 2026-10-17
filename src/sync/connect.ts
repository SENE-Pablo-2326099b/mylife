import { db, getMeta, setMeta, type BudgetDB } from '../db/db';
import type { Account } from '../db/types';
import { classifyTransactions } from '../domain/classifyDb';
import { uid } from '../lib/text';
import type { EbClient } from './ebClient';
import { mapEbAccount } from './ebMapping';
import type { EbAspsp } from './ebTypes';

export const CALLBACK_PATH = '/connexion/retour';
const PENDING_KEY = 'pendingAuth';
const MAX_VALIDITY_S = 180 * 86400;

export interface PendingAuth {
  state: string;
  aspsp: { name: string; country: string };
  createdAt: number;
}

export function callbackUrl(origin = window.location.origin): string {
  return origin + CALLBACK_PATH;
}

/** Démarre la connexion à une banque : redirige vers la page d'authentification de la banque. */
export async function startBankConnection(client: EbClient, aspsp: EbAspsp, database: BudgetDB = db): Promise<void> {
  const state = uid('s');
  const validitySeconds = Math.min(aspsp.maximum_consent_validity ?? 90 * 86400, MAX_VALIDITY_S) - 3600;
  const validUntil = new Date(Date.now() + validitySeconds * 1000).toISOString();
  const pending: PendingAuth = { state, aspsp: { name: aspsp.name, country: aspsp.country }, createdAt: Date.now() };
  await setMeta(PENDING_KEY, pending, database);
  const { url } = await client.startAuth({ aspsp: pending.aspsp, redirectUrl: callbackUrl(), state, validUntil });
  window.location.assign(url);
}

export async function getPendingAuth(database: BudgetDB = db): Promise<PendingAuth | undefined> {
  return getMeta<PendingAuth>(PENDING_KEY, database);
}

/** Extrait code / state / erreur d'une URL de retour (ou d'un code collé tel quel). */
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

/** Échange le code de retour contre une session et enregistre les comptes. */
export async function completeBankConnection(client: EbClient, code: string, state: string | null, database: BudgetDB = db): Promise<Account[]> {
  const pending = await getPendingAuth(database);
  if (pending && state && pending.state !== state) {
    throw new Error('Le lien de retour ne correspond pas à la connexion en cours. Relance la connexion depuis l’app.');
  }
  const session = await client.createSession(code);
  const accounts: Account[] = [];
  await database.transaction('rw', [database.accounts, database.connections, database.meta], async () => {
    for (const raw of session.accounts) {
      if (!raw.uid) continue; // compte non consultable (bloqué, clos…)
      const mapped = mapEbAccount(raw, session.aspsp.name, session.session_id);
      const existing = await database.accounts.get(mapped.id);
      const account: Account = existing
        ? { ...existing, remoteUid: mapped.remoteUid, connectionId: session.session_id, iban: mapped.iban ?? existing.iban, lastSyncError: null }
        : mapped;
      await database.accounts.put(account);
      accounts.push(account);
    }
    await database.connections.put({
      id: session.session_id,
      aspspName: session.aspsp.name,
      aspspCountry: session.aspsp.country,
      validUntil: session.access.valid_until,
      createdAt: Date.now(),
      status: 'active',
      accountIds: accounts.map((a) => a.id),
    });
    await database.meta.delete(PENDING_KEY);
  });
  // Les IBAN connus permettent de reconnaître de nouveaux transferts internes.
  await classifyTransactions(database);
  return accounts;
}

/** Ferme l'accès côté banque et détache les comptes (l'historique est conservé). */
export async function disconnectBank(client: EbClient | null, connectionId: string, database: BudgetDB = db): Promise<void> {
  if (client) {
    try {
      await client.deleteSession(connectionId);
    } catch {
      /* la session est peut-être déjà expirée */
    }
  }
  await database.transaction('rw', [database.accounts, database.connections], async () => {
    await database.connections.update(connectionId, { status: 'revoked' });
    const accounts = await database.accounts.where('connectionId').equals(connectionId).toArray();
    for (const a of accounts) await database.accounts.update(a.id, { remoteUid: null });
  });
}

/** Trouve une banque dans la liste Enable Banking par son nom. */
export function findAspsp(list: EbAspsp[], pattern: RegExp): EbAspsp | undefined {
  return list.filter((a) => pattern.test(a.name)).sort((a, b) => Number(!!a.beta) - Number(!!b.beta) || a.name.length - b.name.length)[0];
}
