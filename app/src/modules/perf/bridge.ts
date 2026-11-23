import { ACTIONS_EVENT, ACTIONS_KEY, runPendingActions, writeAgenda, writeCopilotCard, writeGlance, type ActionSpec, type MyLifeAction } from '@mylife/lumen';
import { call } from './data/client';
import type { HomeCard } from './data/bridge';
import { dropForeign } from './data/cloud';

/**
 * MyPerf et le reste de MyLife (maquette V3-Accueil) : l'aperçu de la carte d'accueil, la fiche de Copilot Sport et les
 * séances de l'agenda commun, déposés sur l'appareil ; les actions « décaler » validées dans Copilot, exécutées ici.
 * Toujours après avoir écarté les données d'un autre compte (`dropForeign`) : rien d'un compte précédent ne fuit.
 */
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** Dépose l'aperçu, la fiche et l'agenda ; rend la carte d'accueil. */
export async function publishPerf(): Promise<HomeCard | null> {
  await dropForeign();
  const day = today();
  const [card, copilot, agenda] = await Promise.all([call('homeCard', day), call('copilotCard', day), call('agendaEvents', day)]);
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  writeGlance('perf', card ? { title: card.title, detail: [card.kicker, card.detail].filter(Boolean).join(' · '), until: midnight.getTime() } : null);
  writeCopilotCard('perf', copilot);
  writeAgenda('perf', day, agenda);
  return card;
}

async function execute(a: MyLifeAction): Promise<ActionSpec | null> {
  if (a.kind !== 'perf.moveSession') throw new Error(`Action inconnue de MyPerf : ${a.kind}`);
  const r = await call('executeMove', String(a.params.plannedId), String(a.params.date));
  void publishPerf();
  return { kind: 'perf.moveSession', params: r.undo, summary: r.summary };
}

let started = false;
let busy = false;
async function run() {
  if (busy) return;
  busy = true;
  try {
    await dropForeign();
    await runPendingActions('sport', execute);
  } finally {
    busy = false;
  }
}

/** Une fois par visite : exécute ce qui attend, puis chaque nouvelle action validée. */
export function startPerfInbox(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void run();
  window.addEventListener('storage', (e) => e.key === ACTIONS_KEY && void run());
  window.addEventListener(ACTIONS_EVENT, () => void run());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void run());
}
