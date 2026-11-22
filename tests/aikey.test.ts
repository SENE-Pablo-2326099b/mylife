import { beforeEach, describe, expect, it } from 'vitest';
import { AI_KEY, AI_MODEL, readAiKey, readAiModel, writeAiKey, writeAiModel } from '../packages/sync-client/src/aiKey';

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

describe('modèle de Claude choisi', () => {
  it('Opus 5.5 par défaut ; Sonnet 5.5 se choisit et se garde ; une valeur inconnue est ignorée', () => {
    expect(readAiModel()).toBe('claude-opus-5-5');
    writeAiModel('claude-sonnet-5-5');
    expect(readAiModel()).toBe('claude-sonnet-5-5');
    writeAiModel('gpt' as never);
    expect(store.get(AI_MODEL)).toBe('claude-sonnet-5-5');
    store.set(AI_MODEL, 'claude-autre');
    expect(readAiModel()).toBe('claude-opus-5-5');
  });
});

describe('clé IA et déconnexion', () => {
  it('se déconnecter efface la clé de l’appareil ; changer de session sans se déconnecter la garde', async () => {
    const { webPlatform } = await import('../packages/sync-client/src/web');
    await webPlatform.sessions.set({ login: 'camille', token: 't1', dek: 'd' });
    writeAiKey('sk-ant-perso');
    // Nouvelle session du même compte (mot de passe changé ici) : la clé reste.
    await webPlatform.sessions.set({ login: 'camille', token: 't2', dek: 'd' });
    expect(readAiKey()).toBe('sk-ant-perso');
    await webPlatform.sessions.set(null);
    expect(readAiKey()).toBeNull();
  });
});
