import { describe, expect, it } from 'vitest';
import { estimateList, parsePrice, parseTicket, parseTicketText, pricesFromTicket } from '../packages/lumen/src/ticket';

/** MyChef, palier 4 : le ticket de caisse et les prix. */
describe('lire un ticket', () => {
  it('collé en texte : articles et prix, quantités « 2 x » ; totaux, paiement, en-têtes écartés ; abréviations courantes', () => {
    const t = parseTicketText(['SUPERMARCHE DU COIN', 'LAIT DEMI ECR UHT 1L      0,99', '2 x OEUFS PLEIN AIR X6     4,58', 'PATES PENNE 500G          1,15', 'SOUS-TOTAL               6,72', 'TOTAL                    6,72', 'CB                       6,72'].join('\n'));
    expect(t.lines).toEqual([
      { name: 'Lait', price: 99 },
      { name: 'Œufs', qty: 2, price: 458 },
      { name: 'Pâtes', price: 115 },
    ]);
  });

  it('la réponse d’une IA (clés françaises acceptées), lue prudemment', () => {
    expect(parseTicket({ store: 'Marché', date: '2026-10-24', articles: [{ nom: 'Tomates', quantite: 2, prix: '3,20' }, { nom: '' }, { nom: 'Pain', prix: 1.1 }] })).toEqual({ store: 'Marché', date: '2026-10-24', lines: [{ name: 'Tomates', qty: 2, price: 320 }, { name: 'Pain', price: 110 }] });
    expect(parseTicket({ items: [] })).toBeNull();
  });
});

describe('les prix retenus', () => {
  it('prix à l’unité, même identifiant que le garde-manger ; coût estimé de la liste', () => {
    const prices = pricesFromTicket({ date: '2026-10-24', lines: [{ name: 'Œufs', qty: 2, price: 458 }, { name: 'Lait', price: 99 }, { name: 'Bricole' }] }, '2026-10-25');
    expect(prices).toEqual([
      { id: 'oeuf', value: { v: 1, name: 'Œufs', unitPrice: 229, day: '2026-10-24' } },
      { id: 'lait', value: { v: 1, name: 'Lait', unitPrice: 99, day: '2026-10-24' } },
    ]);
    const map = new Map(prices.map((p) => [p.id, p.value]));
    const list = [
      { id: 'oeuf', value: { name: 'Œufs', qty: 2 } },
      { id: 'lait', value: { name: 'Lait', qty: 1, unit: 'L' } },
      { id: 'cafe', value: { name: 'Café' } },
      { id: 'pain', value: { name: 'Pain', done: true } },
    ];
    expect(estimateList(list, map)).toEqual({ total: 229 * 2 + 99, priced: 2, unknown: 1 });
    expect(parsePrice({ v: 1, name: 'x', unitPrice: -1, day: '2026-10-24' })).toBeNull();
  });
});
