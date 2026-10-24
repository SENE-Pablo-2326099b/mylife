import { describe, expect, it } from 'vitest';
import type { MyLifeAction } from '../src/vendor/lumen';
import { executeFinancesAction } from '../src/domain/actionExec';
import type { RecurringItem, RecurringSkip } from '../src/domain/recurringList';

/** Actions validées dans Copilot, exécutées par MyFinances (V4, F1). */
const item = (over: Partial<RecurringItem>): RecurringItem =>
  ({ id: 'plan:btc', kind: 'savings', label: 'Investissement · Bitcoin', amount: 10000, monthly: 10000, cadence: 'monthly', day: 3, source: 'plan', detected: null, confirmed: true, direct: false, categoryId: null, nextDate: null, paid: null, skipped: false, ...over }) as RecurringItem;
const action = (params: Record<string, unknown>): MyLifeAction => ({ id: 'a1', app: 'finances', kind: 'finances.skipRecurring', summary: 'x', params, createdAt: 0, status: 'pending' });
const ctx = { items: [item({}), item({ id: 'line:paie', kind: 'income', label: 'Paie' })], cycle: { start: '2026-09-25', end: '2026-10-24' } };

describe('MyFinances exécute les actions validées', () => {
  it('saute un récurrent pour le cycle en cours, et rend l’action qui le remet', async () => {
    const calls: [string, RecurringSkip, boolean][] = [];
    const r = await executeFinancesAction(action({ itemId: 'plan:btc', skip: true }), ctx, async (c, s, on) => void calls.push([c, s, on]));
    expect(calls).toEqual([['2026-09-25', { id: 'plan:btc', kind: 'savings', amount: 10000 }, true]]);
    expect(r.undo).toMatchObject({ kind: 'finances.skipRecurring', params: { itemId: 'plan:btc', skip: false } });
  });
  it('refuse un récurrent disparu ou un revenu', async () => {
    const noop = async () => {};
    await expect(executeFinancesAction(action({ itemId: 'plan:inconnu', skip: true }), ctx, noop)).rejects.toThrow(/n’existe plus/);
    await expect(executeFinancesAction(action({ itemId: 'line:paie', skip: true }), ctx, noop)).rejects.toThrow(/revenu/);
  });
});
