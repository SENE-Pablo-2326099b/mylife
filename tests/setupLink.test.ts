import { describe, expect, it } from 'vitest';
import { parseSetupHash } from '../src/sync/setupLink';

describe('lien de configuration du relais', () => {
  it('lit le mot de passe du fragment', () => {
    expect(parseSetupHash('#relais=abcde-23456-fghjk-mnpqr')).toBe('abcde-23456-fghjk-mnpqr');
    expect(parseSetupHash('#x=1&relais=p%40ss')).toBe('p@ss');
  });
  it('ignore les fragments sans mot de passe ou invalides', () => {
    expect(parseSetupHash('')).toBeNull();
    expect(parseSetupHash('#contenu')).toBeNull();
    expect(parseSetupHash('#relais=')).toBeNull();
    expect(parseSetupHash('#relais=%E0%A4%A')).toBeNull();
    expect(parseSetupHash('#autrerelais=x')).toBeNull();
  });
});
