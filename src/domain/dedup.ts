import type { Transaction } from '../db/types';
import { diffDays } from '../lib/dates';
import { hash, normalizeText } from '../lib/text';
import type { IncomingTransaction } from '../sync/source';

/** Clé de base : compte + date + montant + libellé normalisé. */
export function baseKey(accountId: string, tx: Pick<IncomingTransaction, 'date' | 'amount' | 'label'>): string {
  return `${accountId}|${tx.date}|${tx.amount}|${normalizeText(tx.label)}`;
}

/**
 * Attribue un identifiant stable à chaque opération d'un lot.
 * Deux opérations strictement identiques le même jour (deux cafés à 1,50 €) restent distinctes
 * grâce à leur rang d'apparition (#0, #1…), qui est le même d'un téléchargement à l'autre.
 */
export function assignIds(accountId: string, txs: IncomingTransaction[]): { id: string; tx: IncomingTransaction }[] {
  const seen = new Map<string, number>();
  return txs.map((tx) => {
    const key = baseKey(accountId, tx) + (tx.pending ? '|P' : '');
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return { id: `${accountId}:${tx.date}:${hash(key)}:${n}${tx.pending ? ':p' : ''}`, tx };
  });
}

export interface MergeResult {
  toAdd: Transaction[];
  /** Identifiants des opérations « en attente » à supprimer (remplacées par la nouvelle photo). */
  toDelete: string[];
  duplicates: number;
  newBooked: number;
  newPending: number;
  /** Opérations en attente devenues définitives. */
  settled: number;
}

const CARRY_FIELDS = ['categoryId', 'categorySource', 'ruleId', 'person', 'note'] as const;

function sameOperation(a: Pick<Transaction, 'amount' | 'label' | 'date'>, b: Pick<IncomingTransaction, 'amount' | 'label' | 'date'>): boolean {
  return a.amount === b.amount && normalizeText(a.label) === normalizeText(b.label) && Math.abs(diffDays(a.date, b.date)) <= 5;
}

/**
 * Fusionne un lot téléchargé avec les opérations déjà connues d'un compte.
 *
 * - Opérations définitives : jamais de doublon (même id, ou même référence bancaire).
 * - Opérations en attente : les anciennes sont toutes remplacées par celles du lot
 *   (une opération en attente qui passe disparaît des « en attente » et revient en définitive).
 * - Une catégorie choisie à la main sur une opération en attente est conservée quand elle passe.
 */
export function mergeTransactions(
  accountId: string,
  existing: Transaction[],
  incoming: IncomingTransaction[],
  source: Transaction['source'],
  now = Date.now(),
): MergeResult {
  const known = existing.filter((t) => t.accountId === accountId);
  const bookedIds = new Set(known.filter((t) => !t.pending).map((t) => t.id));
  const bookedRefs = new Set(known.filter((t) => !t.pending && t.externalId).map((t) => t.externalId as string));
  const oldPending = known.filter((t) => t.pending);
  const unclaimedPending = [...oldPending];

  const result: MergeResult = { toAdd: [], toDelete: oldPending.map((t) => t.id), duplicates: 0, newBooked: 0, newPending: 0, settled: 0 };

  for (const { id, tx } of assignIds(accountId, incoming)) {
    if (!tx.pending && (bookedIds.has(id) || (tx.externalId && bookedRefs.has(tx.externalId)))) {
      result.duplicates++;
      continue;
    }
    const row: Transaction = {
      id,
      accountId,
      date: tx.date,
      bookingDate: tx.bookingDate,
      amount: tx.amount,
      currency: tx.currency,
      label: tx.label,
      rawText: tx.rawText,
      counterparty: tx.counterparty,
      counterpartyIban: tx.counterpartyIban,
      pending: tx.pending,
      balanceAfter: tx.balanceAfter,
      categoryId: null,
      categorySource: null,
      ruleId: null,
      person: null,
      transferPairId: null,
      note: '',
      source,
      externalId: tx.externalId,
      mcc: tx.mcc,
      createdAt: now,
    };
    // Reprend les infos saisies sur l'ancienne version « en attente » de la même opération.
    const idx = unclaimedPending.findIndex((p) => sameOperation(p, tx));
    if (idx !== -1) {
      const prev = unclaimedPending.splice(idx, 1)[0];
      if (prev.categorySource === 'manual' || prev.note) {
        for (const f of CARRY_FIELDS) (row as unknown as Record<string, unknown>)[f] = prev[f];
      }
      if (!tx.pending) result.settled++;
    }
    if (tx.pending) result.newPending++;
    else {
      result.newBooked++;
      bookedIds.add(id);
      if (tx.externalId) bookedRefs.add(tx.externalId);
    }
    result.toAdd.push(row);
  }
  // Une ancienne opération en attente réapparue à l'identique n'est pas « nouvelle ».
  const oldPendingIds = new Set(oldPending.map((t) => t.id));
  result.newPending -= result.toAdd.filter((t) => t.pending && oldPendingIds.has(t.id)).length;
  return result;
}
