import { writeAgenda, writeCopilotCard, writeGlance, type ActionSpec, type MyLifeAction } from '@mylife/lumen';
import { euros } from '../core/format';
import type { Explanation } from '../engine/engine';
import type { Db } from '../engine/schema';
import { decideOccurrence, type EngineState } from '../engine/state';

/**
 * Ce que MyFinances dépose sur l'appareil pour le reste de MyLife, à chaque calcul : l'aperçu de l'accueil, la fiche
 * de contexte de Copilot (en euros) et les échéances à venir pour l'agenda commun. Jamais synchronisé ni envoyé ;
 * effacé si un autre compte se connecte.
 */
const eur = (cents: number) => Math.round(cents) / 100;
const KIND = { INCOME: 'income', CHARGE: 'charge', SAVING: 'savings', INSTALLMENT: 'charge' } as const;

export function copilotCard(db: Db, e: Explanation): Record<string, unknown> {
  const open = e.occurrences.filter((o) => o.status === 'DUE' || o.status === 'PARTIAL');
  return {
    day: e.today,
    remainingToday: eur(e.resteAujourdhui),
    dailyBudget: eur(e.budgetJour),
    nextDailyBudget: eur(e.demain),
    status: e.deficit > 0 ? 'bad' : e.resteAujourdhui <= 0 ? 'warn' : 'good',
    cycle: { start: e.cycle.start, end: e.cycle.end, daysLeft: e.daysLeft },
    envelope: eur(e.pot),
    spentThisCycle: eur(e.spent),
    remainingCycle: eur(e.resteEnveloppe),
    plannedSavings: eur(e.epargne),
    realFree: eur(e.cashLibre),
    limitedBy: e.limitedBy,
    overrun: e.deficit > 0 ? eur(e.deficit) : null,
    upcoming: open
      .filter((o) => o.commitment.kind !== 'INCOME' && o.dueDate >= e.today)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 6)
      .map((o) => ({ date: o.dueDate, label: o.commitment.label, amount: eur(o.remaining) })),
    // Les engagements du cycle, avec leur identifiant : Copilot peut proposer d'en sauter un (action validée).
    recurring: e.occurrences.slice(0, 40).map((o) => ({ id: o.commitment.id, label: o.commitment.label, kind: KIND[o.commitment.kind] ?? 'charge', amount: eur(o.expected), nextDate: o.dueDate, paidThisCycle: o.status === 'PAID', skippedThisCycle: o.status === 'SKIPPED' })),
    toClassify: db.allocations.filter((a) => a.flow === null || (a.flow === 'EXPENSE' && a.categoryId === null)).length,
  };
}

export function publish(db: Db, e: Explanation): void {
  const end = new Date(`${e.today}T23:59:59`).getTime();
  writeGlance('finances', {
    title: `${euros(Math.max(0, e.resteAujourdhui), { round: true })} à dépenser aujourd’hui`,
    detail: e.deficit > 0 ? `Dépassé de ${euros(e.deficit, { round: true })}` : `${e.daysLeft} jour${e.daysLeft > 1 ? 's' : ''} avant la paie`,
    tone: e.deficit > 0 ? 'danger' : e.resteAujourdhui <= 0 ? 'warning' : 'success',
    until: end,
  });
  writeCopilotCard('finances', copilotCard(db, e));
  writeAgenda(
    'finances',
    e.today,
    e.occurrences
      .filter((o) => (o.status === 'DUE' || o.status === 'PARTIAL') && o.dueDate >= e.today && !o.commitment.direct)
      .map((o) => ({ id: o.id, kind: KIND[o.commitment.kind] ?? 'other', title: o.commitment.label, date: o.dueDate, amount: o.commitment.kind === 'INCOME' ? o.expected : o.remaining, url: '/argent/plan' })),
  );
}

/**
 * Une action validée dans Copilot (« sauter un récurrent ce mois ») : le changement à faire aux réglages, et l'action
 * qui l'annule. Une action inconnue ou sans objet est refusée, avec la raison.
 */
export function actionChange(a: MyLifeAction, e: Explanation): { change: (s: EngineState) => EngineState; undo: ActionSpec } {
  if (a.kind !== 'finances.skipRecurring') throw new Error(`Action inconnue de MyFinances : ${a.kind}`);
  const o = e.occurrences.find((x) => x.commitment.id === a.params.itemId && x.status !== 'PAID') ?? e.occurrences.find((x) => x.commitment.id === a.params.itemId);
  if (!o) throw new Error('Cet engagement n’a pas d’échéance dans ce cycle.');
  if (o.commitment.kind === 'INCOME') throw new Error('Un revenu ne se saute pas.');
  if (o.status === 'PAID') throw new Error('Cette échéance est déjà réglée.');
  const skip = a.params.skip === true;
  return {
    change: (s) => decideOccurrence(s, o.id, skip ? { id: o.id, status: 'SKIPPED', transactionId: null } : null),
    undo: { kind: 'finances.skipRecurring', params: { itemId: o.commitment.id, skip: !skip }, summary: skip ? `Attendre de nouveau « ${o.commitment.label} » ce cycle` : `Sauter « ${o.commitment.label} » ce cycle` },
  };
}
