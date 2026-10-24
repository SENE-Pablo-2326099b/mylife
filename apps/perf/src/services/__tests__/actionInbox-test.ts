import { createTestDb } from '@/db/__tests__/testDb';
import { addPlanned, getPlanned } from '@/db/repos/planning';
import { createTemplate } from '@/db/repos/templates';
import { startWorkout } from '@/services/workoutService';

import { executePerfAction } from '../actionInbox';

const action = (params: Record<string, unknown>) => ({ id: 'a1', app: 'perf' as const, kind: 'perf.movePlanned' as const, summary: 'x', params, createdAt: 0, status: 'pending' as const });

describe('MyPerf exécute les actions validées (décaler une séance prévue)', () => {
  let tpl = '';
  beforeEach(() => {
    createTestDb();
    tpl = createTemplate('Jambes');
  });

  it('décale la séance, et rend l’action qui la remet à sa date', async () => {
    const id = addPlanned('2026-10-24', tpl, 'Jambes');
    const undo = await executePerfAction(action({ plannedId: id, date: '2026-10-26' }));
    expect(getPlanned(id)?.date).toBe('2026-10-26');
    expect(undo).toMatchObject({ kind: 'perf.movePlanned', params: { plannedId: id, date: '2026-10-24' } });
    await executePerfAction(action(undo!.params));
    expect(getPlanned(id)?.date).toBe('2026-10-24');
  });

  it('refuse une séance disparue ou déjà commencée', async () => {
    await expect(executePerfAction(action({ plannedId: 'nope', date: '2026-10-26' }))).rejects.toThrow(/n’existe plus/);
    const id = addPlanned('2026-10-24', tpl, 'Jambes');
    startWorkout({ date: '2026-10-24', templateId: tpl, plannedId: id });
    await expect(executePerfAction(action({ plannedId: id, date: '2026-10-26' }))).rejects.toThrow(/déjà commencée/);
  });
});
