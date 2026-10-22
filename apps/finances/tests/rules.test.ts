import { describe, expect, it } from 'vitest';
import { buildDefaultRules, CAT, holderRule } from '../src/domain/defaults';
import { compileRules, findMatchingRule, suggestKeyword, validatePattern } from '../src/domain/rules';
import type { Rule } from '../src/db/types';

const rules = compileRules(buildDefaultRules(['CAMILLE MARTIN']));
const cat = (label: string, amount = -1000, rawText = label) => findMatchingRule(rules, { label, rawText, amount })?.categoryId ?? null;

describe('règles par défaut (enseignes nationales, pour tout le monde)', () => {
  it.each([
    ['CARREFOUR CITY PARIS 11', CAT.courses],
    ['E.LECLERC', CAT.courses],
    ['LIDL 1234', CAT.courses],
    ['Intermarché', CAT.courses],
    ['MONOPRIX', CAT.courses],
    ['BOULANGERIE DU COIN', CAT.courses],
    ["McDonald's Lyon", CAT.restos],
    ['MCDONALDS', CAT.restos],
    ["O'Tacos Aix", CAT.restos],
    ['STARBUCKS COFFEE', CAT.restos],
    ['PIZZERIA NAPOLI', CAT.restos],
    ['Deliveroo', CAT.livraison],
    ['UBER *EATS', CAT.livraison],
    ['UBEREATS', CAT.livraison],
    ['JUST EAT', CAT.livraison],
    ['UGC CINE CITE', CAT.sorties],
    ['SNCF CONNECT', CAT.transport],
    ['RATP', CAT.transport],
    ['UBER *TRIP', CAT.transport],
    ['TOTALENERGIES STATION', CAT.transport],
    ['AMZN Mktp FR', CAT.shopping],
    ['AMAZON PAYMENTS', CAT.shopping],
    ['DECATHLON', CAT.shopping],
    ['ZARA FRANCE', CAT.shopping],
    ['PHARMACIE DU CENTRE', CAT.sante],
    ['DOCTOLIB', CAT.sante],
    ['BASIC FIT FRANCE', CAT.sport],
    ['FITNESS PARK AIX', CAT.sport],
    ['NETFLIX.COM', CAT.abonnements],
    ['SPOTIFY P2B3C', CAT.abonnements],
    ['CLAUDE.AI SUBSCRIPTION', CAT.abonnements],
    ['FREE MOBILE', CAT.abonnements],
    ['PRLV SEPA MAIF ASSURANCE', CAT.abonnements],
    ['PRLV SEPA EDF CLIENTS', CAT.logement],
    ['PRLV SEPA FONCIA LOYER', CAT.logement],
    ['TRADE REPUBLIC BANK', CAT.epargne],
    ['BITSTACK SAS', CAT.epargne],
    ['VERSEMENT LIVRET A', CAT.epargne],
    ['VIR PEA', CAT.epargne],
    ['COINBASE', CAT.epargne],
  ])('%s', (label, expected) => {
    expect(cat(label)).toBe(expected);
  });

  it('CROUS : petit montant = restauration, gros prélèvement = loyer', () => {
    expect(cat('CROUS AIX MARSEILLE', -330)).toBe(CAT.restos);
    expect(cat('PRLV SEPA CROUS AIX MARSEILLE', -25340)).toBe(CAT.logement);
  });

  it('transferts entre ses propres comptes (nom du titulaire déclaré)', () => {
    expect(cat('Paiement envoyé par M CAMILLE MARTIN', -20000)).toBe(CAT.transferts);
    expect(cat('Payment from CAMILLE MARTIN', 20000)).toBe(CAT.transferts);
    expect(cat('VIR SEPA INST EMIS /BEN M CAMILLE MARTIN', -15000)).toBe(CAT.transferts);
    expect(cat('Top-Up by *1234', 15000)).toBe(CAT.transferts);
    expect(cat('VIR SEPA INST EMIS /BEN Revolut Bank UAB', -15000)).toBe(CAT.transferts);
  });

  it('sans nom déclaré, aucune règle personnelle', () => {
    const generic = compileRules(buildDefaultRules([]));
    expect(findMatchingRule(generic, { label: 'Payment from CAMILLE MARTIN', rawText: '', amount: 2000 })).toBeNull();
    expect(holderRule('  ')).toBeNull();
    expect(holderRule('Jean Dupont')?.id).toBe('holder-jean-dupont');
  });

  it('Lydia / Wero : entre amis', () => {
    expect(cat('LYDIA Julie B', 1500)).toBe(CAT.remboursements);
    expect(cat('WERO Thomas', -2500)).toBe(CAT.remboursements);
  });

  it('revenus : uniquement en crédit', () => {
    expect(cat('VIR SEPA RECU SALAIRE SEPTEMBRE', 153700)).toBe(CAT.revenus);
    expect(cat('CAF DES BOUCHES DU RHONE APL', 17000)).toBe(CAT.revenus);
    expect(cat('FRANCE TRAVAIL ALLOCATION', 90000)).toBe(CAT.revenus);
    expect(cat('CAF', -500)).toBeNull();
  });

  it('inconnu → null', () => {
    expect(cat('FROMAGERIE LEMOINE')).toBeNull();
    expect(cat('ATELIER TERRE ET FEU')).toBeNull();
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
