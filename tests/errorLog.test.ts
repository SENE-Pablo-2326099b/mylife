import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearErrors, isStaleChunk, logError, readErrors } from '../src/ui/errorLog';

// Stockage local minimal (l'environnement de test est Node).
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

describe('journal d’erreurs local', () => {
  beforeEach(() => clearErrors());

  it('garde les erreurs, la plus récente en premier', () => {
    logError('écran', new Error('a'));
    logError('promesse', 'b');
    const list = readErrors();
    expect(list.map((e) => e.message)).toEqual(['b', 'a']);
    expect(list[1]?.source).toBe('écran');
  });

  it('ignore la même erreur répétée en rafale', () => {
    logError('window', new Error('boucle'));
    logError('window', new Error('boucle'));
    expect(readErrors()).toHaveLength(1);
  });

  it('se limite aux 30 dernières', () => {
    for (let i = 0; i < 40; i++) logError('window', new Error(`e${i}`));
    const list = readErrors();
    expect(list).toHaveLength(30);
    expect(list[0]?.message).toBe('e39');
  });

  it('reconnaît un morceau de code disparu après une mise à jour', () => {
    expect(isStaleChunk(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Cycle-abc.js'))).toBe(true);
    expect(isStaleChunk(new Error('Cannot read properties of undefined'))).toBe(false);
  });
});
