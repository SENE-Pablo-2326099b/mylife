import { describe, expect, it } from 'vitest';
import { buildDefaultRules, CAT } from '../src/domain/defaults';
import { compileRules, findMatchingRule, suggestKeyword, validatePattern } from '../src/domain/rules';
import type { Rule } from '../src/db/types';

const rules = compileRules(buildDefaultRules('PABLO SENE'));
const cat = (label: string, amount = -1000, rawText = label) => findMatchingRule(rules, { label, rawText, amount })?.categoryId ?? null;

describe('règles par défaut (commerçants réels)', () => {
  it.each([
    ['INTERMARCHE SUPER AIX', CAT.courses],
    ['Intermarché', CAT.courses],
    ['ALBERT HEIJN 1234', CAT.courses],
    ['HUILE PROVENCALE', CAT.courses],
    ['EUREST CEA CADARACHE', CAT.cantines],
    ['CAFETERIA IUT AIX', CAT.cantines],
    ['Le Tropical', CAT.cantines],
    ["O'Tacos Aix", CAT.restos],
    ['OTACOS MARSEILLE', CAT.restos],
    ['PORZIONE FABROT', CAT.restos],
    ["L'ESTELLO", CAT.restos],
    ['SB AIX', CAT.restos],
    ['Deliveroo', CAT.livraison],
    ['UBER *EATS', CAT.livraison],
    ['UBEREATS', CAT.livraison],
    ['BAR DES PTT', CAT.sorties],
    ["BEL'RENCONTRE", CAT.sorties],
    ['Métropole Aix-Marseille-Provence', CAT.transport],
    ['SUD MOBILITES', CAT.transport],
    ['AMZN Mktp FR', CAT.shopping],
    ['AMAZON PAYMENTS', CAT.shopping],
    ['SUPERDRY AIX', CAT.shopping],
    ['TABAC PRESSE DU COURS', CAT.tabac],
    ['GETLEVERAGED.COM', CAT.trading],
    ['ANTHROPIC', CAT.abonnements],
    ['CLAUDE.AI SUBSCRIPTION', CAT.abonnements],
    ['SOUNDCLOUD', CAT.abonnements],
    ['GOOGLE *YouTube', CAT.abonnements],
    ['CARDIF ASSURANCE', CAT.abonnements],
    ['FREE MOBILE', CAT.abonnements],
    ['FITNESS PARK AIX', CAT.sport],
    ['DISTRIPROT', CAT.sport],
    ['INTERSPORT', CAT.sport],
    ['TRADE REPUBLIC BANK', CAT.epargne],
    ['VERSEMENT LIVRET A', CAT.epargne],
    ['VIR PEA', CAT.epargne],
    ['Achat Bitcoin', CAT.epargne],
  ])('%s', (label, expected) => {
    expect(cat(label)).toBe(expected);
  });

  it('CROUS : petit montant = cantine, gros prélèvement = loyer', () => {
    expect(cat('CROUS AIX MARSEILLE', -330)).toBe(CAT.cantines);
    expect(cat('PRLV SEPA CROUS AIX MARSEILLE', -25340)).toBe(CAT.logement);
  });

  it('transferts internes BNP ↔ Revolut', () => {
    expect(cat('Paiement envoyé par M PABLO SENE', -20000)).toBe(CAT.transferts);
    expect(cat('Payment from M PABLO SENE', 20000)).toBe(CAT.transferts);
    expect(cat('Top-Up by *1234', 15000)).toBe(CAT.transferts);
    expect(cat('VIR SEPA INST EMIS /BEN Revolut Bank UAB', -15000)).toBe(CAT.transferts);
  });

  it('remboursements entre amis avec la personne', () => {
    const r = findMatchingRule(rules, { label: 'M LANCELOT SIMON', rawText: 'VIR SEPA INST RECU /DE M LANCELOT SIMON', amount: 2000 });
    expect(r?.categoryId).toBe(CAT.remboursements);
    expect(r?.person).toBe('Lancelot Simon');
  });

  it('revenus : uniquement en crédit', () => {
    expect(cat('VIR SEPA RECU SALAIRE SEPTEMBRE', 153700)).toBe(CAT.revenus);
    expect(cat('CAF DES BOUCHES DU RHONE APL', 17000)).toBe(CAT.revenus);
    expect(cat('CAF', -500)).toBeNull();
  });

  it('inconnu → null', () => {
    expect(cat('BOULANGERIE DU COURS')).toBeNull();
  });
});

describe('moteur de règles', () => {
  const base: Omit<Rule, 'id' | 'pattern' | 'categoryId'> = {
    isRegex: false,
    direction: 'any',
    minAmount: null,
    maxAmount: null,
    person: null,
    priority: 0,
    label: '',
    enabled: true,
    createdAt: 0,
  };

  it('insensible à la casse et aux accents (mot-clé et regex)', () => {
    const c = compileRules([
      { ...base, id: '1', pattern: 'Crêperie Él', categoryId: 'x' },
      { ...base, id: '2', pattern: '^cafe ?du', categoryId: 'y', isRegex: true },
    ]);
    expect(findMatchingRule(c, { label: 'CREPERIE EL', rawText: '', amount: -1 })?.id).toBe('1');
    expect(findMatchingRule(c, { label: 'CAFÉ DU COIN', rawText: '', amount: -1 })?.id).toBe('2');
  });

  it('priorité puis spécificité', () => {
    const c = compileRules([
      { ...base, id: 'gen', pattern: 'uber', categoryId: 'transport' },
      { ...base, id: 'spe', pattern: 'uber eats', categoryId: 'livraison' },
      { ...base, id: 'prio', pattern: 'eats', categoryId: 'autre', priority: 10 },
    ]);
    expect(findMatchingRule(c, { label: 'UBER EATS', rawText: '', amount: -1 })?.id).toBe('prio');
    expect(findMatchingRule(c, { label: 'UBER TRIP', rawText: '', amount: -1 })?.id).toBe('gen');
  });

  it('règles désactivées et regex invalides ignorées', () => {
    const c = compileRules([
      { ...base, id: 'off', pattern: 'foo', categoryId: 'x', enabled: false },
      { ...base, id: 'bad', pattern: '(', categoryId: 'x', isRegex: true },
    ]);
    expect(c).toHaveLength(0);
  });

  it('validatePattern', () => {
    expect(validatePattern('(', true)).toMatch(/invalide/);
    expect(validatePattern('  ', false)).toBe('Motif vide');
    expect(validatePattern('deliveroo', false)).toBeNull();
  });

  it('suggestKeyword retire le bruit bancaire', () => {
    expect(suggestKeyword('CB INTERMARCHE AIX 12/10')).toBe('intermarche aix');
    expect(suggestKeyword('FACTURE CARTE DU 141026 BOULANGERIE DU COURS')).toBe('boulangerie cours');
    expect(suggestKeyword('Kiosque')).toBe('kiosque');
  });
});

describe('mots-clés à plusieurs mots', () => {
  const base = { isRegex: false, direction: 'any' as const, minAmount: null, maxAmount: null, person: null, priority: 0, label: '', enabled: true, createdAt: 0 };
  it('tous les mots présents, dans n’importe quel ordre', () => {
    const c = compileRules([{ ...base, id: '1', pattern: 'boulangerie cours', categoryId: 'x' }]);
    expect(findMatchingRule(c, { label: 'BOULANGERIE DU COURS', rawText: '', amount: -1 })).not.toBeNull();
    expect(findMatchingRule(c, { label: 'COURS BOULANGERIE', rawText: '', amount: -1 })).not.toBeNull();
    expect(findMatchingRule(c, { label: 'BOULANGERIE PAUL', rawText: '', amount: -1 })).toBeNull();
  });
});
