import type { Db } from './schema';

/**
 * Les contraintes d'intégrité du schéma. Le serveur ne lit pas les données (chiffrées) : c'est ici qu'elles sont
 * garanties. Renvoie la liste des fautes (vide : tout est conforme). Les « alertes » ne bloquent pas : elles
 * signalent une situation à regarder (une poche plus grosse que le solde de son compte).
 */
export interface IntegrityReport {
  errors: string[];
  warnings: string[];
}

export function checkIntegrity(db: Db): IntegrityReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const accounts = new Map(db.accounts.map((a) => [a.id, a]));
  const txs = new Map(db.transactions.map((t) => [t.id, t]));
  const cats = new Map(db.categories.map((c) => [c.id, c]));

  // 1. La somme des lignes d'une transaction égale son montant.
  const sums = new Map<string, number>();
  for (const a of db.allocations) {
    if (!txs.has(a.transactionId)) errors.push(`ligne ${a.id} : transaction inconnue`);
    sums.set(a.transactionId, (sums.get(a.transactionId) ?? 0) + a.amount);
  }
  for (const t of db.transactions) {
    if (!accounts.has(t.accountId)) errors.push(`transaction ${t.id} : compte inconnu`);
    if (!sums.has(t.id)) errors.push(`transaction ${t.id} : aucune ligne`);
    else if (sums.get(t.id) !== t.amount) errors.push(`transaction ${t.id} : ses lignes font ${sums.get(t.id)}, pas ${t.amount}`);
  }

  // 2. Une catégorie ne va qu'avec un flux qui en porte, et du bon type.
  for (const a of db.allocations) {
    if (!a.categoryId) continue;
    const c = cats.get(a.categoryId);
    if (!c) errors.push(`ligne ${a.id} : catégorie inconnue`);
    else if (a.flow === 'TRANSFER') errors.push(`ligne ${a.id} : un virement ne porte pas de catégorie`);
    else if (a.flow === 'INCOME' && c.scope !== 'INCOME') errors.push(`ligne ${a.id} : catégorie de ${c.scope} sur un revenu`);
    else if (a.flow === 'SAVING' && c.scope !== 'SAVING') errors.push(`ligne ${a.id} : catégorie de ${c.scope} sur une mise de côté`);
    else if ((a.flow === 'EXPENSE' || a.flow === 'REFUND') && c.scope !== 'EXPENSE') errors.push(`ligne ${a.id} : catégorie de ${c.scope} sur une dépense`);
  }

  // 3. Deux niveaux au plus ; une fusion pointe vers une catégorie qui existe et n'est pas elle-même fusionnée.
  for (const c of db.categories) {
    const parent = c.parentId ? cats.get(c.parentId) : undefined;
    if (c.parentId && !parent) errors.push(`catégorie ${c.id} : parente inconnue`);
    if (parent?.parentId) errors.push(`catégorie ${c.id} : plus de deux niveaux`);
    if (parent && parent.scope !== c.scope) errors.push(`catégorie ${c.id} : pas du même type que sa parente`);
    const target = c.mergedIntoId ? cats.get(c.mergedIntoId) : undefined;
    if (c.mergedIntoId && (!target || target.mergedIntoId || target.id === c.id)) errors.push(`catégorie ${c.id} : fusion invalide`);
  }

  // 4. Une catégorie dans une enveloppe au plus ; exactement une enveloppe par défaut.
  const owner = new Map<string, string>();
  for (const e of db.envelopes)
    for (const id of e.categoryIds) {
      if (owner.has(id)) errors.push(`catégorie ${id} : dans deux enveloppes (${owner.get(id)} et ${e.id})`);
      owner.set(id, e.id);
    }
  const defaults = db.envelopes.filter((e) => e.isDefault).length;
  if (defaults !== 1) errors.push(`${defaults} enveloppe(s) par défaut : il en faut exactement une`);

  // 5. Les deux jambes d'un virement : comptes différents, montants opposés (à devise égale).
  for (const a of db.allocations) {
    if ((a.flow !== 'TRANSFER' && a.flow !== 'SAVING') || !a.linkedTransactionId) continue;
    const mine = txs.get(a.transactionId);
    const other = txs.get(a.linkedTransactionId);
    if (!mine || !other) errors.push(`ligne ${a.id} : jambe de virement inconnue`);
    else if (mine.accountId === other.accountId) errors.push(`ligne ${a.id} : virement vers le même compte`);
    else if (accounts.get(mine.accountId)?.currency === accounts.get(other.accountId)?.currency && mine.amount !== -other.amount) errors.push(`ligne ${a.id} : les deux jambes ne s'annulent pas`);
  }

  // 6. Une part avancée ne dépasse pas la dépense ; un remboursement lié pointe vers une transaction connue.
  for (const a of db.allocations) {
    if (a.receivableAmount && (a.receivableAmount < 0 || a.receivableAmount > -a.amount)) errors.push(`ligne ${a.id} : part avancée hors de la dépense`);
    if (a.flow === 'REFUND' && a.linkedTransactionId && !txs.has(a.linkedTransactionId)) errors.push(`ligne ${a.id} : dépense remboursée inconnue`);
  }

  // 8. Les poches d'un compte ne dépassent pas son solde (alerte, pas blocage).
  const locked = new Map<string, number>();
  for (const p of db.provisions) {
    if (!accounts.has(p.accountId)) errors.push(`poche ${p.id} : compte inconnu`);
    if (p.amount < 0) errors.push(`poche ${p.id} : montant négatif`);
    if (p.status === 'ACTIVE') locked.set(p.accountId, (locked.get(p.accountId) ?? 0) + p.amount);
  }
  for (const [id, sum] of locked) {
    const balance = accounts.get(id)?.balance;
    if (balance !== null && balance !== undefined && sum > balance) warnings.push(`${accounts.get(id)!.name} : ${sum} en poches pour ${balance} de solde (provision non couverte)`);
  }
  return { errors, warnings };
}
