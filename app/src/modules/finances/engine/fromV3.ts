import { accountValue } from '../core/budget';
import type { AccountFamily, FinanceData, Movement } from '../core/model';
import { DEFAULT_SETTINGS, roleDefaults, type Account, type Allocation, type Commitment, type Db, type Envelope, type Flow, type Rhythm, type Role } from './schema';

/**
 * Du modèle de l'étape 3.3 (`FinanceData`, lui-même repris de l'ancienne app) au schéma du moteur. Fonction pure et
 * rejouable. Rien de ce qui suit n'est une règle du moteur : ce sont des réglages de départ, tous modifiables.
 * - familles de comptes → rôles et drapeaux ;
 * - mouvements → transactions (le fait) et allocations (l'interprétation, une ligne par part ventilée) ;
 * - catégories « fixes » de l'ancienne app → une enveloppe « Charges fixes » hors budget quotidien ;
 * - catégories avec un budget → une enveloppe plafonnée chacune, dans le quotidien ;
 * - lignes prévues → engagements ; le plus gros revenu ouvre le cycle.
 */
const ROLE: Record<AccountFamily, Role> = { quotidien: 'CHECKING', epargne: 'SAVINGS', placements: 'INVESTMENT', biens: 'ASSET', dettes: 'LIABILITY' };
const RHYTHM = { weekly: 'WEEKLY', biweekly: 'BIWEEKLY', monthly: 'MONTHLY' } as const satisfies Record<string, Rhythm>;
const KIND = { revenu: 'INCOME', charge: 'CHARGE', epargne: 'SAVING' } as const;

function flowOf(m: Movement): Flow | null {
  if (m.nature === 'depense') return 'EXPENSE';
  if (m.nature === 'revenu') return 'INCOME';
  if (m.nature === 'remboursement') return 'REFUND';
  if (m.nature === 'virement') return m.saving ? 'SAVING' : 'TRANSFER';
  return null;
}

export function fromV3(data: FinanceData): Db {
  const accounts: Account[] = data.accounts.map((a) => {
    const role = ROLE[a.family];
    return { id: a.id, name: a.name, provider: a.provider, role, ...roleDefaults(role), currency: 'EUR', ownershipRatio: 1, alertThreshold: null, deferredDebit: null, source: a.source, balance: a.family === 'placements' ? accountValue(a, data) : a.balance, balanceAt: a.balanceAt, archivedAt: a.hidden ? 1 : null };
  });
  const account = new Map(accounts.map((a) => [a.id, a]));
  // L'autre jambe d'un virement : la transaction du même appariement, sur un autre compte.
  const byPair = new Map<string, Movement[]>();
  for (const m of data.movements) if (m.pairId) byPair.set(m.pairId, [...(byPair.get(m.pairId) ?? []), m]);

  const allocations: Allocation[] = [];
  const transactions = data.movements.map((m) => {
    const flow = flowOf(m);
    const other = m.pairId ? byPair.get(m.pairId)?.find((x) => x.id !== m.id && x.accountId !== m.accountId && x.amount === -m.amount) : undefined;
    const base = { transactionId: m.id, flow, tagIds: [], origin: m.edited ? ('manual' as const) : ('import' as const), note: m.note };
    const linkedTransactionId = flow === 'REFUND' ? (m.refundOf ?? null) : (other?.id ?? null);
    if (flow === 'EXPENSE' && m.split?.length && m.split.reduce((s, p) => s + p.amount, 0) === m.amount)
      m.split.forEach((p, i) => allocations.push({ ...base, id: `${m.id}#${i}`, amount: p.amount, categoryId: p.categoryId }));
    else allocations.push({ ...base, id: `${m.id}#0`, amount: m.amount, categoryId: flow === 'EXPENSE' || flow === 'REFUND' ? m.categoryId : null, linkedTransactionId });
    return { id: m.id, accountId: m.accountId, date: m.date, valueDate: null, amount: m.amount, rawLabel: m.label, pending: m.pending, source: m.source, merchantId: m.merchantId, createdAt: m.createdAt };
  });

  const categories = data.categories.map((c) => ({ id: c.id, parentId: null, scope: 'EXPENSE' as const, name: c.name, color: c.color, order: c.order, archivedAt: null, mergedIntoId: null }));
  const envelope = (id: string, name: string, over: Partial<Envelope>): Envelope => ({ id, name, cap: null, inDailyBudget: true, endPolicy: 'RESET', overspendPolicy: 'DEDUCT_NEXT', isDefault: false, order: 0, categoryIds: [], ...over });
  const fixed = data.categories.filter((c) => c.fixed).map((c) => c.id);
  const envelopes: Envelope[] = [
    envelope('env:default', 'Quotidien', { isDefault: true }),
    ...(fixed.length ? [envelope('env:fixed', 'Charges fixes', { inDailyBudget: false, order: 1, categoryIds: fixed })] : []),
    ...data.categories.filter((c) => !c.fixed && c.budget !== null && c.budget > 0).map((c, i) => envelope(`env:${c.id}`, c.name, { cap: c.budget, order: 2 + i, categoryIds: [c.id] })),
  ];

  const commitments: Commitment[] = data.planned.map((p) => ({
    id: p.id,
    kind: KIND[p.kind],
    label: p.label,
    amount: p.amount,
    tolerance: 0.2,
    rhythm: RHYTHM[p.rhythm],
    anchorDay: p.day,
    anchorDate: null,
    // Une ligne de l'ancienne app ne dit pas de quel compte elle part : n'importe quel compte du quotidien.
    accountId: p.kind === 'epargne' ? null : p.accountId && account.get(p.accountId)?.includeInDailyCash ? p.accountId : null,
    counterAccountId: p.kind === 'epargne' ? p.accountId : null,
    categoryId: null,
    startDate: null,
    endDate: null,
    remainingOccurrences: null,
    installmentPlanId: null,
    direct: p.direct === true,
    paused: !p.active,
  }));
  const opening = commitments.filter((c) => c.kind === 'INCOME' && !c.direct && !c.paused).sort((a, b) => b.amount - a.amount)[0];

  return {
    accounts,
    transactions,
    allocations,
    categories,
    tags: [],
    envelopes,
    commitments,
    occurrenceOverrides: [],
    installmentPlans: [],
    provisions: [],
    receivables: [],
    carryIn: { global: 0, envelopes: {} },
    fx: {},
    settings: { ...DEFAULT_SETTINGS, payday: data.settings.payday, openingCommitmentId: opening?.id ?? null },
  };
}
