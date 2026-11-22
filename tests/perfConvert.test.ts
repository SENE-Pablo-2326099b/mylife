import { beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * MyPerf, convertir un programme avec Claude (sans réseau : le SDK est simulé) : le modèle choisi (Opus 5.5 ou Sonnet
 * 5.5), le PDF joint en document, le repli en cas de refus, et des messages clairs quand ça échoue.
 */
const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status?: number;
  }
  class AuthenticationError extends APIError {}
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}
  class APIConnectionError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static AuthenticationError = AuthenticationError;
    static RateLimitError = RateLimitError;
    static BadRequestError = BadRequestError;
    static APIConnectionError = APIConnectionError;
    beta = { messages: { create } };
    constructor(public options: unknown) {}
  }
  return { default: Anthropic };
});

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  create.mockReset();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
});

const { convertWithClaude, ConvertError } = await import('../app/src/modules/perf/data/convert');
const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as { AuthenticationError: new (m: string) => Error };

describe('Convertir avec Claude', () => {
  it('sans clé : un message clair, aucun appel', async () => {
    await expect(convertWithClaude({ text: 'Squat 5x5' }, 'claude-opus-5-5')).rejects.toBeInstanceOf(ConvertError);
    expect(create).not.toHaveBeenCalled();
  });

  it('le modèle choisi, le prompt du format, le repli en cas de refus ; la réponse texte revient', async () => {
    store.set('mylife:anthropic-key', 'sk-ant-test');
    create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '```json\n{"sessions":[]}\n```' }] });
    const out = await convertWithClaude({ text: 'Lundi : squat 5x5' }, 'claude-sonnet-5-5');
    expect(out).toContain('"sessions"');
    const params = create.mock.calls[0]![0];
    expect(params).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    expect(params.messages[0].content.at(-1).text).toContain('myperf-program');
    expect(params.messages[0].content.at(-1).text).toContain('Lundi : squat 5x5');
  });

  it('un PDF part en document, une photo en image', async () => {
    store.set('mylife:anthropic-key', 'sk-ant-test');
    create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] });
    await convertWithClaude({ file: { data: 'JVBERi0=', mediaType: 'application/pdf', name: 'prog.pdf' } }, 'claude-opus-5-5');
    expect(create.mock.calls[0]![0].messages[0].content[0]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' } });
    await convertWithClaude({ file: { data: 'iVBORw0=', mediaType: 'image/png', name: 'p.png' } }, 'claude-opus-5-5');
    expect(create.mock.calls[1]![0].messages[0].content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } });
    await expect(convertWithClaude({ file: { data: 'x', mediaType: 'application/zip', name: 'a.zip' } }, 'claude-opus-5-5')).rejects.toBeInstanceOf(ConvertError);
  });

  it('refus, réponse coupée, clé refusée : des messages clairs', async () => {
    store.set('mylife:anthropic-key', 'sk-ant-test');
    create.mockResolvedValueOnce({ stop_reason: 'refusal', content: [] });
    await expect(convertWithClaude({ text: 'x' }, 'claude-opus-5-5')).rejects.toThrow(/n’a pas pu convertir/);
    create.mockResolvedValueOnce({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{' }] });
    await expect(convertWithClaude({ text: 'x' }, 'claude-opus-5-5')).rejects.toThrow(/trop long/);
    create.mockRejectedValueOnce(new Anthropic.AuthenticationError('401'));
    await expect(convertWithClaude({ text: 'x' }, 'claude-opus-5-5')).rejects.toThrow(/clé API est refusée/);
  });
});
