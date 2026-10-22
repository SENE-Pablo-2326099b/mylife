import { beforeEach, describe, expect, it } from 'vitest';
import { DEVICE_OWNER_KEY, adoptDevice, claimDevice } from '../packages/sync-client/src/device';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
});

const traces = () => {
  store.set('mylife:anthropic-key', 'sk-ant-du-premier');
  store.set('mylife:glance:finances', '{"title":"25 € à dépenser aujourd’hui"}');
  store.set('mylife:glance:perf', '{"title":"Jambes"}');
  store.set('mylife:backup:finances', '1700000000000');
  store.set('myfinances-assistant-history', '[{"role":"user","content":"mon salaire"}]');
  store.set('mylife-appearance', '{"theme":"nuit"}');
};

describe('un appareil, plusieurs comptes', () => {
  it('un autre compte ne garde rien du précédent (clé d’IA, aperçus, assistant, sauvegarde)', () => {
    adoptDevice('premier');
    traces();
    claimDevice('second');
    expect([...store.keys()].sort()).toEqual(['mylife-appearance', DEVICE_OWNER_KEY]);
    expect(store.get(DEVICE_OWNER_KEY)).toBe('second');
  });
  it('le même compte qui se reconnecte retrouve tout', () => {
    adoptDevice('premier');
    traces();
    claimDevice('premier');
    expect(store.get('mylife:anthropic-key')).toBe('sk-ant-du-premier');
    expect(store.has('mylife:glance:finances')).toBe(true);
  });
  it('appareil sans propriétaire connu : on efface avant la première connexion', () => {
    traces();
    claimDevice('nouveau');
    expect(store.has('mylife:anthropic-key')).toBe(false);
    expect(store.has('myfinances-assistant-history')).toBe(false);
  });
  it('appareil déjà connecté avant la règle : sa session en devient propriétaire, sans rien effacer', () => {
    traces();
    adoptDevice('premier');
    adoptDevice('autre');
    expect(store.get(DEVICE_OWNER_KEY)).toBe('premier');
    expect(store.get('mylife:anthropic-key')).toBe('sk-ant-du-premier');
  });
});
