import { describe, expect, it } from 'vitest';
import { newPantryItem } from '../packages/lumen/src/chef';
import { mealId, parsePlannedMeal, proposeWeek, shoppingForPlan } from '../packages/lumen/src/mealplan';
import { STARTER_RECIPES } from '../packages/lumen/src/recipes';

/** MyChef, palier 3 : le planning de la semaine. */
const TODAY = '2026-10-26';
const days = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'];
const recipes = STARTER_RECIPES.map((r, i) => ({ id: `fournie-${i}`, value: r }));
const stock = (...names: string[]) => names.map((n) => newPantryItem(n, TODAY));
const byTitle = (t: string) => recipes.find((r) => r.value.title === t)!;

describe('proposer une semaine', () => {
  it('ce qui périme d’abord, puis ce qui est faisable ; pas deux fois la même recette', () => {
    const plan = proposeWeek({ days: days.slice(0, 3), planned: [], recipes, pantry: stock('oeufs', 'beurre', 'pâtes', 'tomates concassées', 'ail', 'riz', 'oignon', 'carottes', 'légumes surgelés'), expiring: ['Œufs'] });
    expect(plan.map((m) => [m.day, m.slot, m.title])).toEqual([
      ['2026-10-26', 'soir', 'Omelette'],
      // Les œufs sont déjà « sauvés » par l'omelette : ils ne départagent plus ; à temps égal, l'ordre alphabétique.
      ['2026-10-27', 'soir', 'Pâtes à la tomate'],
      ['2026-10-28', 'soir', 'Riz sauté aux légumes et œufs'],
    ]);
    expect(new Set(plan.map((m) => m.recipeId)).size).toBe(3);
  });

  it('pas de dîner un soir de sortie ; un plat protéiné un jour de séance ; les repas déjà prévus restent', () => {
    const planned = [{ v: 1 as const, day: '2026-10-26', slot: 'soir' as const, title: 'Pizza maison', servings: 2 }];
    const plan = proposeWeek({ days, planned, recipes, pantry: stock('poulet', 'oignon', 'crème', 'riz', 'épices', 'pâtes', 'tomates concassées', 'ail'), expiring: [], context: { '2026-10-27': { outTonight: 'Festival' }, '2026-10-28': { training: true } } });
    expect(plan.map((m) => m.day)).not.toContain('2026-10-26');
    expect(plan.map((m) => m.day)).not.toContain('2026-10-27');
    // Les deux sont faisables, les pâtes plus rapides : la séance fait passer le plat protéiné devant.
    expect(plan.find((m) => m.day === '2026-10-28')!.title).toBe('Poulet au curry');
    expect(plan.find((m) => m.day === '2026-10-29')!.title).toBe('Pâtes à la tomate');
  });

  it('une recette pour deux fois plus de monde donne des restes au repas suivant', () => {
    const soup = byTitle('Soupe de légumes');
    const plan = proposeWeek({ days: days.slice(0, 2), planned: [], recipes: [soup, byTitle('Omelette')], pantry: stock('carottes', 'pommes de terre', 'courgettes', 'oignon', 'bouillon'), expiring: [], slots: ['midi', 'soir'] });
    expect(plan.slice(0, 2).map((m) => [m.slot, m.title, m.servings, !!m.leftover])).toEqual([
      ['midi', 'Soupe de légumes', 4, false],
      ['soir', 'Soupe de légumes (restes)', 2, true],
    ]);
  });
});

describe('les courses de la semaine', () => {
  it('ce qui manque, aux portions prévues, additionné ; ni ce qu’on a, ni la base, ni ce qui est déjà sur la liste', () => {
    const meals = [
      { v: 1 as const, day: '2026-10-26', slot: 'soir' as const, recipeId: byTitle('Omelette').id, title: 'Omelette', servings: 2 },
      { v: 1 as const, day: '2026-10-27', slot: 'soir' as const, recipeId: byTitle('Crêpes').id, title: 'Crêpes', servings: 4 },
      { v: 1 as const, day: '2026-10-28', slot: 'midi' as const, recipeId: byTitle('Crêpes').id, title: 'Crêpes (restes)', servings: 2, leftover: true },
    ];
    const need = shoppingForPlan(meals, recipes, stock('beurre'), [{ v: 1, name: 'Lait', aisle: 'frais' }]);
    expect(need).toEqual([
      { name: 'Œufs', qty: 10 },
      { name: 'Farine', qty: 250, unit: 'g' },
    ]);
  });

  it('lecture prudente d’un repas prévu', () => {
    expect(parsePlannedMeal({ v: 1, day: '2026-10-26', slot: 'soir', title: ' Omelette ', servings: 99, recipeId: '../x' })).toEqual({ v: 1, day: '2026-10-26', slot: 'soir', title: 'Omelette', servings: 2 });
    expect(parsePlannedMeal({ v: 1, day: '2026-10-26', slot: 'goûter', title: 'x' })).toBeNull();
    expect(mealId('2026-10-26', 'midi')).toBe('2026-10-26-midi');
  });
});
