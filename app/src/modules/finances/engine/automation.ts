import { addDays, diffDays, parseISO, weekday, type ISODate } from '../core/dates';
import { normalizeText, titleCase } from '../core/text';
import type { Allocation, Commitment, Db, Flow, Merchant, Rule, Transaction } from './schema';

/**
 * Les automatisations (étape M3) : ce que le moteur fait à ta place, sans jamais écraser ce que tu as décidé à la
 * main (`origin: 'manual'`). Fonctions pures.
 * - **classer** : règles de tri (la plus prioritaire l'emporte), puis valeurs par défaut du marchand ;
 * - **apparier les virements internes** : deux opérations opposées sur deux de tes comptes, à quelques jours
 *   d'écart, deviennent un virement (impact nul), ou une mise de côté s'il va vers l'épargne ou un placement ;
 * - **détecter les récurrents** : ce qui revient à rythme et montant réguliers est proposé comme engagement.
 */

const single = (db: Db): Map<string, Allocation> => {
  const count = new Map<string, number>();
  for (const a of db.allocations) count.set(a.transactionId, (count.get(a.transactionId) ?? 0) + 1);
  return new Map(db.allocations.filter((a) => count.get(a.transactionId) === 1).map((a) => [a.transactionId, a]));
};

// ---------------------------------------------------------------- classer

export function ruleMatches(r: Rule, t: Transaction): boolean {
  if (!r.enabled) return false;
  if (r.merchantId && t.merchantId !== r.merchantId) return false;
  if (r.accountIds.length && !r.accountIds.includes(t.accountId)) return false;
  if (r.direction === 'debit' && t.amount >= 0) return false;
  if (r.direction === 'credit' && t.amount <= 0) return false;
  const abs = Math.abs(t.amount);
  if (r.amountMin !== null && abs < r.amountMin) return false;
  if (r.amountMax !== null && abs > r.amountMax) return false;
  if (r.keywords.length) {
    const label = ` ${normalizeText(t.rawLabel)} `;
    if (!r.keywords.some((k) => normalizeText(k) && label.includes(` ${normalizeText(k)} `))) return false;
  }
  // Une règle sans aucune condition ne classe rien : elle classerait tout.
  return !!(r.merchantId || r.accountIds.length || r.keywords.length || r.amountMin !== null || r.amountMax !== null);
}

/** Une catégorie ne va qu'avec une dépense ou un remboursement (les autres flux n'en portent pas ici). */
const withCategory = (flow: Flow, categoryId: string | null) => (flow === 'EXPENSE' || flow === 'REFUND' ? categoryId : null);

/** Ce qu'un marchand classé dit d'une opération : une rentrée chez un marchand de dépense est un remboursement. */
function fromMerchant(m: Merchant, amount: number): { flow: Flow; categoryId: string | null } | null {
  if (m.flow === null) return null;
  const flow: Flow = m.flow === 'EXPENSE' && amount > 0 ? 'REFUND' : m.flow;
  return { flow, categoryId: withCategory(flow, m.categoryId) };
}

/**
 * Classe les lignes : une règle qui correspond l'emporte toujours ; sinon le marchand, pour une ligne pas encore
 * classée ou classée par un marchand. `overridden` : les marchands que l'utilisateur a classés lui-même (ils
 * s'imposent aussi aux lignes venues classées de la reprise). Une ligne décidée à la main ne bouge jamais.
 */
export function classify(db: Db, overridden: ReadonlySet<string> = new Set()): Db {
  const one = single(db);
  const txById = new Map(db.transactions.map((t) => [t.id, t]));
  const merchants = new Map(db.merchants.map((m) => [m.id, m]));
  const rules = [...db.rules].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return {
    ...db,
    allocations: db.allocations.map((a) => {
      const t = txById.get(a.transactionId);
      if (!t || a.origin === 'manual' || one.get(t.id) !== a) return a;
      const rule = rules.find((r) => ruleMatches(r, t));
      if (rule) return { ...a, flow: rule.flow, categoryId: withCategory(rule.flow, rule.categoryId), tagIds: [...new Set([...a.tagIds, ...rule.tagIds])], origin: 'rule' as const };
      const merchant = t.merchantId ? merchants.get(t.merchantId) : undefined;
      const unclassified = a.flow === null || (a.flow === 'EXPENSE' && a.categoryId === null);
      if (!merchant || !(unclassified || a.origin === 'merchant' || overridden.has(merchant.id))) return a;
      const said = fromMerchant(merchant, t.amount);
      return said ? { ...a, ...said, tagIds: [...new Set([...a.tagIds, ...merchant.tagIds])], origin: 'merchant' as const } : a;
    }),
  };
}

// ---------------------------------------------------------------- apparier les virements internes

const TRANSFER_HINT = /\b(vir|virt|virement|virements|sepa|instantane|transfer|transfert|top ?up|rechargement|recharge|payment from|money added|versement)\b/;
const looksLikeTransfer = (t: Transaction) => TRANSFER_HINT.test(normalizeText(t.rawLabel));

/**
 * Associe les deux jambes d'un virement entre deux de tes comptes : montants opposés, même devise, comptes
 * différents, dates à `transferToleranceDays` près. Les deux jambes se référencent ; l'ensemble pèse zéro.
 * Vers l'épargne ou un placement depuis un compte du quotidien, la sortie devient une mise de côté.
 */
export function pairTransfers(db: Db): Db {
  const one = single(db);
  const accounts = new Map(db.accounts.map((a) => [a.id, a]));
  const eligible = (t: Transaction) => {
    const a = one.get(t.id);
    if (!a || a.origin === 'manual' || a.linkedTransactionId || a.occurrenceId || a.settlesReceivableId) return false;
    return a.flow === null || a.flow === 'TRANSFER' || a.flow === 'SAVING' || (looksLikeTransfer(t) && a.flow !== 'REFUND');
  };
  const pool = db.transactions.filter((t) => !accounts.get(t.accountId)?.archivedAt && eligible(t));
  const credits = pool.filter((t) => t.amount > 0);
  const used = new Set<string>();
  const patch = new Map<string, Partial<Allocation>>();
  for (const d of pool.filter((t) => t.amount < 0).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    const from = accounts.get(d.accountId)!;
    const best = credits
      .filter((c) => !used.has(c.id) && c.accountId !== d.accountId && c.amount === -d.amount && accounts.get(c.accountId)!.currency === from.currency && Math.abs(diffDays(d.date, c.date)) <= db.settings.transferToleranceDays)
      .sort((a, b) => Math.abs(diffDays(d.date, a.date)) - Math.abs(diffDays(d.date, b.date)) || a.id.localeCompare(b.id))[0];
    if (!best) continue;
    used.add(best.id);
    const to = accounts.get(best.accountId)!;
    const saving = from.includeInDailyCash && (to.role === 'SAVINGS' || to.role === 'INVESTMENT');
    patch.set(one.get(d.id)!.id, { flow: saving ? 'SAVING' : 'TRANSFER', categoryId: null, linkedTransactionId: best.id, origin: 'rule' });
    patch.set(one.get(best.id)!.id, { flow: 'TRANSFER', categoryId: null, linkedTransactionId: d.id, origin: 'rule' });
  }
  return patch.size ? { ...db, allocations: db.allocations.map((a) => (patch.has(a.id) ? { ...a, ...patch.get(a.id) } : a)) } : db;
}

export const automate = (db: Db, overridden?: ReadonlySet<string>): Db => pairTransfers(classify(db, overridden));

// ---------------------------------------------------------------- à classer

export interface ToClassify {
  /** Clé stable : le marchand, ou la ligne seule. */
  key: string;
  merchantId: string | null;
  name: string;
  allocationIds: string[];
  /** Somme des montants (signée) : négative pour des sorties. */
  total: number;
  count: number;
}

/** Ce qui attend d'être classé, groupé par marchand, les plus gros d'abord. */
export function toClassify(db: Db): ToClassify[] {
  const txById = new Map(db.transactions.map((t) => [t.id, t]));
  const names = new Map(db.merchants.map((m) => [m.id, m.name]));
  const groups = new Map<string, ToClassify>();
  for (const a of db.allocations) {
    const t = txById.get(a.transactionId);
    if (!t || t.pending || !(a.flow === null || (a.flow === 'EXPENSE' && a.categoryId === null))) continue;
    const key = t.merchantId ?? `solo:${a.id}`;
    const g = groups.get(key) ?? { key, merchantId: t.merchantId, name: (t.merchantId && names.get(t.merchantId)) || t.rawLabel, allocationIds: [], total: 0, count: 0 };
    g.allocationIds.push(a.id);
    g.total += a.amount;
    g.count++;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

// ---------------------------------------------------------------- détecter les récurrents

export interface RecurringSuggestion {
  /** Clé stable (pour « ignorer »). */
  key: string;
  kind: 'INCOME' | 'CHARGE';
  label: string;
  /** Montant habituel, positif. */
  amount: number;
  rhythm: 'MONTHLY' | 'WEEKLY' | 'BIWEEKLY';
  anchorDay: number;
  anchorDate: ISODate;
  accountId: string;
  /** Nombre d'opérations qui fondent la détection. */
  count: number;
  lastDate: ISODate;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

/**
 * Ce qui revient : même marchand (ou même libellé), au moins trois fois sur les 200 derniers jours, à intervalle
 * régulier (semaine, quinzaine, mois) et montant stable. Ce qui est déjà au plan, ou ignoré, n'est pas proposé.
 */
export function detectRecurring(db: Db, today: ISODate, ignored: readonly string[] = []): RecurringSuggestion[] {
  const from = addDays(today, -200);
  const lines = new Map<string, Allocation[]>();
  for (const a of db.allocations) lines.set(a.transactionId, [...(lines.get(a.transactionId) ?? []), a]);
  const names = new Map(db.merchants.map((m) => [m.id, m.name]));
  const groups = new Map<string, Transaction[]>();
  for (const t of db.transactions) {
    if (t.date < from || t.date > today || t.pending) continue;
    const flows = (lines.get(t.id) ?? []).map((l) => l.flow);
    // Un virement, une mise de côté ou un remboursement ne sont pas des charges ni des revenus.
    if (flows.some((f) => f === 'TRANSFER' || f === 'SAVING' || f === 'REFUND')) continue;
    if (t.amount > 0 && !flows.includes('INCOME')) continue;
    const label = normalizeText(t.rawLabel).replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
    const key = `${t.amount > 0 ? 'in' : 'out'}:${t.accountId}:${t.merchantId ?? label}`;
    if (label.length >= 3 || t.merchantId) groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const words = (s: string) => new Set(normalizeText(s).split(' ').filter((w) => w.length >= 3));
  const planned = (kind: Commitment['kind'], label: string, amount: number) =>
    db.commitments.some((c) => (kind === 'INCOME' ? c.kind === 'INCOME' : c.kind === 'CHARGE' || c.kind === 'INSTALLMENT') && Math.abs(c.amount - amount) <= c.amount * Math.max(c.tolerance, 0.2) && [...words(c.label)].some((w) => words(label).has(w)));
  const out: RecurringSuggestion[] = [];
  for (const [key, txs] of groups) {
    if (txs.length < 3 || ignored.includes(key)) continue;
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    const gaps = sorted.slice(1).map((t, i) => diffDays(sorted[i]!.date, t.date));
    const gap = median(gaps);
    const rhythm = gap >= 26 && gap <= 35 ? 'MONTHLY' : gap >= 13 && gap <= 15 ? 'BIWEEKLY' : gap >= 6 && gap <= 8 ? 'WEEKLY' : null;
    if (!rhythm || gaps.filter((g) => Math.abs(g - gap) <= Math.max(2, gap * 0.2)).length < gaps.length * 0.6) continue;
    const amounts = sorted.map((t) => Math.abs(t.amount));
    const amount = median(amounts);
    if (amounts.filter((a) => Math.abs(a - amount) <= amount * 0.15).length < amounts.length * 0.66) continue;
    const last = sorted[sorted.length - 1]!;
    // Arrêté depuis longtemps : ce n'est plus un récurrent.
    if (diffDays(last.date, today) > gap * 1.6) continue;
    const kind = last.amount > 0 ? 'INCOME' : 'CHARGE';
    const label = (last.merchantId && names.get(last.merchantId)) || titleCase(normalizeText(last.rawLabel).replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim());
    if (planned(kind, `${label} ${last.rawLabel}`, amount)) continue;
    out.push({ key, kind, label, amount, rhythm, anchorDay: rhythm === 'MONTHLY' ? median(sorted.map((t) => parseISO(t.date).d)) : weekday(last.date), anchorDate: last.date, accountId: last.accountId, count: sorted.length, lastDate: last.date });
  }
  return out.sort((a, b) => b.amount - a.amount);
}
