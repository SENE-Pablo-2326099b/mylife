import type { Transaction } from '../db/types';
import { diffDays } from '../lib/dates';

export const TRANSFER_WINDOW_DAYS = 4;

type PairCandidate = Pick<Transaction, 'id' | 'accountId' | 'amount' | 'date' | 'categoryId' | 'categorySource' | 'transferPairId'>;

/**
 * Associe les deux jambes d'un virement entre comptes personnels (ex. BNP → Revolut) :
 * montants opposés, comptes différents, dates proches, et au moins une jambe déjà reconnue comme transfert.
 * L'autre jambe (souvent un libellé générique type "Top up") est alors classée en transfert elle aussi,
 * pour ne jamais compter le même argent deux fois.
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
      if (!isTransfer(d) && !isTransfer(c)) continue;
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
