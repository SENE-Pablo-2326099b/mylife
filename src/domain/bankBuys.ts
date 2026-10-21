import type { Holding, InvestmentOp, Transaction } from '../db/types';
import type { ISODate } from '../lib/dates';
import { normalizeText } from '../lib/text';

/**
 * Achats automatiques à partir des prélèvements bancaires (Bitstack, et tout service sans API) :
 * chaque débit dont le libellé contient le mot-clé de la ligne devient un achat, la quantité étant
 * calculée au cours du jour du prélèvement (`priceOn`, en centimes) ; un crédit (retrait vers la banque) devient une vente.
 *
 * - Seuls les prélèvements postérieurs au dernier recalage (et à `bankLinkFrom`) comptent : ceux
 *   d'avant sont déjà dans la quantité et le prix de revient recalés sur l'app du courtier.
 * - Les opérations « en attente » sont ignorées tant qu'elles ne sont pas définitives (leur id change).
 * - Quantité marquée « estimée » : frais du courtier et heure exacte d'achat inconnus ; un recalage
 *   remet tout d'aplomb.
 */
export function bankBuys(holding: Holding, txs: readonly Transaction[], ops: readonly InvestmentOp[], priceOn: (date: ISODate) => number | null, now = Date.now()): InvestmentOp[] {
  const keyword = normalizeText(holding.bankKeyword ?? '');
  if (!keyword) return [];
  const mine = ops.filter((o) => o.holdingId === holding.id);
  const lastAdjust = mine.filter((o) => o.type === 'adjust').reduce<ISODate | null>((m, o) => (m === null || o.date > m ? o.date : m), null);
  // Déjà compris dans le recalage (jour même inclus), ou antérieur au début du lien.
  const before = (d: ISODate) => (lastAdjust !== null && d <= lastAdjust) || (!!holding.bankLinkFrom && d < holding.bankLinkFrom);
  const linked = new Set(mine.map((o) => o.bankTxId).filter(Boolean));
  const out: InvestmentOp[] = [];
  for (const t of txs) {
    if (t.pending || t.amount === 0 || linked.has(t.id)) continue;
    if (before(t.date)) continue;
    if (!normalizeText(`${t.label} ${t.rawText}`).includes(keyword)) continue;
    const amount = Math.abs(t.amount);
    const price = priceOn(t.date);
    out.push({
      id: `bank-${t.id}`,
      holdingId: holding.id,
      date: t.date,
      type: t.amount < 0 ? 'buy' : 'sell',
      quantity: price && price > 0 ? Math.round((amount / price) * 1e8) / 1e8 : 0,
      amount,
      planId: null,
      estimated: true,
      note: `Prélèvement ${t.label}`,
      createdAt: now,
      bankTxId: t.id,
    });
  }
  return out;
}

/**
 * Cours en centimes à une date, à partir d'un historique quotidien en euros (dernier cours connu à
 * cette date ou avant ; sinon le cours actuel `fallback`, en centimes).
 */
export function priceLookup(historyEuros: readonly [ISODate, number][], fallback: number | null): (date: ISODate) => number | null {
  const sorted = [...historyEuros].sort((a, b) => a[0].localeCompare(b[0]));
  return (date) => {
    let best: number | null = null;
    for (const [d, p] of sorted) {
      if (d > date) break;
      best = p * 100;
    }
    return best ?? fallback;
  };
}
