import { describe, expect, it } from 'vitest';
import { compact, DOMAINS, domainOf, titleOf } from '../app/src/pages/copilotStore';
import type { Msg } from '@legacy/copilot';

/** Les conversations de Copilot : ce qui est gardé et synchronisé. */
describe('conversations de Copilot', () => {
  const ask = (text: string): Msg => ({ role: 'user', content: [{ type: 'text', text }] });
  const answer = (text: string, thinking = true): Msg => ({ role: 'assistant', content: [...(thinking ? [{ type: 'thinking' as const, thinking: 'x'.repeat(50), signature: 's' }] : []), { type: 'text' as const, text }] });

  it('garde les échanges sans la réflexion des tours passés', () => {
    const out = compact([ask('Bonjour'), answer('Salut')]);
    expect(out).toHaveLength(2);
    expect((out[1]!.content as { type: string }[]).map((b) => b.type)).toEqual(['text']);
  });

  it('une longue conversation perd ses plus anciens échanges, en recommençant par une question', () => {
    const long: Msg[] = [];
    for (let i = 0; i < 60; i++) long.push(ask(`Question ${i} ${'a'.repeat(3000)}`), answer(`Réponse ${i} ${'b'.repeat(3000)}`, false));
    const out = compact(long);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(150_000);
    expect(out[0]!.role).toBe('user');
    expect(((out[out.length - 1]!.content as { text: string }[])[0]!).text).toMatch(/^Réponse 59/);
  });

  it('titre et domaines', () => {
    expect(titleOf('  Je peux me payer   un billet ?  ')).toBe('Je peux me payer un billet ?');
    expect(titleOf('x'.repeat(100))).toHaveLength(58);
    expect(DOMAINS.map((d) => d.id)).toEqual(['general', 'finances', 'sport', 'rave']);
    expect(domainOf('inconnu').id).toBe('general');
    expect(domainOf('sport').label).toBe('Sport');
  });
});
