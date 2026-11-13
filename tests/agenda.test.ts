import { beforeEach, describe, expect, it } from 'vitest';
import { eventsOn, readAgenda, writeAgenda } from '../packages/lumen/src/agenda';
import { runTool, type CopilotSources } from '../web/src/copilot';

/** Agenda commun (V4, F3) : chaque app publie ses événements, l'accueil et Copilot les lisent ensemble. */
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
});

describe('agenda commun', () => {
  it('les événements de toutes les apps, triés par jour puis heure ; une sortie de plusieurs jours compte chaque jour', () => {
    writeAgenda('finances', '2026-10-24', [
      { id: 'pay', kind: 'income', title: 'Paie', date: '2026-10-25', amount: 170000 },
      { id: 'rent', kind: 'charge', title: 'Loyer', date: '2026-11-05', amount: -25500 },
    ]);
    writeAgenda('perf', '2026-10-24', [{ id: 'p1', kind: 'session', title: 'Jambes', date: '2026-10-25', time: '18:30', url: '/perf/' }]);
    writeAgenda('home', '2026-10-24', [{ id: 's1', kind: 'sortie', title: 'Festival', date: '2026-10-24', end: '2026-10-26', url: '/sorties/s1' }]);
    const v = readAgenda('2026-10-24', '2026-10-31');
    expect(v.events.map((e) => `${e.date} ${e.title}`)).toEqual(['2026-10-24 Festival', '2026-10-25 Jambes', '2026-10-25 Paie']);
    expect(eventsOn(v.events, '2026-10-26').map((e) => e.title)).toEqual(['Festival']);
    // Montant toujours positif ; le loyer hors de la fenêtre.
    expect(readAgenda('2026-11-01', '2026-11-30').events[0]).toMatchObject({ title: 'Loyer', amount: 25500 });
  });

  it('lecture prudente ; app jamais ouverte ou agenda d’un autre jour signalés', () => {
    writeAgenda('perf', '2026-10-20', [{ id: 'p1', kind: 'session', title: 'Haut', date: 'demain' }, { id: 'p2', kind: 'bizarre' as 'session', title: 'X'.repeat(200), date: '2026-10-28', time: '25h', url: 'https://ailleurs.test' }]);
    const v = readAgenda('2026-10-24', '2026-10-31');
    expect(v.events).toEqual([{ id: 'p2', app: 'perf', kind: 'other', title: 'X'.repeat(80), date: '2026-10-28' }]);
    expect(v.sources).toEqual({ finances: null, perf: '2026-10-20', home: null });
    expect(v.stale).toEqual(['perf']);
  });

  it('Copilot lit l’agenda (montants en euros) et dit quelle app rouvrir', () => {
    writeAgenda('finances', '2026-10-24', [{ id: 'pay', kind: 'income', title: 'Paie', date: '2026-10-25', amount: 170000 }]);
    writeAgenda('perf', '2026-10-22', [{ id: 'p1', kind: 'session', title: 'Jambes', date: '2026-10-26' }, { id: 'p2', kind: 'session', title: 'Haut', date: '2026-11-20' }]);
    const src = { today: '2026-10-24' } as CopilotSources;
    const r = JSON.parse(runTool('get_agenda', { days: 7 }, src).content);
    expect(r.events.map((e: { title: string; euros?: number }) => [e.title, e.euros])).toEqual([['Paie', 1700], ['Jambes', undefined]]);
    expect(r.stale).toEqual(['perf']);
  });
});
