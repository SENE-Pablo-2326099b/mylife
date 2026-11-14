import { applyMerchant, merchantId, merchantKey, merchantName } from './merchants';
import type { Account, Category, FinanceData, Goal, Holding, InvestmentOp, Merchant, Movement, Nature, Planned, Rhythm, Snapshot, GoalMove } from './model';
import { normalizeText } from './text';

/**
 * Reprise des données de l'ancienne app MyFinances (base locale `myfinances`) dans le modèle V5. Fonction pure et
 * rejouable : mêmes entrées, mêmes sorties, mêmes identifiants. L'ancienne base n'est jamais modifiée.
 *
 * - comptes bancaires, placements, biens et dettes → **comptes** (cinq familles) ;
 * - opérations → **mouvements** : la nature se déduit de l'ancienne catégorie (« Transferts internes » et les
 *   catégories exclues → virement ; « Épargne & investissement » → virement d'épargne ; « Entre amis » →
 *   remboursement ; catégorie de revenu → revenu ; le reste → dépense, ou remboursement si c'est une rentrée) ;
 * - libellés → **marchands**, avec la nature et la catégorie que la majorité de leurs opérations portaient ;
 * - lignes de revenus et de charges, investissements programmés, objectifs → **prévu**.
 */

// Ce qu'on lit de l'ancienne base (champs utiles seulement ; tout est défensif : une base ancienne peut en manquer).
export interface OldDump {
  transactions?: OldTx[];
  accounts?: OldAccount[];
  categories?: { id: string; name: string; color?: string; kind: 'variable' | 'fixed' | 'income' | 'excluded'; target?: number | null; order?: number }[];
  settings?: { payday?: number; incomes?: OldLine[]; fixedCharges?: OldLine[]; savings?: { mode?: 'auto' | 'manual'; manual?: number } } | null;
  portfolios?: { id: string; name: string; provider?: string; kind?: string; wrapper?: string; order?: number; createdAt?: number }[];
  holdings?: (Omit<Holding, 'accountId'> & { portfolioId: string })[];
  investmentOps?: (InvestmentOp & { planId?: string | null })[];
  plans?: { id: string; holdingId: string; amount: number; frequency: Rhythm; day: number; active: boolean; createdAt?: number }[];
  goals?: { id: string; name: string; target: number; deadline?: string | null; monthly?: number; includeInBudget?: boolean; linkKind?: 'manual' | 'account' | 'portfolio'; linkId?: string | null; achievedAt?: number | null; order?: number; createdAt?: number }[];
  goalMoves?: GoalMove[];
  manualAssets?: { id: string; name: string; kind: 'asset' | 'debt'; value: number; updatedAt?: number }[];
  snapshots?: Snapshot[];
}
interface OldLine {
  id: string;
  label: string;
  amount: number;
  day?: number | null;
  direct?: boolean;
}
interface OldTx {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  label: string;
  rawText?: string;
  pending?: boolean;
  categoryId: string | null;
  categorySource?: 'rule' | 'manual' | 'transfer' | null;
  person?: string | null;
  transferPairId?: string | null;
  note?: string;
  createdAt?: number;
  refundOf?: string | null;
}
interface OldAccount {
  id: string;
  name: string;
  bank?: string;
  iban?: string | null;
  balance?: number | null;
  balanceDate?: string | null;
  hidden?: boolean;
  kind?: 'current' | 'savings' | 'card' | 'other';
  nickname?: string | null;
}

const OLD_TRANSFER = 'transferts';
const OLD_SAVING = 'epargne';
const OLD_REFUND = 'remboursements';
export const portfolioAccountId = (id: string) => `pf:${id}`;
export const assetAccountId = (id: string) => `as:${id}`;

export function migrate(old: OldDump): FinanceData {
  const cats = new Map((old.categories ?? []).map((c) => [c.id, c]));
  const spending = (old.categories ?? []).filter((c) => c.kind === 'variable' || c.kind === 'fixed');
  const categories: Category[] = spending
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((c, order) => ({ id: c.id, name: c.name, color: c.color ?? '#94a3b8', fixed: c.kind === 'fixed', budget: c.target ?? null, order }));

  // ---- comptes
  const accounts: Account[] = [];
  (old.accounts ?? []).forEach((a, order) =>
    accounts.push({
      id: a.id,
      family: a.kind === 'savings' ? 'epargne' : 'quotidien',
      name: a.nickname?.trim() || a.name,
      provider: a.bank ?? '',
      source: 'bank',
      balance: a.balance === null || a.balance === undefined ? null : Math.max(0, a.balance),
      balanceAt: a.balanceDate ? Date.parse(a.balanceDate) || null : null,
      iban: a.iban ?? null,
      hidden: a.hidden === true,
      order,
      createdAt: 0,
    }),
  );
  (old.portfolios ?? []).forEach((p) =>
    accounts.push({ id: portfolioAccountId(p.id), family: p.kind === 'savings' ? 'epargne' : 'placements', name: p.name, provider: p.provider ?? '', source: 'manual', balance: null, balanceAt: null, wrapper: p.wrapper ?? '', hidden: false, order: 100 + (p.order ?? 0), createdAt: p.createdAt ?? 0 }),
  );
  (old.manualAssets ?? []).forEach((a, i) =>
    accounts.push({ id: assetAccountId(a.id), family: a.kind === 'debt' ? 'dettes' : 'biens', name: a.name, provider: '', source: 'manual', balance: Math.abs(a.value), balanceAt: a.updatedAt ?? null, hidden: false, order: 200 + i, createdAt: a.updatedAt ?? 0 }),
  );
  const family = new Map(accounts.map((a) => [a.id, a.family]));

  // ---- placements
  const holdings: Holding[] = (old.holdings ?? []).map(({ portfolioId, ...h }) => ({ ...h, accountId: portfolioAccountId(portfolioId) }));
  const investmentOps: InvestmentOp[] = (old.investmentOps ?? []).map(({ planId: _planId, ...o }) => o);
  // Où va un virement d'épargne : la ligne dont le mot-clé est dans le libellé, sinon le placement dont l'établissement y est.
  const destinations: { word: string; accountId: string }[] = [
    ...holdings.filter((h) => h.bankKeyword).map((h) => ({ word: normalizeText(h.bankKeyword!), accountId: h.accountId })),
    ...(old.portfolios ?? []).filter((p) => (p.provider ?? '').trim().length >= 3).map((p) => ({ word: normalizeText(p.provider!), accountId: portfolioAccountId(p.id) })),
  ].filter((d) => d.word);

  // ---- mouvements
  const txs = old.transactions ?? [];
  const pairs = new Map<string, OldTx[]>();
  for (const t of txs) if (t.transferPairId) pairs.set(t.transferPairId, [...(pairs.get(t.transferPairId) ?? []), t]);
  const manual = new Set<string>();
  const movements: Movement[] = txs.map((t) => {
    const cat = t.categoryId ? cats.get(t.categoryId) : undefined;
    let nature: Nature | null;
    let categoryId: string | null = null;
    let saving = false;
    if (t.refundOf || t.categoryId === OLD_REFUND) nature = 'remboursement';
    else if (t.categoryId === OLD_SAVING) {
      nature = 'virement';
      saving = true;
    } else if (t.categoryId === OLD_TRANSFER || cat?.kind === 'excluded') nature = 'virement';
    else if (cat?.kind === 'income') nature = 'revenu';
    else if (cat) {
      nature = t.amount > 0 ? 'remboursement' : 'depense';
      categoryId = cat.id;
    } else if (t.categoryId) {
      // Catégorie disparue : à reclasser.
      nature = t.amount < 0 ? 'depense' : null;
    } else nature = t.amount < 0 ? 'depense' : null;

    let otherAccountId: string | null = null;
    if (nature === 'virement') {
      const other = t.transferPairId ? pairs.get(t.transferPairId)?.find((x) => x.id !== t.id) : undefined;
      if (other) otherAccountId = other.accountId;
      else if (saving) {
        const text = normalizeText(`${t.label} ${t.rawText ?? ''}`);
        otherAccountId = destinations.find((d) => text.includes(d.word))?.accountId ?? null;
      }
      const to = otherAccountId ? family.get(otherAccountId) : undefined;
      if (t.amount < 0 && (to === 'epargne' || to === 'placements')) saving = true;
    }
    if (t.categorySource === 'manual') manual.add(t.id);
    const key = nature === 'virement' ? null : merchantKey(t.label);
    return {
      id: t.id,
      accountId: t.accountId,
      date: t.date,
      amount: t.amount,
      label: t.label,
      merchantId: key ? merchantId(key) : null,
      nature,
      categoryId,
      ...(nature === 'virement' ? { otherAccountId, pairId: t.transferPairId ?? null, saving } : {}),
      ...(nature === 'remboursement' ? { refundOf: t.refundOf ?? null, person: t.person ?? null } : {}),
      note: t.note ?? '',
      pending: t.pending === true,
      source: 'bank',
      edited: false,
      createdAt: t.createdAt ?? 0,
    };
  });

  // ---- marchands : ce que la majorité de leurs mouvements classés disent
  const votes = new Map<string, Map<string, number>>();
  for (const m of movements) {
    if (!m.merchantId || m.nature === null || (m.nature === 'depense' && m.categoryId === null)) continue;
    // Une rentrée chez un marchand de dépense vote pour la dépense.
    const nature = m.nature === 'remboursement' && m.categoryId ? 'depense' : m.nature;
    const v = votes.get(m.merchantId) ?? new Map<string, number>();
    const k = `${nature}|${m.categoryId ?? ''}`;
    v.set(k, (v.get(k) ?? 0) + 1);
    votes.set(m.merchantId, v);
  }
  const merchants: Merchant[] = [...new Set(movements.flatMap((m) => (m.merchantId ? [m.merchantId] : [])))].sort().map((id) => {
    const v = [...(votes.get(id) ?? [])].sort((a, b) => b[1] - a[1]);
    const total = v.reduce((s, [, n]) => s + n, 0);
    const [best, count] = v[0] ?? ['', 0];
    const clear = total > 0 && count / total >= 0.6;
    const [nature, categoryId] = best.split('|');
    return { id, name: merchantName(id.slice(2)), nature: clear ? (nature as Nature) : null, categoryId: clear && categoryId ? categoryId : null, edited: false };
  });
  const merchantById = new Map(merchants.map((m) => [m.id, m]));
  // Un mouvement qui s'écarte de son marchand est une exception voulue : il la garde. Les autres suivent le marchand.
  const settled = movements.map((m) => {
    const merchant = m.merchantId ? merchantById.get(m.merchantId) : undefined;
    const followed = applyMerchant(m, merchant);
    const differs = followed.nature !== m.nature || followed.categoryId !== m.categoryId;
    if (!differs) return m;
    const classified = m.nature !== null && !(m.nature === 'depense' && m.categoryId === null);
    return classified ? { ...m, edited: true } : followed;
  });

  // ---- prévu
  const planned: Planned[] = [];
  const manualSavings = old.settings?.savings?.mode === 'manual';
  for (const l of old.settings?.incomes ?? []) planned.push({ id: `inc:${l.id}`, kind: 'revenu', label: l.label, amount: Math.abs(l.amount), rhythm: 'monthly', day: l.day ?? null, accountId: null, direct: l.direct === true, active: true, createdAt: 0 });
  for (const l of old.settings?.fixedCharges ?? []) planned.push({ id: `chg:${l.id}`, kind: 'charge', label: l.label, amount: Math.abs(l.amount), rhythm: 'monthly', day: l.day ?? null, accountId: null, active: true, createdAt: 0 });
  const holdingById = new Map(holdings.map((h) => [h.id, h]));
  for (const p of old.plans ?? []) {
    const h = holdingById.get(p.holdingId);
    planned.push({ id: `plan:${p.id}`, kind: 'epargne', label: h?.name ?? 'Investissement programmé', amount: p.amount, rhythm: p.frequency, day: p.day, accountId: h?.accountId ?? null, holdingId: p.holdingId, active: p.active && !manualSavings, createdAt: p.createdAt ?? 0 });
  }
  const goalAccount = (g: NonNullable<OldDump['goals']>[number]) => (g.linkKind === 'account' ? (g.linkId ?? null) : g.linkKind === 'portfolio' && g.linkId ? portfolioAccountId(g.linkId) : null);
  const goals: Goal[] = (old.goals ?? []).map((g) => ({ id: g.id, name: g.name, target: g.target, deadline: g.deadline ?? null, accountId: goalAccount(g), achievedAt: g.achievedAt ?? null, order: g.order ?? 0, createdAt: g.createdAt ?? 0 }));
  for (const g of old.goals ?? []) {
    if (!g.monthly || g.monthly <= 0 || g.includeInBudget === false || g.achievedAt) continue;
    planned.push({ id: `goal:${g.id}`, kind: 'epargne', label: g.name, amount: g.monthly, rhythm: 'monthly', day: null, accountId: goalAccount(g), goalId: g.id, active: !manualSavings, createdAt: g.createdAt ?? 0 });
  }
  if (manualSavings && (old.settings?.savings?.manual ?? 0) > 0) planned.push({ id: 'sav:manual', kind: 'epargne', label: 'Épargne', amount: old.settings!.savings!.manual!, rhythm: 'monthly', day: null, accountId: null, active: true, createdAt: 0 });

  return {
    accounts,
    movements: settled,
    merchants,
    categories,
    planned,
    holdings,
    investmentOps,
    goals,
    goalMoves: old.goalMoves ?? [],
    snapshots: old.snapshots ?? [],
    settings: { payday: Math.max(1, Math.min(31, Math.trunc(old.settings?.payday ?? 1))) },
  };
}

/**
 * Rejouer la reprise sans perdre ce qui a été fait dans le nouveau module : les mouvements saisis à la main, ceux
 * corrigés un par un, les marchands classés, les catégories et les lignes prévues modifiées restent ; le reste
 * (soldes, nouvelles opérations de la banque) vient de la reprise.
 */
export function mergeImport(existing: FinanceData, fresh: FinanceData): FinanceData {
  const keep = <T extends { id: string }>(mine: readonly T[], theirs: readonly T[]) => {
    const ids = new Set(mine.map((x) => x.id));
    return [...mine, ...theirs.filter((x) => !ids.has(x.id))];
  };
  const editedMerchants = new Map(existing.merchants.filter((m) => m.edited).map((m) => [m.id, m]));
  const merchants = fresh.merchants.map((m) => editedMerchants.get(m.id) ?? m);
  for (const m of editedMerchants.values()) if (!merchants.some((x) => x.id === m.id)) merchants.push(m);
  const merchantById = new Map(merchants.map((m) => [m.id, m]));
  const mine = new Map(existing.movements.map((m) => [m.id, m]));
  const freshIds = new Set(fresh.movements.map((m) => m.id));
  const movements = [
    ...fresh.movements.map((m) => {
      const old = mine.get(m.id);
      if (old?.edited) return { ...m, nature: old.nature, categoryId: old.categoryId, split: old.split, refundOf: old.refundOf ?? m.refundOf, note: old.note, edited: true };
      const merchant = m.merchantId ? merchantById.get(m.merchantId) : undefined;
      return merchant?.edited ? applyMerchant({ ...m, edited: false }, merchant) : m;
    }),
    ...existing.movements.filter((m) => m.source === 'manual' && !freshIds.has(m.id)),
  ];
  const accountIds = new Set(fresh.accounts.map((a) => a.id));
  return {
    ...fresh,
    movements,
    merchants,
    accounts: [...fresh.accounts, ...existing.accounts.filter((a) => a.id.startsWith('n:') && !accountIds.has(a.id))],
    categories: existing.categories.length ? keep(existing.categories, fresh.categories) : fresh.categories,
    planned: existing.planned.length ? keep(existing.planned, fresh.planned) : fresh.planned,
  };
}
