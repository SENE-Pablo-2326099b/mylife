import { describe, expect, it } from 'vitest';
import { advance, COPILOT_MODEL, requestParams, runTool, textOf, userMessage, type CopilotSources, type Msg } from '../web/src/copilot';

const TODAY = '2026-10-22';
const sources = (over: Partial<CopilotSources> = {}): CopilotSources => ({
  today: TODAY,
  finances: { day: TODAY, remainingToday: 23.5, dailyBudget: 25, envelope: 900, plannedSavings: 300 },
  perf: null,
  sorties: [],
  ...over,
});

describe('Copilot : outils en lecture seule', () => {
  it('vue d’ensemble : fraîcheur des fiches et sorties', () => {
    const r = JSON.parse(runTool('get_overview', {}, sources()).content);
    expect(r).toEqual({ today: TODAY, cards: { finances: 'aujourd’hui', training: null }, sorties: 0 });
  });
  it('fiche absente : erreur explicite qui dit quelle app ouvrir', () => {
    expect(runTool('get_training', {}, sources())).toMatchObject({ isError: true, content: expect.stringMatching(/ouvre MyPerf/) });
    expect(JSON.parse(runTool('get_finances', {}, sources()).content)).toMatchObject({ remainingToday: 23.5 });
  });
  it('les outils des fonctions retirées en V5 n’existent plus', () => {
    for (const name of ['get_recap', 'get_music', 'get_games', 'get_time_split', 'get_my_apps', 'get_objectives', 'get_kitchen', 'rm_everything']) expect(runTool(name, {}, sources()).isError, name).toBe(true);
    const names = (requestParams([userMessage('Salut', TODAY)]).tools ?? []).map((t) => (t as { name: string }).name);
    expect(names).toEqual(['get_overview', 'get_finances', 'get_training', 'get_agenda', 'propose_action', 'list_sorties']);
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
    // Le modèle choisi (Sonnet 5.5) passe tel quel, avec le même effort et le même repli.
    expect(requestParams([userMessage('Salut', TODAY)], 'claude-sonnet-5-5')).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'medium' }, fallbacks: 'default' });
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
