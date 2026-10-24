import type { ActionSpec, MyLifeAction } from '../vendor/lumen';
import type { Cycle } from '../lib/dates';
import type { RecurringItem, RecurringSkip } from './recurringList';

/**
 * Exécution des actions validées dans Copilot qui concernent MyFinances (V4, F1). Pure : la liste des récurrents, le
 * cycle et l'écriture des sauts sont fournis (components/ActionInbox.tsx). Renvoie l'action qui annule celle-ci.
 */
export async function executeFinancesAction(
  a: MyLifeAction,
  ctx: { items: readonly RecurringItem[]; cycle: Cycle },
  setSkip: (cycleStart: string, skip: RecurringSkip, on: boolean) => Promise<void>,
): Promise<{ undo: ActionSpec; message: string }> {
  if (a.kind !== 'finances.skipRecurring') throw new Error(`Action inconnue de MyFinances : ${a.kind}`);
  const item = ctx.items.find((i) => i.id === a.params.itemId);
  if (!item) throw new Error('Ce récurrent n’existe plus dans MyFinances.');
  if (item.kind === 'income') throw new Error('Un revenu ne se saute pas.');
  const skip = a.params.skip === true;
  await setSkip(ctx.cycle.start, { id: item.id, kind: item.kind, amount: item.monthly }, skip);
  return {
    undo: { kind: 'finances.skipRecurring', params: { itemId: item.id, skip: !skip }, summary: skip ? `Attendre de nouveau « ${item.label} » ce mois` : `Sauter « ${item.label} » ce mois` },
    message: skip ? `${item.label} sauté jusqu’à la paie (validé dans Copilot)` : `${item.label} attendu de nouveau ce mois (validé dans Copilot)`,
  };
}
