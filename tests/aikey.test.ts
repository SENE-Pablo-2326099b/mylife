import { beforeEach, describe, expect, it } from 'vitest';
import { AI_KEY, readAiKey, writeAiKey } from '../packages/sync-client/src/aiKey';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
});

describe('clé IA commune à MyFinances et MyPerf', () => {
  it('saisie une fois, lue partout', () => {
    writeAiKey('  sk-ant-test  ');
    expect(readAiKey()).toBe('sk-ant-test');
    expect(store.get(AI_KEY)).toBe('sk-ant-test');
  });
  it('reprend l’ancienne clé d’une app, la range au nouvel endroit et supprime l’ancienne', () => {
    store.set('myfinances-anthropic-key', 'sk-ant-old');
    expect(readAiKey()).toBe('sk-ant-old');
    expect(store.get(AI_KEY)).toBe('sk-ant-old');
    expect(store.has('myfinances-anthropic-key')).toBe(false);
  });
  it('effacer la clé l’efface pour toutes les apps', () => {
    writeAiKey('sk-ant-x');
    writeAiKey(null);
    expect(readAiKey()).toBeNull();
  });
});
