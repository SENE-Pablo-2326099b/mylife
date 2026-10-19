import { describe, expect, it } from 'vitest';
import { classifyBatch } from '../src/domain/classify';
import { CAT } from '../src/domain/defaults';
import { PROFILE_RULES } from './profile';
import { pairTransfers } from '../src/domain/transfers';
import { tx } from './helpers';

const rules = PROFILE_RULES;
const ctx = { rules, ownIbans: new Set(['FR7630004000031234567890143', 'FR7628233000011234567890123']) };

describe('transferts internes', () => {
  it('IBAN d’un de mes comptes → transfert, même sans mot-clé', () => {
    const t = tx({ id: '1', amount: -5000, date: '2026-10-01', label: 'Virement divers', counterpartyIban: 'FR7628233000011234567890123' });
    const [out] = classifyBatch([t], [t], ctx);
    expect(out).toMatchObject({ categoryId: CAT.transferts, categorySource: 'transfer' });
  });

  it('la contrepartie générique est appariée et exclue (jamais comptée deux fois)', () => {
    const bnp = tx({ id: 'bnp', accountId: 'BNP', amount: -15000, date: '2026-10-14', label: 'Revolut', rawText: 'VIR SEPA INST EMIS /BEN Revolut Bank UAB' });
    const rev = tx({ id: 'rev', accountId: 'REV', amount: 15000, date: '2026-10-15', label: 'Versement', rawText: 'Versement' });
    const out = classifyBatch([bnp, rev], [bnp, rev], ctx);
    const byId = Object.fromEntries(out.map((t) => [t.id, t]));
    expect(byId.bnp.categoryId).toBe(CAT.transferts);
    expect(byId.rev.categoryId).toBe(CAT.transferts);
    expect(byId.bnp.transferPairId).toBe(byId.rev.transferPairId);
    expect(byId.bnp.transferPairId).not.toBeNull();
  });

  it('pas d’appariement si aucune jambe n’est reconnue comme transfert', () => {
    const a = tx({ id: 'a', accountId: 'BNP', amount: -2000, date: '2026-10-14', categoryId: 'restos' });
    const b = tx({ id: 'b', accountId: 'REV', amount: 2000, date: '2026-10-14', categoryId: null });
    expect(pairTransfers([a, b], CAT.transferts)).toHaveLength(0);
  });

  it('pas d’appariement sur le même compte ni au-delà de la fenêtre', () => {
    const a = tx({ id: 'a', accountId: 'BNP', amount: -2000, date: '2026-10-01', categoryId: CAT.transferts });
    const b = tx({ id: 'b', accountId: 'BNP', amount: 2000, date: '2026-10-01' });
    const c = tx({ id: 'c', accountId: 'REV', amount: 2000, date: '2026-10-10' });
    expect(pairTransfers([a, b, c], CAT.transferts)).toHaveLength(0);
  });

  it('choisit la contrepartie la plus proche en date', () => {
    const a = tx({ id: 'a', accountId: 'BNP', amount: -2000, date: '2026-10-05', categoryId: CAT.transferts });
    const far = tx({ id: 'far', accountId: 'REV', amount: 2000, date: '2026-10-08' });
    const near = tx({ id: 'near', accountId: 'REV', amount: 2000, date: '2026-10-05' });
    expect(pairTransfers([a, far, near], CAT.transferts)).toEqual([['a', 'near']]);
  });

  it('respecte une correction manuelle contraire', () => {
    const a = tx({ id: 'a', accountId: 'BNP', amount: -2000, date: '2026-10-05', categoryId: CAT.transferts });
    const b = tx({ id: 'b', accountId: 'REV', amount: 2000, date: '2026-10-05', categoryId: CAT.remboursements, categorySource: 'manual' });
    expect(pairTransfers([a, b], CAT.transferts)).toHaveLength(0);
  });
});

describe('classifyBatch', () => {
  it('ne touche jamais une correction manuelle', () => {
    const t = tx({ id: '1', amount: -2340, date: '2026-10-02', label: 'Deliveroo', categoryId: CAT.sorties, categorySource: 'manual' });
    expect(classifyBatch([t], [t], ctx)).toHaveLength(0);
  });

  it('applique les règles et renseigne la personne pour les remboursements', () => {
    const t = tx({ id: '1', amount: 2000, date: '2026-10-12', label: 'M LANCELOT SIMON', counterparty: 'M LANCELOT SIMON' });
    const [out] = classifyBatch([t], [t], ctx);
    expect(out).toMatchObject({ categoryId: CAT.remboursements, person: 'Lancelot Simon', categorySource: 'rule' });
  });

  it('Lydia / Wero : entre amis, avec le nom de la contrepartie', () => {
    const t = tx({ id: '1', amount: -1500, date: '2026-10-12', label: 'Lydia Julie B', counterparty: 'Julie B', rawText: 'LYDIA Julie B' });
    const [out] = classifyBatch([t], [t], ctx);
    expect(out).toMatchObject({ categoryId: CAT.remboursements, person: 'Julie B' });
  });

  it('n’émet que les opérations modifiées', () => {
    const t = tx({ id: '1', amount: -2340, date: '2026-10-02', label: 'Deliveroo' });
    const [first] = classifyBatch([t], [t], ctx);
    expect(classifyBatch([first], [first], ctx)).toHaveLength(0);
  });

  it('une opération reclassée hors transfert libère sa contrepartie', () => {
    const a = tx({ id: 'a', accountId: 'BNP', amount: -2000, date: '2026-10-05', categoryId: 'sorties', categorySource: 'manual', transferPairId: 'p' });
    const b = tx({ id: 'b', accountId: 'REV', amount: 2000, date: '2026-10-05', label: 'Versement', categoryId: CAT.transferts, categorySource: 'transfer', transferPairId: 'p' });
    const out = classifyBatch([a], [a, b], ctx);
    const byId = Object.fromEntries(out.map((t) => [t.id, t]));
    expect(byId.b.transferPairId).toBeNull();
    expect(byId.b.categoryId).toBeNull();
  });
});
