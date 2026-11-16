import type { Allocation, Db, Transaction } from '../engine/schema';

const FLOW_TAG = { TRANSFER: 'Virement', SAVING: 'Mise de côté', REFUND: 'Remboursement', INCOME: 'Revenu' } as const;

/** Une opération telle qu'on la lit dans une liste : son nom, sa pastille, sa ligne de détail. */
export interface OpView {
  tx: Transaction;
  lines: Allocation[];
  name: string;
  color: string | null;
  letter: string;
  detail: string;
  tag: string | null;
  /** Rien n'est décidé (ou une dépense sans catégorie). */
  unclassified: boolean;
}

export function opViews(db: Db): OpView[] {
  const merchants = new Map(db.merchants.map((m) => [m.id, m.name]));
  const cats = new Map(db.categories.map((c) => [c.id, c]));
  const accounts = new Map(db.accounts.map((a) => [a.id, a]));
  const txs = new Map(db.transactions.map((t) => [t.id, t]));
  const byTx = new Map<string, Allocation[]>();
  for (const a of db.allocations) byTx.set(a.transactionId, [...(byTx.get(a.transactionId) ?? []), a]);
  const catName = (id: string | null) => {
    const c = id ? cats.get(cats.get(id)?.mergedIntoId ?? id) : undefined;
    if (!c) return null;
    const parent = c.parentId ? cats.get(c.parentId) : undefined;
    return parent ? `${parent.name} › ${c.name}` : c.name;
  };
  const catColor = (id: string | null) => {
    const c = id ? cats.get(cats.get(id)?.mergedIntoId ?? id) : undefined;
    return c ? (c.parentId ? (cats.get(c.parentId)?.color ?? c.color) : c.color) : null;
  };
  return db.transactions
    .filter((t) => !accounts.get(t.accountId)?.archivedAt)
    .map((tx) => {
      const lines = byTx.get(tx.id) ?? [];
      const first = lines[0];
      const flow = first?.flow ?? null;
      const account = accounts.get(tx.accountId)?.name ?? '';
      const name = (tx.merchantId && merchants.get(tx.merchantId)) || tx.rawLabel;
      const other = first?.linkedTransactionId ? accounts.get(txs.get(first.linkedTransactionId)?.accountId ?? '')?.name : undefined;
      const unclassified = lines.some((a) => a.flow === null || (a.flow === 'EXPENSE' && a.categoryId === null));
      let detail = account;
      if (tx.pending) detail = `En attente à la banque · ${account}`;
      else if (lines.length > 1) detail = `Ventilée : ${lines.map((a) => catName(a.categoryId) ?? 'à classer').join(' · ')}`;
      else if (flow === 'EXPENSE') detail = `${catName(first!.categoryId) ?? 'À classer'} · ${account}${first!.receivableAmount ? ' · part avancée' : ''}${first!.smoothed ? ' · lissée' : ''}`;
      else if (flow === 'TRANSFER' || flow === 'SAVING') detail = other ? `${tx.amount < 0 ? 'vers' : 'depuis'} ${other}` : account;
      else if (flow === 'REFUND') detail = first!.settlesReceivableId ? `avance remboursée · ${account}` : `${catName(first!.categoryId) ?? account}`;
      else if (flow === null) detail = `À classer · ${account}`;
      return {
        tx,
        lines,
        name: flow === 'TRANSFER' || flow === 'SAVING' ? (other ? `${tx.amount < 0 ? account : other} → ${tx.amount < 0 ? other : account}` : name) : name,
        color: flow === 'EXPENSE' || flow === 'REFUND' ? catColor(first?.categoryId ?? null) : flow === 'INCOME' ? '#8df0b9' : null,
        letter: (name.trim()[0] ?? '?').toUpperCase(),
        detail,
        tag: flow && flow !== 'EXPENSE' ? FLOW_TAG[flow] : null,
        unclassified,
      };
    });
}
