import type Anthropic from '@anthropic-ai/sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import { advance, repairHistory, requestParams, resolveApproval, userMessage, visibleText, type CreateMessage, type Msg } from '../src/assistant/agent';
import { runReadTool, type AssistantContext } from '../src/assistant/tools';
import { db } from '../src/db/db';
import { ensureSeeded } from '../src/db/seed';
import { CAT, DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../src/domain/defaults';
import { tx } from './helpers';

const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
// Les outils testés ici ne lisent que les réglages, les catégories et la base.
const ctx = { today: '2026-10-21', settings: DEFAULT_SETTINGS, cats, wealth: { accounts: [] } } as unknown as AssistantContext;

beforeAll(async () => {
  await ensureSeeded(db);
  await db.transactions.bulkPut([
    tx({ id: 'u1', date: '2026-10-20', amount: -1250, label: 'UBER EATS PARIS' }),
    tx({ id: 'u2', date: '2026-10-18', amount: -2390, label: 'UBER EATS PARIS' }),
    tx({ id: 'c1', date: '2026-10-19', amount: -4210, label: 'CARREFOUR', categoryId: CAT.courses, categorySource: 'rule' }),
  ]);
});

/** Réponses de l'API jouées dans l'ordre. */
function scripted(...responses: Partial<Anthropic.Beta.BetaMessage>[]): { create: CreateMessage; calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  let i = 0;
  return {
    calls,
    create: async (params) => {
      calls.push(structuredClone(params));
      const r = responses[i++];
      if (!r) throw new Error('plus de réponse prévue');
      return { id: `m${i}`, type: 'message', role: 'assistant', model: params.model, stop_reason: 'end_turn', content: [], ...r } as Anthropic.Beta.BetaMessage;
    },
  };
}

const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use' as const, id, name, input });
const text = (t: string) => ({ type: 'text' as const, text: t, citations: null });

describe('assistant finance', () => {
  it('requête : Opus 5.5 par défaut, cache sur le système, les outils et le dernier message, repli serveur', () => {
    const p = requestParams([userMessage('Bonjour', '2026-10-21')]);
    expect(p.model).toBe('claude-opus-5-5');
    expect(requestParams([userMessage('x', '2026-10-21')], 'fast').model).toBe('claude-sonnet-5-5');
    expect((p.system as Anthropic.Beta.BetaTextBlockParam[])[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect((p.tools!.at(-1) as { cache_control?: unknown }).cache_control).toEqual({ type: 'ephemeral' });
    const last = p.messages.at(-1)!.content as Anthropic.Beta.BetaTextBlockParam[];
    expect(last.at(-1)!.cache_control).toEqual({ type: 'ephemeral' });
    expect(p.fallbacks).toBe('default');
    expect(p.betas).toContain('server-side-fallback-2026-07-01');
    expect(p.output_config?.effort).toBe('medium');
    // Le prompt système ne change jamais (sinon le cache saute) : la date voyage dans le message.
    expect(JSON.stringify(p.system)).not.toContain('2026');
  });

  it('lit la base avec ses outils (recherche sans accents ni casse, montants en euros)', async () => {
    const r = (await runReadTool('search_transactions', { text: 'uber eats' }, ctx)) as { count: number; total: number; transactions: { id: string; amount: number }[] };
    expect(r.count).toBe(2);
    expect(r.total).toBe(-36.4);
    expect(r.transactions.map((t) => t.id)).toEqual(['u1', 'u2']);
    const todo = (await runReadTool('search_transactions', { uncategorized: true }, ctx)) as { count: number };
    expect(todo.count).toBe(2);
  });

  it('boucle : lecture immédiate, écriture en attente de validation, puis appliquée', async () => {
    const { create, calls } = scripted(
      { stop_reason: 'tool_use', content: [text('Je regarde.'), toolUse('t1', 'search_transactions', { uncategorized: true })] },
      { stop_reason: 'tool_use', content: [toolUse('t2', 'categorize_transactions', { transaction_ids: ['u1', 'u2'], category_id: CAT.livraison, keyword: 'uber eats', reason: 'Livraison de repas' })] },
      { stop_reason: 'end_turn', content: [text('C’est classé.')] },
    );
    const first = await advance([userMessage('Classe mes opérations', '2026-10-21')], create, () => ctx);
    expect(first.kind).toBe('approval');
    if (first.kind !== 'approval') return;
    // Le résultat de la lecture est reparti avant la proposition.
    const sent = calls[1]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(sent[0]!.tool_use_id).toBe('t1');
    expect(first.pending.changes[0]!.title).toContain('Livraison');
    expect((await db.transactions.get('u1'))!.categoryId).toBeNull();

    const { outcome, applied } = await resolveApproval(first.messages, first.pending, new Map([['t2', true]]), create, () => ctx);
    expect(applied[0]).toMatch(/2 opérations classées/);
    expect((await db.transactions.get('u1'))!.categoryId).toBe(CAT.livraison);
    expect((await db.rules.toArray()).some((r) => r.pattern === 'uber eats')).toBe(true);
    expect(outcome.kind).toBe('done');
    expect(visibleText(outcome.messages.at(-1)!)).toBe('C’est classé.');
    const results = calls[2]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(String(results[0]!.content)).toContain('validé');
  });

  it('refus : rien ne change ; paramètre invalide : erreur renvoyée au modèle', async () => {
    const { create, calls } = scripted(
      { stop_reason: 'tool_use', content: [toolUse('t1', 'set_category_target', { category_id: CAT.restos, target: 50, reason: 'x' }), toolUse('t2', 'set_category_target', { category_id: 'nope', target: 50, reason: 'x' })] },
      { stop_reason: 'end_turn', content: [text('D’accord.')] },
    );
    const first = await advance([userMessage('Objectif restos', '2026-10-21')], create, () => ctx);
    if (first.kind !== 'approval') throw new Error('validation attendue');
    expect(first.pending.changes).toHaveLength(1);
    expect(first.pending.ready[0]!.is_error).toBe(true);
    await resolveApproval(first.messages, first.pending, new Map([['t1', false]]), create, () => ctx);
    expect((await db.categories.get(CAT.restos))!.target).toBeNull();
    const results = calls[1]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results).toHaveLength(2);
    expect(String(results.find((r) => r.tool_use_id === 't1')!.content)).toContain('refusé');
  });

  it('historique interrompu (app fermée pendant une proposition) : réparé', () => {
    const history: Msg[] = [userMessage('x', '2026-10-21'), { role: 'assistant', content: [toolUse('t9', 'create_rule', { keyword: 'a', category_id: CAT.courses, reason: '' })] }];
    const fixed = repairHistory(history);
    expect(fixed).toHaveLength(3);
    expect((fixed[2]!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0]!.tool_use_id).toBe('t9');
  });
});
