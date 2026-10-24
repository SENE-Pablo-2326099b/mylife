import { beforeEach, describe, expect, it } from 'vitest';
import { enqueueAction, parseActionSpec, pendingActions, readActions, runPendingActions, settleAction } from '../packages/lumen/src/actions';
import { addEntry, emptyMiniApp, MINI_TEMPLATES } from '../packages/lumen/src/miniapp';
import { advance, userMessage, type CopilotSources } from '../web/src/copilot';
import { runHomeActions } from '../web/src/actionsHome';
import { runChefActions } from '../web/src/actionsChef';
import { plan, shopping } from '../web/src/myChefData';
import { readMiniApps, saveMiniApp } from '../web/src/ui/stats';

/** Actions validées (V4, F1) : Copilot propose, l'utilisateur valide, l'app exécute ; tout est annulable. */
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
  (globalThis as unknown as { window: EventTarget }).window = new EventTarget();
});

describe('format et boîte d’envoi', () => {
  it('chaque action est vérifiée de près ; une action inconnue ou incomplète est refusée avec une explication', () => {
    expect(parseActionSpec({ kind: 'finances.skipRecurring', summary: 'Sauter le BTC', params: { itemId: 'plan:btc', skip: true } }).action).toBeDefined();
    expect(parseActionSpec({ kind: 'finances.skipRecurring', summary: 'x', params: { itemId: 'plan:btc' } }).error).toMatch(/skip/);
    expect(parseActionSpec({ kind: 'perf.movePlanned', summary: 'x', params: { plannedId: 'p1', date: 'demain' } }).error).toMatch(/AAAA-MM-JJ/);
    expect(parseActionSpec({ kind: 'finances.virement', summary: 'x', params: {} }).error).toMatch(/inconnue/);
    expect(parseActionSpec({ kind: 'miniapp.addEntry', params: { appId: 'lect01', day: '2026-10-24', values: {} } }).error).toMatch(/summary/);
    // Valeurs : seulement des identifiants de champ et des valeurs simples, bornées.
    const a = parseActionSpec({ kind: 'miniapp.addEntry', summary: 'Noter', params: { appId: 'lect01', day: '2026-10-24', values: { pages: 30, '../x': 1, obj: { a: 1 } } } }).action!;
    expect(a.params.values).toEqual({ pages: 30 });
  });

  it('validée → en attente de son app → faite (avec son annulation) ou échouée (avec la raison)', async () => {
    enqueueAction({ kind: 'perf.movePlanned', summary: 'Décaler jambes', params: { plannedId: 'p1', date: '2026-10-26' } }, 'a1');
    enqueueAction({ kind: 'perf.movePlanned', summary: 'Décaler haut', params: { plannedId: 'p2', date: '2026-10-27' } }, 'a2');
    expect(pendingActions('perf').map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(pendingActions('finances')).toEqual([]);
    const n = await runPendingActions('perf', async (a) => {
      if (a.id === 'a2') throw new Error('Séance déjà faite.');
      return { kind: 'perf.movePlanned', summary: 'Remettre', params: { plannedId: 'p1', date: '2026-10-25' } };
    });
    expect(n).toBe(2);
    const [a1, a2] = readActions();
    expect(a1).toMatchObject({ status: 'done', undo: { params: { date: '2026-10-25' } } });
    expect(a2).toMatchObject({ status: 'failed', error: 'Séance déjà faite.' });
    expect(pendingActions('perf')).toEqual([]);
    settleAction('inconnue', { ok: true, undo: null });
    expect(readActions()).toHaveLength(2);
  });
});

describe('Copilot propose, ne fait rien', () => {
  const sources = (): CopilotSources => ({ today: '2026-10-24', stats: {}, rest: [], finances: null, perf: null, music: null, games: null, sorties: [], miniApps: [] });
  it('une proposition valable devient une carte à valider (rien dans la boîte) ; une proposition invalide est renvoyée à Claude', async () => {
    const replies = [
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tu1', name: 'propose_action', input: { kind: 'finances.skipRecurring', summary: 'Sauter le plan Bitcoin ce mois', params: { itemId: 'plan:btc', skip: true } } },
          { type: 'tool_use', id: 'tu2', name: 'propose_action', input: { kind: 'finances.virement', summary: 'Virer 100 €', params: {} } },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Je te propose de sauter le BTC ce mois : valide la carte.' }] },
    ];
    const calls: { messages: { content: unknown }[] }[] = [];
    const r = await advance([userMessage('Saute le BTC ce mois', '2026-10-24')], async (p) => (calls.push(JSON.parse(JSON.stringify(p))), replies.shift() as never), sources);
    expect(r.proposals).toEqual([{ id: 'tu1', action: { kind: 'finances.skipRecurring', summary: 'Sauter le plan Bitcoin ce mois', params: { itemId: 'plan:btc', skip: true } } }]);
    expect(readActions()).toEqual([]);
    const results = calls[1]!.messages[2]!.content as { tool_use_id: string; is_error?: boolean; content: string }[];
    expect(results.find((x) => x.tool_use_id === 'tu1')).toMatchObject({ content: expect.stringMatching(/attend sa validation/) });
    expect(results.find((x) => x.tool_use_id === 'tu2')).toMatchObject({ is_error: true });
  });
});

describe('l’accueil exécute « Mes apps », et l’annulation défait', () => {
  it('saisie notée après validation, puis retirée par l’annulation', async () => {
    saveMiniApp(addEntry(emptyMiniApp('lect01', MINI_TEMPLATES[0]!), { id: 'x', day: '2026-10-23', values: { pages: 5 } }));
    enqueueAction({ kind: 'miniapp.addEntry', summary: 'Noter 30 pages', params: { appId: 'lect01', day: '2026-10-24', values: { pages: 30 } } }, 'h1');
    await runHomeActions();
    expect(readMiniApps().lect01!.entries.map((e) => [e.day, e.values.pages])).toEqual([
      ['2026-10-23', 5],
      ['2026-10-24', 30],
    ]);
    const done = readActions().find((a) => a.id === 'h1')!;
    expect(done.status).toBe('done');
    enqueueAction(done.undo!, 'h1:annule');
    await runHomeActions();
    expect(readMiniApps().lect01!.entries.map((e) => e.day)).toEqual(['2026-10-23']);
    // Une valeur refusée par l'app (note sur 5 à 9) : l'action échoue avec la raison de l'app.
    enqueueAction({ kind: 'miniapp.addEntry', summary: 'x', params: { appId: 'lect01', day: '2026-10-24', values: { pages: 'beaucoup' } } }, 'h2');
    await runHomeActions();
    expect(readActions().find((a) => a.id === 'h2')).toMatchObject({ status: 'failed', error: expect.stringMatching(/nombre/) });
  });
});

describe('MyChef exécute ses actions (liste, repas), et l’annulation défait', () => {
  it('ajouter à la liste puis retirer ; prévoir un repas puis revenir à l’état d’avant', async () => {
    expect(parseActionSpec({ kind: 'chef.planMeal', summary: 'x', params: { day: '2026-10-26', slot: 'goûter', recipeId: 'fournie-1' } }).error).toMatch(/slot/);
    enqueueAction({ kind: 'chef.addToList', summary: 'Ajouter des œufs', params: { name: 'oeufs', qty: 6 } }, 'c1');
    await runChefActions();
    expect(shopping.get('oeuf')).toMatchObject({ name: 'Œufs', qty: 6, aisle: 'frais' });
    const add = readActions().find((a) => a.id === 'c1')!;
    expect(add.undo).toMatchObject({ kind: 'chef.removeFromList', params: { itemId: 'oeuf' } });
    // Déjà sur la liste : l'action échoue, avec la raison.
    enqueueAction({ kind: 'chef.addToList', summary: 'x', params: { name: 'Œufs' } }, 'c2');
    await runChefActions();
    expect(readActions().find((a) => a.id === 'c2')).toMatchObject({ status: 'failed', error: expect.stringMatching(/déjà sur la liste/) });
    enqueueAction(add.undo!, 'c1:annule');
    await runChefActions();
    expect(shopping.get('oeuf')).toBeNull();

    enqueueAction({ kind: 'chef.planMeal', summary: 'Omelette lundi soir', params: { day: '2026-10-26', slot: 'soir', recipeId: 'fournie-1' } }, 'c3');
    await runChefActions();
    expect(plan.get('2026-10-26-soir')).toMatchObject({ title: 'Omelette', recipeId: 'fournie-1' });
    enqueueAction(readActions().find((a) => a.id === 'c3')!.undo!, 'c3:annule');
    await runChefActions();
    expect(plan.get('2026-10-26-soir')).toBeNull();
  });
});

