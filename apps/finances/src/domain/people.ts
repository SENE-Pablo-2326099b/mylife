import type { Transaction } from '../db/types';
import { CAT } from './defaults';

export interface PersonBalance {
  person: string;
  /** Somme des flux : positif = la personne t'a plus versé que tu ne lui as versé. */
  net: number;
  received: number;
  sent: number;
  count: number;
  lastDate: string;
}

/** Solde net cumulé avec chaque personne (remboursements entre amis). */
export function personBalances(txs: Transaction[], refundCategoryId: string = CAT.remboursements): PersonBalance[] {
  const map = new Map<string, PersonBalance>();
  for (const t of txs) {
    if (t.categoryId !== refundCategoryId) continue;
    const name = (t.person ?? t.counterparty ?? t.label).trim();
    const key = name.toLowerCase();
    const cur = map.get(key) ?? { person: name, net: 0, received: 0, sent: 0, count: 0, lastDate: t.date };
    cur.net += t.amount;
    if (t.amount > 0) cur.received += t.amount;
    else cur.sent += -t.amount;
    cur.count++;
    if (t.date > cur.lastDate) cur.lastDate = t.date;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}
