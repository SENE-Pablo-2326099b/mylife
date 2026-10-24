import { Platform } from 'react-native';

import { ACTIONS_EVENT, ACTIONS_KEY, runPendingActions, type ActionSpec, type MyLifeAction } from '@/vendor/lumen';
import { getPlanned, movePlanned } from '@/db/repos/planning';

/**
 * Boîte d'envoi de MyPerf (actions validées, V4 F1) : ce que tu as validé dans Copilot (accueil MyLife), exécuté ici avec
 * le code de MyPerf. Web seulement : la boîte est dans le stockage de l'adresse MyLife ; l'app Android ne la voit pas.
 */
const fr = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

export async function executePerfAction(a: MyLifeAction): Promise<ActionSpec | null> {
  if (a.kind !== 'perf.movePlanned') throw new Error(`Action inconnue de MyPerf : ${a.kind}`);
  const id = String(a.params.plannedId);
  const date = String(a.params.date);
  const planned = getPlanned(id);
  if (!planned) throw new Error('Cette séance prévue n’existe plus.');
  if (planned.workoutId) throw new Error('Cette séance est déjà commencée ou faite.');
  const from = planned.date;
  movePlanned(id, date);
  return { kind: 'perf.movePlanned', params: { plannedId: id, date: from }, summary: `Remettre « ${planned.title} » au ${fr(from)}` };
}

let started = false;
let busy = false;

async function run(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await runPendingActions('perf', executePerfAction);
  } finally {
    busy = false;
  }
}

/** À lancer une fois la base prête : exécute ce qui attend, puis à chaque nouvelle action validée. */
export function startActionInbox(): void {
  if (started || Platform.OS !== 'web' || typeof window === 'undefined') return;
  started = true;
  void run();
  window.addEventListener('storage', (e) => e.key === ACTIONS_KEY && void run());
  window.addEventListener(ACTIONS_EVENT, () => void run());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void run());
}
