import type { Transaction } from '../db/types';
import { diffDays } from '../lib/dates';
import { normalizeText } from '../lib/text';

export const TRANSFER_WINDOW_DAYS = 4;

type PairCandidate = Pick<Transaction, 'id' | 'accountId' | 'amount' | 'date' | 'categoryId' | 'categorySource' | 'transferPairId'> & Partial<Pick<Transaction, 'label' | 'rawText'>>;

/** Libellé d'un virement (pas d'un paiement par carte) : « VIR SEPA », « Payment from », « Top-up »… */
const TRANSFER_HINT = /\b(vir|virt|virement|virements|sepa|instantane|instant|transfer|transfert|top ?up|rechargement|recharge|payment from|paiement (envoye|recu)|money added|depot|versement|apple pay top)\b/;
export function looksLikeTransfer(t: Partial<Pick<Transaction, 'label' | 'rawText'>>): boolean {
  return TRANSFER_HINT.test(normalizeText(`${t.label ?? ''} ${t.rawText ?? ''}`));
}

/**
 * Associe les deux jambes d'un virement entre comptes personnels (ex. BNP → Revolut) :
 * montants opposés, comptes différents, dates proches, et soit une jambe déjà reconnue comme
 * transfert, soit au moins une jambe dont le libellé est celui d'un virement (jamais deux paiements
 * par carte). Les deux jambes sont alors classées en transfert : le même argent n'est jamais compté
 * deux fois, ni en dépense ni en revenu. Une catégorie corrigée à la main n'est pas écrasée.
 */
export function pairTransfers(txs: PairCandidate[], transferCategoryId: string, windowDays = TRANSFER_WINDOW_DAYS): [string, string][] {
  const isTransfer = (t: PairCandidate) => t.categoryId === transferCategoryId;
  const canBecomeTransfer = (t: PairCandidate) => t.categorySource !== 'manual' || isTransfer(t);
  const used = new Set<string>();
  for (const t of txs) if (t.transferPairId) used.add(t.id);

  const pairs: [string, string][] = [];
  const debits = txs.filter((t) => t.amount < 0 && !used.has(t.id)).sort((a, b) => a.date.localeCompare(b.date));
  const credits = txs.filter((t) => t.amount > 0 && !used.has(t.id));

  for (const d of debits) {
    let best: PairCandidate | null = null;
    let bestGap = Infinity;
    for (const c of credits) {
      if (used.has(c.id) || c.accountId === d.accountId || c.amount !== -d.amount) continue;
      if (!isTransfer(d) && !isTransfer(c) && !looksLikeTransfer(d) && !looksLikeTransfer(c)) continue;
      if (!canBecomeTransfer(d) || !canBecomeTransfer(c)) continue;
      const gap = Math.abs(diffDays(d.date, c.date));
      if (gap > windowDays) continue;
      if (gap < bestGap) {
        best = c;
        bestGap = gap;
      }
    }
    if (best) {
      used.add(d.id);
      used.add(best.id);
      pairs.push([d.id, best.id]);
    }
  }
  return pairs;
}

export function isOwnAccount(iban: string | null, ownIbans: Set<string>): boolean {
  return !!iban && ownIbans.has(iban.replace(/\s+/g, '').toUpperCase());
}
