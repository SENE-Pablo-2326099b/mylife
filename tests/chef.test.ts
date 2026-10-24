import { describe, expect, it } from 'vitest';
import { byAisle, expiringSoon, findFood, foodId, foodKey, isRunningLow, newPantryItem, parsePantryItem, parseShoppingItem, staplesToBuy, stockAfterPurchase, suggestFoods, type PantryItem, type ShoppingItem } from '../packages/lumen/src/chef';

/** MyChef, palier 1 : garde-manger et courses. */
const TODAY = '2026-10-24';
const p = (id: string, over: Partial<PantryItem>) => ({ id, value: { ...newPantryItem(id, TODAY), ...over } });
const l = (id: string, over: Partial<ShoppingItem> = {}) => ({ id, value: { v: 1 as const, name: id, aisle: 'autre' as const, ...over } });

describe('MyChef : reconnaître un aliment', () => {
  it('pluriels, accents, majuscules et autres noms ; même aliment = même identifiant', () => {
    expect(foodKey('Œufs frais')).toBe('oeuf frai');
    expect(findFood('oeuf')?.name).toBe('Œufs');
    expect(findFood('  PÂTES ')?.name).toBe('Pâtes');
    expect(findFood('tomates cerises')?.name).toBe('Tomates');
    expect(findFood('baguette')).toMatchObject({ name: 'Pain', aisle: 'boulangerie' });
    expect(findFood('Truffe blanche')).toBeNull();
    expect(foodId('Œufs')).toBe(foodId('oeuf'));
    expect(suggestFoods('po').map((f) => f.name).slice(0, 3)).toEqual(['Pommes', 'Pommes de terre', 'Poivrons']);
  });
});

describe('MyChef : le garde-manger', () => {
  it('un nouvel élément : rayon, lieu et date limite proposés ; un inconnu reste possible', () => {
    expect(newPantryItem('lait', TODAY)).toEqual({ v: 1, name: 'Lait', place: 'frigo', aisle: 'frais', level: 'ok', expires: '2026-10-31' });
    expect(newPantryItem('Riz', TODAY).expires).toBeUndefined();
    expect(newPantryItem('Truffe blanche', TODAY)).toEqual({ v: 1, name: 'Truffe blanche', place: 'placard', aisle: 'autre', level: 'ok' });
  });

  it('à finir vite (périmé compris, le plus pressé d’abord) ; bientôt fini, en simple ou sous le seuil en précis', () => {
    const items = [p('Lait', { expires: '2026-10-26' }), p('Poulet', { expires: '2026-10-23' }), p('Beurre', { expires: '2026-11-20' }), p('Yaourts', { expires: '2026-10-25', level: 'out' })];
    expect(expiringSoon(items, TODAY).map((i) => i.id)).toEqual(['Poulet', 'Lait']);
    expect(isRunningLow(p('Œufs', { level: 'low' }).value)).toBe(true);
    expect(isRunningLow(p('Œufs', { qty: 2, threshold: 4, staple: true }).value)).toBe(true);
    expect(isRunningLow(p('Œufs', { qty: 6, threshold: 4, staple: true }).value)).toBe(false);
  });

  it('les indispensables bientôt finis reviennent sur la liste, sauf s’ils y sont déjà', () => {
    const pantry = [p('oeuf', { staple: true, level: 'low' }), p('pates', { staple: true, level: 'out' }), p('cafe', { staple: true }), p('lait', { level: 'out' })];
    expect(staplesToBuy(pantry, [l('Pâtes')]).map((i) => i.id)).toEqual(['oeuf']);
    expect(staplesToBuy(pantry, [l('Pâtes', { done: true })]).map((i) => i.id)).toEqual(['oeuf', 'pates']);
  });
});

describe('MyChef : les courses', () => {
  it('rangées dans l’ordre du magasin, ce qui reste à prendre d’abord', () => {
    const list = [l('Lessive', { aisle: 'maison' }), l('Pommes', { aisle: 'fruits', done: true }), l('Carottes', { aisle: 'fruits' }), l('Lait', { aisle: 'frais' })];
    expect(byAisle(list).map((g) => [g.aisle, g.items.map((i) => i.id)])).toEqual([
      ['fruits', ['Carottes', 'Pommes']],
      ['frais', ['Lait']],
      ['maison', ['Lessive']],
    ]);
  });

  it('cocher = acheté : l’article redevient « en stock », la quantité s’ajoute, la date repart', () => {
    const before = { ...newPantryItem('Lait', '2026-10-01'), level: 'low' as const, qty: 0.5, unit: 'L', staple: true };
    expect(stockAfterPurchase(before, { v: 1, name: 'Lait', aisle: 'frais', qty: 2, unit: 'L' }, TODAY)).toEqual({ ...before, level: 'ok', qty: 2.5, expires: '2026-10-31' });
    expect(stockAfterPurchase(null, { v: 1, name: 'Bananes', aisle: 'fruits' }, TODAY)).toMatchObject({ name: 'Bananes', level: 'ok', place: 'placard', expires: '2026-10-30' });
  });

  it('lecture prudente de ce qui arrive d’un autre appareil', () => {
    expect(parsePantryItem({ v: 1, name: ' Lait ', place: 'cave', aisle: 'frais', level: 'bizarre', qty: -2, expires: 'demain' })).toEqual({ v: 1, name: 'Lait', place: 'placard', aisle: 'frais', level: 'ok' });
    expect(parsePantryItem({ v: 1, name: '' })).toBeNull();
    expect(parseShoppingItem({ v: 1, name: 'Lait', aisle: 'frais', qty: 2, unit: 'L', done: true })).toEqual({ v: 1, name: 'Lait', aisle: 'frais', qty: 2, unit: 'L', done: true });
  });
});
