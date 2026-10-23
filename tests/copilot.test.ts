import { describe, expect, it } from 'vitest';
import { advance, COPILOT_MODEL, requestParams, runTool, textOf, userMessage, type CopilotSources, type Msg } from '../web/src/copilot';
import { summarizeMusic } from '../packages/lumen/src/music';
import { addManual, emptyGames } from '../packages/lumen/src/games';
import { MINI_TEMPLATES, addEntry, deleteMiniApp, emptyMiniApp } from '../packages/lumen/src/miniapp';

const TODAY = '2026-10-22';
const sources = (over: Partial<CopilotSources> = {}): CopilotSources => ({
  today: TODAY,
  stats: { perf: { v: 1, at: 1, weeks: { '2026-10-19': { sessions: 2, minutes: 120 } }, goal: 3 } },
  rest: [],
  finances: { day: TODAY, remainingToday: 23.5, dailyBudget: 25, envelope: 900, plannedSavings: 300 },
  perf: null,
  music: null,
  games: addManual(emptyGames(), { id: 'x', game: 'FIFA', day: '2026-10-20', minutes: 90 }),
  sorties: [],
  miniApps: [],
  ...over,
});

describe('Copilot : outils en lecture seule', () => {
  it('vue d’ensemble : personnage et fraîcheur des fiches', () => {
    const r = JSON.parse(runTool('get_overview', {}, sources()).content);
    expect(r.character.weekQuests[0]).toMatchObject({ quest: 'Fais 3 séances', progress: '2/3' });
    expect(r.cards).toEqual({ finances: 'aujourd’hui', training: null });
  });
  it('fiche absente : erreur explicite qui dit quelle app ouvrir', () => {
    expect(runTool('get_training', {}, sources())).toMatchObject({ isError: true, content: expect.stringMatching(/ouvre MyPerf/) });
    expect(runTool('get_music', {}, sources())).toMatchObject({ isError: true });
  });
  it('bilan, musique, jeux, temps ; période invalide refusée', () => {
    expect(JSON.parse(runTool('get_recap', { period: '2026-10-19' }, sources()).content)).toMatchObject({ sessions: 2 });
    expect(runTool('get_recap', { period: 'hier' }, sources()).isError).toBe(true);
    const { summary } = summarizeMusic([{ at: Date.parse('2026-10-01T20:00:00Z'), ms: 600_000, track: 'A', artist: 'X' }]);
    expect(JSON.parse(runTool('get_music', { period: '2026-10' }, sources({ music: summary })).content)).toMatchObject({ minutes: 10, topArtists: [{ artist: 'X', minutes: 10 }] });
    expect(JSON.parse(runTool('get_games', { weeks: 2 }, sources()).content).games[0]).toMatchObject({ game: 'FIFA', minutesInPeriod: 90 });
    expect(JSON.parse(runTool('get_time_split', { weeks: 1 }, sources()).content).minutes).toMatchObject({ sport: 120, games: 90 });
    expect(runTool('rm_everything', {}, sources()).isError).toBe(true);
  });
});

describe('Copilot : Mes apps', () => {
  it('lit les apps en service (objectif, stats, saisies avec leurs libellés), pas les supprimées', () => {
    expect(runTool('get_my_apps', {}, sources())).toMatchObject({ isError: true, content: expect.stringMatching(/Aucune app/) });
    const lecture = addEntry(emptyMiniApp('lect01', MINI_TEMPLATES[0]!), { id: 'a', day: '2026-10-21', values: { pages: 40, livre: 'Dune' } });
    const gone = deleteMiniApp(emptyMiniApp('eau001', MINI_TEMPLATES[1]!));
    const r = JSON.parse(runTool('get_my_apps', {}, sources({ miniApps: [lecture, gone] })).content);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ app: 'Lecture', goal: { value: 40, target: 150, done: false, per: 'week', field: 'Pages lues' }, entries: 1, last: [{ day: '2026-10-21', 'Pages lues': 40, Livre: 'Dune' }] });
    expect(r[0].stats[0]).toEqual({ stat: 'Pages cette semaine', value: '40 pages' });
  });
});

describe('Copilot : requête et boucle', () => {
  it('modèle, effort, repli en cas de refus, cache sur système, outils et dernier message', () => {
    const p = requestParams([userMessage('Salut', TODAY)]);
    expect(p.model).toBe(COPILOT_MODEL);
    expect(p).toMatchObject({ output_config: { effort: 'medium' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    expect((p.system as { cache_control?: unknown }[])[0]?.cache_control).toBeDefined();
    expect((p.tools![p.tools!.length - 1] as { cache_control?: unknown }).cache_control).toBeDefined();
    const last = p.messages[p.messages.length - 1]!.content as { cache_control?: unknown }[];
    expect(last[last.length - 1]?.cache_control).toBeDefined();
    expect(p.tool_choice).toBeUndefined();
  });

  it('lit avec ses outils puis répond ; les blocs de réflexion repartent tels quels', async () => {
    const calls: unknown[] = [];
    const replies = [
      { stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 't1', name: 'get_finances', input: {} }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Oui : il te reste 23,50 € aujourd’hui.' }] },
    ];
    const create = async (params: unknown) => {
      calls.push(JSON.parse(JSON.stringify(params)));
      return replies.shift() as never;
    };
    const r = await advance([userMessage('Je peux sortir ce soir ?', TODAY)], create, () => sources());
    expect(r.read).toEqual(['get_finances']);
    expect(textOf(r.messages[r.messages.length - 1] as Msg)).toMatch(/23,50/);
    const second = calls[1] as { messages: { role: string; content: { type: string; content?: string; cache_control?: unknown }[] }[] };
    const assistant = second.messages[1]!.content;
    expect(assistant[0]).toEqual({ type: 'thinking', thinking: '', signature: 'sig' });
    const toolResult = second.messages[2]!.content[0]!;
    expect(toolResult.type).toBe('tool_result');
    expect(toolResult.content).toContain('23.5');
  });

  it('refus : message clair, rien d’autre', async () => {
    const r = await advance([userMessage('…', TODAY)], async () => ({ stop_reason: 'refusal', content: [] }) as never, () => sources());
    expect(r.note).toMatch(/déclinée/);
  });
});
