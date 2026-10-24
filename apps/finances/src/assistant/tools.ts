/**
 * Les mains de l'assistant sur l'app. Les outils de lecture répondent depuis la base locale et les
 * calculs déjà affichés à l'écran (budget du jour, patrimoine, indépendance) ; les outils d'écriture
 * n'agissent jamais directement : ils décrivent un changement, l'utilisateur le valide dans la
 * conversation, puis `apply` l'exécute.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/db';
import { updateSettings } from '../db/seed';
import type { Category, CategoryKind, Goal, Settings, Transaction } from '../db/types';
import type { Alert } from '../domain/alerts';
import { isSpending, type BudgetState } from '../domain/budget';
import { classifyTransactions, setManualCategory } from '../domain/classifyDb';
import { computeEnvelope, plannedSavings, totalFixed, totalIncome } from '../domain/defaults';
import type { FireState } from '../domain/fire';
import { newRule } from '../domain/learn';
import type { Recurring } from '../domain/recurring';
import { validatePattern } from '../domain/rules';
import type { WealthData } from '../domain/useWealth';
import { refreshPlannedSavings } from '../domain/wealthDb';
import { formatShort, type ISODate } from '../lib/dates';
import { normalizeText, uid } from '../lib/text';

/** Ce que l'écran a déjà calculé : l'assistant lit exactement les mêmes chiffres que l'utilisateur. */
export interface AssistantContext {
  today: ISODate;
  settings: Settings;
  cats: ReadonlyMap<string, Category>;
  budget: BudgetState;
  wealth: WealthData;
  recurring: readonly Recurring[];
  alerts: readonly Alert[];
  fire: FireState;
}

type Input = Record<string, unknown>;

export class ToolInputError extends Error {}

// ---------------------------------------------------------------- lecture des paramètres

function str(input: Input, key: string, required = true): string | undefined {
  const v = input[key];
  if (v === undefined || v === null || (!required && v === '')) {
    if (required) throw new ToolInputError(`Paramètre « ${key} » manquant`);
    return undefined;
  }
  if (typeof v !== 'string' || v.trim() === '') throw new ToolInputError(`« ${key} » doit être un texte`);
  return v.trim();
}

function num(input: Input, key: string, min: number, max: number, required = false): number | undefined {
  const v = input[key];
  if (v === undefined || v === null) {
    if (required) throw new ToolInputError(`Paramètre « ${key} » manquant`);
    return undefined;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ToolInputError(`« ${key} » doit être un nombre`);
  if (v < min || v > max) throw new ToolInputError(`« ${key} » doit être entre ${min} et ${max}`);
  return v;
}

function date(input: Input, key: string, required = false): ISODate | undefined {
  const v = str(input, key, required);
  if (v !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ToolInputError(`« ${key} » doit être une date AAAA-MM-JJ`);
  return v;
}

/** Montant en euros → centimes. */
function cents(input: Input, key: string, min: number, max: number, required = false): number | undefined {
  const v = num(input, key, min, max, required);
  return v === undefined ? undefined : Math.round(v * 100);
}

/** Centimes → euros (nombre), pour les réponses. */
const eur = (c: number | null | undefined) => (c === null || c === undefined ? null : Math.round(c) / 100);
const fmt = (c: number) => `${(c / 100).toLocaleString('fr-FR', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;

function category(ctx: AssistantContext, id: string): Category {
  const c = ctx.cats.get(id);
  if (!c) throw new ToolInputError(`Catégorie inconnue : ${id} (liste : get_categories)`);
  return c;
}

const catName = (ctx: AssistantContext, id: string | null) => (id ? (ctx.cats.get(id)?.name ?? id) : 'À classer');

// ---------------------------------------------------------------- définitions

const reason = { type: 'string', description: 'Pourquoi ce changement, en une phrase (montré à l’utilisateur).' } as const;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, properties, required });

export const ASSISTANT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'get_overview',
    description: 'Vue d’ensemble : réglages du budget (paie, revenus, charges fixes, épargne prévue), comptes et soldes, budget du jour et du cycle, patrimoine net, opérations à classer, alertes. À lire en premier.',
    input_schema: obj({}),
  },
  {
    name: 'get_categories',
    description: 'Catégories : id, nom, type (variable = vie courante, fixed = charge fixe, income = revenu, excluded = hors budget : virements, épargne) et objectif de dépense par cycle.',
    input_schema: obj({}),
  },
  {
    name: 'search_transactions',
    description: 'Cherche des opérations bancaires. Montants en euros, négatifs = dépenses. Renvoie le nombre total, la somme et les opérations (les plus récentes d’abord).',
    input_schema: obj({
      from: { type: 'string', description: 'Date de début AAAA-MM-JJ (incluse).' },
      to: { type: 'string', description: 'Date de fin AAAA-MM-JJ (incluse).' },
      category_id: { type: 'string' },
      uncategorized: { type: 'boolean', description: 'Seulement les opérations à classer.' },
      text: { type: 'string', description: 'Texte cherché dans le libellé (sans accents ni casse).' },
      direction: { type: 'string', enum: ['debit', 'credit'] },
      min_amount: { type: 'number', description: 'Montant absolu minimal en euros.' },
      max_amount: { type: 'number', description: 'Montant absolu maximal en euros.' },
      limit: { type: 'integer', description: 'Nombre maximal d’opérations renvoyées (défaut 40, max 200).' },
    }),
  },
  {
    name: 'spending_summary',
    description: 'Dépenses réelles (hors revenus, virements internes et épargne) sur une période, regroupées par catégorie, par mois ou par commerçant.',
    input_schema: obj(
      {
        from: { type: 'string', description: 'AAAA-MM-JJ' },
        to: { type: 'string', description: 'AAAA-MM-JJ' },
        group_by: { type: 'string', enum: ['category', 'month', 'merchant'] },
      },
      ['from', 'to', 'group_by'],
    ),
  },
  {
    name: 'get_budget_cycle',
    description: 'Détail du cycle budgétaire en cours (de paie à paie) : enveloppe vie courante et son calcul, dépensé, budget du jour, projection de fin de cycle, charges fixes payées ou à venir, dépenses par catégorie face à leurs objectifs.',
    input_schema: obj({}),
  },
  {
    name: 'get_recurring',
    description: 'Dépenses et revenus récurrents détectés (abonnements, loyer, salaire…) : montant habituel, coût mensuel, prochaine date.',
    input_schema: obj({}),
  },
  {
    name: 'get_wealth',
    description: 'Patrimoine : placements (enveloppe, valeur, investi, plus-value, lignes), plans d’investissement programmés, objectifs d’épargne et leur avancement, biens et dettes, patrimoine net.',
    input_schema: obj({}),
  },
  {
    name: 'get_fire',
    description: 'Indépendance financière : capital pris en compte, train de vie visé, capital nécessaire, date estimée au rythme actuel, hypothèses (rendement, inflation, frais, taux de retrait, impôt sur les retraits).',
    input_schema: obj({}),
  },
  {
    name: 'get_rules',
    description: 'Règles de classement automatique (mot-clé → catégorie).',
    input_schema: obj({ text: { type: 'string', description: 'Filtre facultatif sur le mot-clé ou le libellé.' } }),
  },
  // ------------------------------------------------------------ écriture (validées par l'utilisateur)
  {
    name: 'categorize_transactions',
    description: 'Classe des opérations dans une catégorie. Avec `keyword`, crée aussi une règle (mot-clé → catégorie) appliquée à tout l’historique et aux opérations futures. Soumis à validation.',
    input_schema: obj(
      {
        transaction_ids: { type: 'array', items: { type: 'string' }, description: 'Identifiants (search_transactions), 100 au plus.' },
        category_id: { type: 'string' },
        keyword: { type: 'string', description: 'Facultatif : mot-clé du libellé pour une règle durable.' },
        reason,
      },
      ['transaction_ids', 'category_id', 'reason'],
    ),
  },
  {
    name: 'create_rule',
    description: 'Crée une règle de classement (mot-clé du libellé → catégorie), appliquée aussitôt à l’historique. Soumis à validation.',
    input_schema: obj(
      {
        keyword: { type: 'string' },
        category_id: { type: 'string' },
        direction: { type: 'string', enum: ['any', 'debit', 'credit'] },
        reason,
      },
      ['keyword', 'category_id', 'reason'],
    ),
  },
  {
    name: 'update_rule',
    description: 'Change la catégorie d’une règle ou l’active / la désactive, puis reclasse l’historique. Soumis à validation.',
    input_schema: obj({ rule_id: { type: 'string' }, category_id: { type: 'string' }, enabled: { type: 'boolean' }, reason }, ['rule_id', 'reason']),
  },
  {
    name: 'set_category_target',
    description: 'Fixe (ou retire avec null) l’objectif de dépense par cycle d’une catégorie, en euros. Soumis à validation.',
    input_schema: obj({ category_id: { type: 'string' }, target: { type: ['number', 'null'], description: 'Euros par cycle, ou null.' }, reason }, ['category_id', 'target', 'reason']),
  },
  {
    name: 'create_category',
    description: 'Crée une catégorie. Soumis à validation.',
    input_schema: obj(
      {
        name: { type: 'string' },
        emoji: { type: 'string' },
        kind: { type: 'string', enum: ['variable', 'fixed', 'income', 'excluded'] },
        target: { type: 'number', description: 'Objectif par cycle en euros (facultatif).' },
        reason,
      },
      ['name', 'kind', 'reason'],
    ),
  },
  {
    name: 'set_transaction_note',
    description: 'Ajoute ou remplace la note d’une opération. Soumis à validation.',
    input_schema: obj({ transaction_id: { type: 'string' }, note: { type: 'string' }, reason }, ['transaction_id', 'note', 'reason']),
  },
  {
    name: 'create_goal',
    description: 'Crée un objectif d’épargne (montant, versement mensuel prévu, échéance facultative). Le versement compte dans l’épargne du budget. Soumis à validation.',
    input_schema: obj(
      {
        name: { type: 'string' },
        emoji: { type: 'string' },
        target: { type: 'number', description: 'Euros.' },
        monthly: { type: 'number', description: 'Versement mensuel prévu, euros.' },
        deadline: { type: 'string', description: 'AAAA-MM-JJ, facultatif.' },
        reason,
      },
      ['name', 'target', 'monthly', 'reason'],
    ),
  },
  {
    name: 'update_goal',
    description: 'Modifie un objectif d’épargne existant (montant, versement mensuel, échéance). Soumis à validation.',
    input_schema: obj(
      {
        goal_id: { type: 'string' },
        target: { type: 'number' },
        monthly: { type: 'number' },
        deadline: { type: ['string', 'null'], description: 'AAAA-MM-JJ, ou null pour retirer l’échéance.' },
        reason,
      },
      ['goal_id', 'reason'],
    ),
  },
  {
    name: 'update_budget_settings',
    description: 'Modifie les réglages du budget : jour de paie, épargne mensuelle prévue (passe en montant saisi), enveloppe vie courante forcée (null = calculée). Soumis à validation.',
    input_schema: obj(
      {
        payday: { type: 'integer', description: '1 à 31.' },
        monthly_savings: { type: 'number', description: 'Euros par mois.' },
        envelope_override: { type: ['number', 'null'], description: 'Euros par cycle, ou null.' },
        reason,
      },
      ['reason'],
    ),
  },
  {
    name: 'set_fire_assumptions',
    description: 'Modifie les hypothèses de l’indépendance financière (pourcentages annuels) et le train de vie visé (euros par mois, null = dépenses réelles). Soumis à validation.',
    input_schema: obj(
      {
        annual_return: { type: 'number', description: '% par an, ex. 5.' },
        inflation: { type: 'number' },
        fees: { type: 'number' },
        withdrawal_rate: { type: 'number', description: '% par an, ex. 3.5.' },
        target_monthly_spending: { type: ['number', 'null'] },
        reason,
      },
      ['reason'],
    ),
  },
];

export const WRITE_TOOL_NAMES = new Set([
  'categorize_transactions',
  'create_rule',
  'update_rule',
  'set_category_target',
  'create_category',
  'set_transaction_note',
  'create_goal',
  'update_goal',
  'update_budget_settings',
  'set_fire_assumptions',
]);

// ---------------------------------------------------------------- lecture

function txView(ctx: AssistantContext, t: Transaction, accounts: ReadonlyMap<string, string>) {
  return {
    id: t.id,
    date: t.date,
    label: t.label,
    amount: eur(t.amount),
    category_id: t.categoryId,
    category: catName(ctx, t.categoryId),
    account: accounts.get(t.accountId) ?? t.accountId,
    ...(t.pending ? { pending: true } : {}),
    ...(t.note ? { note: t.note } : {}),
  };
}

export async function runReadTool(name: string, input: Input, ctx: AssistantContext): Promise<unknown> {
  const { settings: s, budget: b, wealth: w } = ctx;
  const accountNames = new Map(w.accounts.map((a) => [a.id, a.nickname ?? `${a.name} (${a.bank})`]));
  switch (name) {
    case 'get_overview': {
      const toClassify = await db.transactions.filter((t) => t.categoryId === null).count();
      return {
        today: ctx.today,
        first_name: s.firstName || null,
        payday: s.payday,
        incomes: s.incomes.map((l) => ({ label: l.label, monthly: eur(l.amount), day: l.day })),
        fixed_charges: s.fixedCharges.map((l) => ({ label: l.label, monthly: eur(l.amount), day: l.day })),
        monthly_income_total: eur(totalIncome(s)),
        monthly_fixed_total: eur(totalFixed(s)),
        planned_monthly_savings: eur(plannedSavings(s)),
        savings_mode: s.savings.mode === 'manual' ? 'montant saisi' : 'calculé (plans + objectifs)',
        envelope_per_cycle: eur(computeEnvelope(s)),
        accounts: w.accounts.filter((a) => !a.hidden).map((a) => ({ id: a.id, name: accountNames.get(a.id), kind: a.kind ?? 'current', balance: eur(a.balance), last_sync: a.lastSyncAt ? new Date(a.lastSyncAt).toISOString() : null })),
        today_budget: { daily_budget: eur(b.dailyBudget), remaining_today: eur(b.remainingToday), spent_today: eur(b.spentToday), status: b.status, limited_by: b.limitedBy },
        cycle: { start: b.cycle.start, end: b.cycle.end, days_left: b.daysLeft, envelope: eur(b.envelope.total), remaining: eur(b.remainingCycle), projected_end: eur(b.projection.projectedEnd) },
        net_worth: eur(w.worth.total),
        transactions_to_classify: toClassify,
        alerts: ctx.alerts.map((a) => ({ level: a.level, title: a.title, detail: a.detail })),
      };
    }
    case 'get_categories':
      return [...ctx.cats.values()].map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, kind: c.kind, target_per_cycle: eur(c.target) }));
    case 'search_transactions': {
      const from = date(input, 'from');
      const to = date(input, 'to');
      const catId = str(input, 'category_id', false);
      const text = str(input, 'text', false);
      const direction = str(input, 'direction', false);
      const min = cents(input, 'min_amount', 0, 1e9);
      const max = cents(input, 'max_amount', 0, 1e9);
      const limit = Math.round(num(input, 'limit', 1, 200) ?? 40);
      const needle = text ? normalizeText(text) : null;
      let coll = db.transactions.orderBy('date').reverse();
      if (from || to) coll = db.transactions.where('date').between(from ?? '0000-00-00', to ?? '9999-99-99', true, true).reverse();
      const all = await coll
        .filter(
          (t) =>
            (input.uncategorized !== true || t.categoryId === null) &&
            (!catId || t.categoryId === catId) &&
            (!direction || (direction === 'debit' ? t.amount < 0 : t.amount > 0)) &&
            (min === undefined || Math.abs(t.amount) >= min) &&
            (max === undefined || Math.abs(t.amount) <= max) &&
            (!needle || normalizeText(`${t.label} ${t.rawText}`).includes(needle)),
        )
        .toArray();
      return { count: all.length, total: eur(all.reduce((sum, t) => sum + t.amount, 0)), shown: Math.min(limit, all.length), transactions: all.slice(0, limit).map((t) => txView(ctx, t, accountNames)) };
    }
    case 'spending_summary': {
      const from = date(input, 'from', true)!;
      const to = date(input, 'to', true)!;
      const by = str(input, 'group_by') ?? 'category';
      const txs = (await db.transactions.where('date').between(from, to, true, true).toArray()).filter((t) => isSpending(t, ctx.cats as Map<string, Category>));
      const groups = new Map<string, number>();
      for (const t of txs) {
        const key = by === 'month' ? t.date.slice(0, 7) : by === 'merchant' ? t.label : catName(ctx, t.categoryId);
        groups.set(key, (groups.get(key) ?? 0) - t.amount);
      }
      const rows = [...groups].sort((a, z) => (by === 'month' ? a[0].localeCompare(z[0]) : z[1] - a[1])).slice(0, 60);
      return { from, to, total_spent: eur(rows.reduce((sum, r) => sum + r[1], 0)), groups: rows.map(([key, v]) => ({ key, spent: eur(v) })) };
    }
    case 'get_budget_cycle': {
      const inCycle = await db.transactions.where('date').between(b.cycle.start, b.cycle.end, true, true).toArray();
      const byCat = new Map<string, number>();
      for (const t of inCycle) if (isSpending(t, ctx.cats as Map<string, Category>)) byCat.set(t.categoryId ?? '_', (byCat.get(t.categoryId ?? '_') ?? 0) - t.amount);
      return {
        cycle: { start: b.cycle.start, end: b.cycle.end, days_left: b.daysLeft, days_elapsed: b.daysElapsed, pay_arrived_early_by_days: b.cycle.earlyBy },
        envelope: { total: eur(b.envelope.total), income: eur(b.envelope.income), fixed: eur(b.envelope.fixed), savings: eur(b.envelope.savings), exceptional: eur(b.envelope.exceptional) },
        spent_variable_before_today: eur(b.spentBefore),
        spent_today: eur(b.spentToday),
        daily_budget: eur(b.dailyBudget),
        next_daily_budget: eur(b.nextDailyBudget),
        remaining_cycle: eur(b.remainingCycle),
        limited_by: b.limitedBy,
        savings_this_cycle: { planned: eur(b.envelope.savingsDetail.planned), already_saved: eur(b.envelope.savingsDetail.done), still_reserved: eur(b.reservedSavings), declared_complete: b.envelope.savingsDetail.closed },
        real_free_until_payday: b.realFree === null ? null : eur(b.realFree),
        envelope_overrun: b.overrun ? { amount: eur(b.overrun.deficit), covered_by_free_money: b.overrun.covered !== null } : null,
        cash_at_cycle_start: b.cash?.atStart == null ? null : eur(b.cash.atStart),
        reserved_until_payday: b.upcoming.map((u) => ({ label: u.label, amount: eur(u.amount), date: u.undated ? null : u.date, savings: u.savings === true })),
        projection: { pace_per_day: eur(b.projection.pace), projected_end: eur(b.projection.projectedEnd), gap_vs_ideal: eur(b.projection.gap) },
        unallocated_exceptional_income: eur(b.unallocated),
        fixed_charges: b.charges.map((c) => ({ label: c.line.label, amount: eur(c.line.amount), paid: c.paidBy !== null, paid_on: c.paidBy?.date ?? null })),
        by_category: [...byCat]
          .sort((x, y) => y[1] - x[1])
          .map(([id, v]) => ({ category: catName(ctx, id === '_' ? null : id), category_id: id === '_' ? null : id, spent: eur(v), target: eur(ctx.cats.get(id)?.target ?? null) })),
      };
    }
    case 'get_recurring':
      return ctx.recurring.map((r) => ({ label: r.label, kind: r.kind, category: catName(ctx, r.categoryId), cadence: r.cadence, usual_amount: eur(r.amount), monthly: eur(r.monthly), last: r.lastDate, next: r.nextDate }));
    case 'get_wealth':
      return {
        net_worth: eur(w.worth.total),
        breakdown: { cash: eur(w.worth.cash), investments: eur(w.worth.investments), other_assets: eur(w.worth.other), debts: eur(w.worth.debts) },
        portfolios: w.summaries.map((p) => ({
          id: p.portfolio.id,
          name: p.portfolio.name,
          wrapper: p.portfolio.wrapper,
          value: eur(p.value),
          invested: eur(p.invested),
          gain: eur(p.gain),
          holdings: p.positions.map((h) => ({ name: h.holding.name, value: eur(h.value), gain: eur(h.gain) })),
        })),
        plans: w.plans.filter((p) => p.active).map((p) => ({ holding: w.holdings.find((h) => h.id === p.holdingId)?.name ?? p.holdingId, amount: eur(p.amount), frequency: p.frequency })),
        goals: w.goalsProgress.map((g) => ({ id: g.goal.id, name: g.goal.name, target: eur(g.goal.target), saved: eur(g.saved), monthly: eur(g.goal.monthly), deadline: g.goal.deadline, status: g.status, required_monthly: eur(g.requiredMonthly) })),
        assets_and_debts: w.assets.map((a) => ({ name: a.name, kind: a.kind, value: eur(a.value) })),
      };
    case 'get_fire': {
      const f = ctx.fire;
      const year = f.months === null ? null : new Date(new Date().getFullYear(), new Date().getMonth() + f.months, 1).getFullYear();
      return {
        capital_counted: eur(f.current),
        target_monthly_spending: eur(f.annualSpending / 12),
        spending_source: f.spendingAuto ? 'dépenses réelles des 12 derniers mois' : 'montant choisi',
        capital_needed: eur(f.target),
        progress_pct: Math.round(f.progress * 1000) / 10,
        monthly_investing_now: eur(f.monthly),
        reached_in_year: year,
        assumptions: {
          annual_return_pct: s.fire.annualReturnBp / 100,
          inflation_pct: s.fire.inflationBp / 100,
          fees_pct: s.fire.feesBp / 100,
          withdrawal_rate_pct: s.fire.withdrawalBp / 100,
          real_net_return_pct: Math.round(f.realRate * 10000) / 100,
          withdrawal_tax_pct: Math.round(f.tax * 1000) / 10,
        },
      };
    }
    case 'get_rules': {
      const text = str(input, 'text', false);
      const needle = text ? normalizeText(text) : null;
      const rules = await db.rules.toArray();
      return rules
        .filter((r) => !needle || normalizeText(`${r.pattern} ${r.label}`).includes(needle))
        .slice(0, 150)
        .map((r) => ({ id: r.id, keyword: r.pattern, label: r.label, category: catName(ctx, r.categoryId), category_id: r.categoryId, enabled: r.enabled }));
    }
    default:
      throw new ToolInputError(`Outil inconnu : ${name}`);
  }
}

// ---------------------------------------------------------------- écriture

export interface AssistantChange {
  title: string;
  details: string[];
  reason: string;
  apply: () => Promise<string>;
}

const KINDS: Record<CategoryKind, string> = { variable: 'vie courante', fixed: 'charge fixe', income: 'revenu', excluded: 'hors budget' };

export async function prepareChange(name: string, input: Input, ctx: AssistantContext): Promise<AssistantChange> {
  const why = str(input, 'reason', false) ?? '';
  switch (name) {
    case 'categorize_transactions': {
      const ids = input.transaction_ids;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every((x): x is string => typeof x === 'string')) throw new ToolInputError('transaction_ids : 1 à 100 identifiants');
      const cat = category(ctx, str(input, 'category_id')!);
      const keyword = str(input, 'keyword', false);
      if (keyword && validatePattern(keyword, false)) throw new ToolInputError(validatePattern(keyword, false)!);
      const txs = (await db.transactions.bulkGet(ids)).filter((t): t is Transaction => t !== undefined);
      if (txs.length === 0) throw new ToolInputError('Aucune de ces opérations n’existe');
      const shown = txs.slice(0, 5).map((t) => `${formatShort(t.date)} · ${t.label} · ${fmt(t.amount)}`);
      return {
        title: `Classer ${txs.length} opération${txs.length > 1 ? 's' : ''} en ${cat.emoji} ${cat.name}`,
        details: [...shown, ...(txs.length > 5 ? [`… et ${txs.length - 5} autre${txs.length - 5 > 1 ? 's' : ''}`] : []), ...(keyword ? [`Règle durable : « ${keyword} » → ${cat.name}`] : [])],
        reason: why,
        apply: async () => {
          for (const t of txs) await setManualCategory(t.id, cat.id);
          let more = 0;
          if (keyword) {
            await db.rules.put(newRule({ categoryId: cat.id, pattern: keyword }));
            more = (await classifyTransactions()).changed;
          }
          return `${txs.length} opération${txs.length > 1 ? 's' : ''} classée${txs.length > 1 ? 's' : ''} en ${cat.name}${more ? `, ${more} autre${more > 1 ? 's' : ''} par la nouvelle règle` : ''}`;
        },
      };
    }
    case 'create_rule': {
      const keyword = str(input, 'keyword')!;
      const problem = validatePattern(keyword, false);
      if (problem) throw new ToolInputError(problem);
      const cat = category(ctx, str(input, 'category_id')!);
      const direction = (str(input, 'direction', false) ?? 'any') as 'any' | 'debit' | 'credit';
      if (!['any', 'debit', 'credit'].includes(direction)) throw new ToolInputError('direction : any, debit ou credit');
      return {
        title: `Règle « ${keyword} » → ${cat.emoji} ${cat.name}`,
        details: [direction === 'any' ? 'Débits et crédits' : direction === 'debit' ? 'Débits seulement' : 'Crédits seulement', 'Appliquée à l’historique et aux opérations futures'],
        reason: why,
        apply: async () => {
          await db.rules.put(newRule({ categoryId: cat.id, pattern: keyword, direction }));
          const { changed } = await classifyTransactions();
          return `Règle créée : « ${keyword} » → ${cat.name} (${changed} opération${changed > 1 ? 's' : ''} reclassée${changed > 1 ? 's' : ''})`;
        },
      };
    }
    case 'update_rule': {
      const rule = await db.rules.get(str(input, 'rule_id')!);
      if (!rule) throw new ToolInputError('Règle inconnue (get_rules)');
      const catId = str(input, 'category_id', false);
      const cat = catId ? category(ctx, catId) : null;
      const enabled = typeof input.enabled === 'boolean' ? input.enabled : undefined;
      if (!cat && enabled === undefined) throw new ToolInputError('Aucun changement demandé');
      return {
        title: `Règle « ${rule.pattern} »`,
        details: [...(cat ? [`${catName(ctx, rule.categoryId)} → ${cat.name}`] : []), ...(enabled !== undefined ? [enabled ? 'Activée' : 'Désactivée'] : [])],
        reason: why,
        apply: async () => {
          await db.rules.put({ ...rule, categoryId: cat?.id ?? rule.categoryId, enabled: enabled ?? rule.enabled });
          const { changed } = await classifyTransactions();
          return `Règle « ${rule.pattern} » modifiée (${changed} opération${changed > 1 ? 's' : ''} reclassée${changed > 1 ? 's' : ''})`;
        },
      };
    }
    case 'set_category_target': {
      const cat = category(ctx, str(input, 'category_id')!);
      const target = input.target === null ? null : (cents(input, 'target', 0, 1e7, true) ?? null);
      return {
        title: `Objectif ${cat.emoji} ${cat.name}`,
        details: [`${cat.target === null ? 'aucun' : `${fmt(cat.target)}/cycle`} → ${target === null ? 'aucun' : `${fmt(target)}/cycle`}`],
        reason: why,
        apply: async () => {
          await db.categories.update(cat.id, { target });
          return `Objectif de ${cat.name} : ${target === null ? 'retiré' : `${fmt(target)} par cycle`}`;
        },
      };
    }
    case 'create_category': {
      const catName = str(input, 'name')!;
      const kind = str(input, 'kind') as CategoryKind;
      if (!(kind in KINDS)) throw new ToolInputError('kind : variable, fixed, income ou excluded');
      const emoji = str(input, 'emoji', false) ?? '🏷️';
      const target = cents(input, 'target', 0, 1e7) ?? null;
      if ([...ctx.cats.values()].some((c) => normalizeText(c.name) === normalizeText(catName))) throw new ToolInputError('Une catégorie porte déjà ce nom');
      return {
        title: `Nouvelle catégorie ${emoji} ${catName}`,
        details: [`Type : ${KINDS[kind]}`, ...(target !== null ? [`Objectif : ${fmt(target)}/cycle`] : [])],
        reason: why,
        apply: async () => {
          const order = Math.max(0, ...[...ctx.cats.values()].map((c) => c.order)) + 1;
          const id = uid('c');
          await db.categories.put({ id, name: catName, emoji, color: '#94A3B8', kind, target, isFood: false, order });
          return `Catégorie créée : ${emoji} ${catName} (id ${id})`;
        },
      };
    }
    case 'set_transaction_note': {
      const tx = await db.transactions.get(str(input, 'transaction_id')!);
      if (!tx) throw new ToolInputError('Opération inconnue');
      const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '';
      return {
        title: `Note sur « ${tx.label} » (${formatShort(tx.date)}, ${fmt(tx.amount)})`,
        details: [note ? `« ${note} »` : 'Note retirée'],
        reason: why,
        apply: async () => {
          await db.transactions.update(tx.id, { note });
          return `Note ${note ? 'ajoutée' : 'retirée'} : ${tx.label}`;
        },
      };
    }
    case 'create_goal': {
      const goalName = str(input, 'name')!;
      const target = cents(input, 'target', 1, 1e9, true)!;
      const monthly = cents(input, 'monthly', 0, 1e8, true)!;
      const deadline = date(input, 'deadline') ?? null;
      const emoji = str(input, 'emoji', false) ?? '🎯';
      return {
        title: `Nouvel objectif ${emoji} ${goalName}`,
        details: [`${fmt(target)}${deadline ? ` pour le ${deadline}` : ''}`, `${fmt(monthly)} par mois, comptés dans l’épargne du budget`],
        reason: why,
        apply: async () => {
          const goal: Goal = { id: uid('g'), name: goalName, emoji, target, deadline, monthly, includeInBudget: true, linkKind: 'manual', linkId: null, achievedAt: null, order: ctx.wealth.goals.length, createdAt: Date.now() };
          await db.goals.put(goal);
          await refreshPlannedSavings();
          return `Objectif créé : ${goalName}`;
        },
      };
    }
    case 'update_goal': {
      const goal = await db.goals.get(str(input, 'goal_id')!);
      if (!goal) throw new ToolInputError('Objectif inconnu (get_wealth)');
      const target = cents(input, 'target', 1, 1e9);
      const monthly = cents(input, 'monthly', 0, 1e8);
      const deadline = input.deadline === null ? null : date(input, 'deadline');
      const lines = [
        ...(target !== undefined ? [`Montant : ${fmt(goal.target)} → ${fmt(target)}`] : []),
        ...(monthly !== undefined ? [`Versement : ${fmt(goal.monthly)}/mois → ${fmt(monthly)}/mois`] : []),
        ...(deadline !== undefined ? [`Échéance : ${goal.deadline ?? 'aucune'} → ${deadline ?? 'aucune'}`] : []),
      ];
      if (lines.length === 0) throw new ToolInputError('Aucun changement demandé');
      return {
        title: `Objectif ${goal.emoji} ${goal.name}`,
        details: lines,
        reason: why,
        apply: async () => {
          await db.goals.update(goal.id, { ...(target !== undefined ? { target } : {}), ...(monthly !== undefined ? { monthly } : {}), ...(deadline !== undefined ? { deadline } : {}) });
          await refreshPlannedSavings();
          return `Objectif ${goal.name} modifié`;
        },
      };
    }
    case 'update_budget_settings': {
      const s = ctx.settings;
      const payday = num(input, 'payday', 1, 31);
      if (payday !== undefined && !Number.isInteger(payday)) throw new ToolInputError('payday doit être un entier');
      const savings = cents(input, 'monthly_savings', 0, 1e8);
      const envelope = input.envelope_override === null ? null : cents(input, 'envelope_override', 0, 1e8);
      const lines = [
        ...(payday !== undefined ? [`Jour de paie : ${s.payday} → ${payday}`] : []),
        ...(savings !== undefined ? [`Épargne prévue : ${fmt(plannedSavings(s))} → ${fmt(savings)}/mois`] : []),
        ...(envelope !== undefined ? [`Enveloppe vie courante : ${s.envelopeOverride === null ? 'calculée' : fmt(s.envelopeOverride)} → ${envelope === null ? 'calculée' : fmt(envelope)}`] : []),
      ];
      if (lines.length === 0) throw new ToolInputError('Aucun changement demandé');
      return {
        title: 'Réglages du budget',
        details: lines,
        reason: why,
        apply: async () => {
          await updateSettings({
            ...(payday !== undefined ? { payday } : {}),
            ...(savings !== undefined ? { savings: { mode: 'manual' as const, manual: savings } } : {}),
            ...(envelope !== undefined ? { envelopeOverride: envelope } : {}),
          });
          return 'Réglages du budget modifiés';
        },
      };
    }
    case 'set_fire_assumptions': {
      const f = ctx.settings.fire;
      const pctBp = (key: string, min: number, max: number) => {
        const v = num(input, key, min, max);
        return v === undefined ? undefined : Math.round(v * 100);
      };
      const annualReturnBp = pctBp('annual_return', 0, 15);
      const inflationBp = pctBp('inflation', 0, 10);
      const feesBp = pctBp('fees', 0, 3);
      const withdrawalBp = pctBp('withdrawal_rate', 2, 6);
      const spending = input.target_monthly_spending === null ? null : cents(input, 'target_monthly_spending', 0, 1e7);
      const p = (bp: number) => `${(bp / 100).toLocaleString('fr-FR')} %`;
      const lines = [
        ...(annualReturnBp !== undefined ? [`Rendement : ${p(f.annualReturnBp)} → ${p(annualReturnBp)}`] : []),
        ...(inflationBp !== undefined ? [`Inflation : ${p(f.inflationBp)} → ${p(inflationBp)}`] : []),
        ...(feesBp !== undefined ? [`Frais : ${p(f.feesBp)} → ${p(feesBp)}`] : []),
        ...(withdrawalBp !== undefined ? [`Taux de retrait : ${p(f.withdrawalBp)} → ${p(withdrawalBp)}`] : []),
        ...(spending !== undefined ? [`Train de vie visé : ${spending === null ? 'dépenses réelles' : `${fmt(spending)}/mois`}`] : []),
      ];
      if (lines.length === 0) throw new ToolInputError('Aucun changement demandé');
      return {
        title: 'Hypothèses de l’indépendance financière',
        details: lines,
        reason: why,
        apply: async () => {
          await updateSettings({
            fire: {
              ...f,
              ...(annualReturnBp !== undefined ? { annualReturnBp } : {}),
              ...(inflationBp !== undefined ? { inflationBp } : {}),
              ...(feesBp !== undefined ? { feesBp } : {}),
              ...(withdrawalBp !== undefined ? { withdrawalBp } : {}),
              ...(spending !== undefined ? { annualSpendingOverride: spending === null ? null : spending * 12 } : {}),
            },
          });
          return 'Hypothèses modifiées';
        },
      };
    }
    default:
      throw new ToolInputError(`Outil d’écriture inconnu : ${name}`);
  }
}
