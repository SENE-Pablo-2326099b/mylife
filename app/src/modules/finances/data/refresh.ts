import { compute } from '../engine/engine';
import { fromV3 } from '../engine/fromV3';
import { applyState, roll } from '../engine/state';
import { dropForeign } from './cloud';
import { importOld } from './importOld';
import { publish } from './publish';
import { readState } from './stateStore';

/** Recalcule le budget du jour sans ouvrir le module, et redépose l'aperçu (pour la carte de l'accueil). */
export async function refreshGlance(today: string): Promise<void> {
  await dropForeign();
  const state = await readState();
  if (!state) return;
  const { data } = await importOld();
  if (data.accounts.length === 0 && !state.accounts?.length) return;
  const base = fromV3(data);
  const db = applyState(base, roll(state, base, today));
  publish(db, compute(db, today));
}
