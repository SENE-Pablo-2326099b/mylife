import { describe, expect, it } from 'vitest';
import { newPantryItem } from '../packages/lumen/src/chef';
import { afterCooking, availability, parseIngredientLine, parseRecipe, parseRecipeText, rankRecipes, scaleRecipe, STARTER_RECIPES, stepTimers } from '../packages/lumen/src/recipes';

/** MyChef, palier 2 : recettes et « qu'est-ce que je fais avec ce que j'ai ? ». */
const TODAY = '2026-10-24';
const stock = (...names: string[]) => names.map((n) => newPantryItem(n, TODAY));

describe('lire une recette', () => {
  it('une ligne d’ingrédient : quantité, unité (même écrite en entier), aliment, facultatif', () => {
    expect(parseIngredientLine('200 g de farine')).toEqual({ name: 'Farine', qty: 200, unit: 'g' });
    expect(parseIngredientLine('3 œufs')).toEqual({ name: 'Œufs', qty: 3 });
    expect(parseIngredientLine('1 c. à soupe d’huile d’olive')).toEqual({ name: 'Huile d’olive', qty: 1, unit: 'c. à soupe' });
    expect(parseIngredientLine('2 cuillères à café de curry')).toEqual({ name: 'Curry', qty: 2, unit: 'c. à café' });
    expect(parseIngredientLine('½ citron')).toEqual({ name: 'Citron', qty: 0.5 });
    expect(parseIngredientLine('- Parmesan (facultatif)')).toEqual({ name: 'Parmesan', optional: true });
  });

  it('une recette collée telle qu’elle est écrite, sans IA ; ce qui n’est pas compris est signalé', () => {
    const r = parseRecipeText('Pâtes carbonara\nPour 2 personnes, 20 min\nUne recette de famille\nIngrédients :\n200 g de spaghetti\n100 g de lardons\n2 œufs\n50 g de parmesan\nPréparation :\n1. Cuis les pâtes 10 min.\n2. Fais dorer les lardons.\n3. Mélange hors du feu avec les œufs battus.');
    expect(r.recipe).toMatchObject({ title: 'Pâtes carbonara', servings: 2, minutes: 20, steps: ['Cuis les pâtes 10 min.', 'Fais dorer les lardons.', 'Mélange hors du feu avec les œufs battus.'] });
    expect(r.recipe!.ingredients.map((i) => i.name)).toEqual(['Spaghetti', 'Lardons', 'Œufs', 'Parmesan']);
    expect(r.ignored).toEqual(['Une recette de famille']);
  });

  it('la réponse d’une IA (clés françaises acceptées) ; une recette sans ingrédient est refusée', () => {
    expect(parseRecipe({ titre: 'Soupe', portions: 4, ingredients: ['2 carottes', { nom: 'Oignon', quantite: 1 }], etapes: ['Cuire.'] })).toMatchObject({ title: 'Soupe', servings: 4, ingredients: [{ name: 'Carottes', qty: 2 }, { name: 'Oignon', qty: 1 }], steps: ['Cuire.'] });
    expect(parseRecipe({ title: 'Rien', ingredients: [] })).toBeNull();
  });

  it('les recettes fournies se lisent toutes, et leurs ingrédients sont reconnus', () => {
    expect(STARTER_RECIPES).toHaveLength(12);
    for (const r of STARTER_RECIPES) expect(parseRecipe(JSON.parse(JSON.stringify(r))), r.title).toEqual(r);
  });
});

describe('avec ce que j’ai', () => {
  const pasta = STARTER_RECIPES.find((r) => r.title === 'Pâtes à la tomate')!;
  const omelette = STARTER_RECIPES.find((r) => r.title === 'Omelette')!;
  it('faisable, à un ingrédient près, ou non ; les ingrédients de base et facultatifs ne manquent jamais', () => {
    expect(availability(pasta, stock('pâtes', 'tomates concassées', 'ail'))).toMatchObject({ status: 'ready', missing: [] });
    expect(availability(pasta, stock('pâtes', 'ail')).missing.map((i) => i.name)).toEqual(['Tomates concassées']);
    expect(availability(pasta, stock('riz')).status).toBe('no');
  });
  it('classement : faisable d’abord, puis ce qui sauve un aliment qui périme, puis le plus rapide', () => {
    const list = STARTER_RECIPES.map((r, i) => ({ id: String(i), value: r }));
    const ranked = rankRecipes(list, stock('oeufs', 'beurre', 'pâtes', 'tomates concassées', 'ail'), ['Œufs']);
    expect(ranked.slice(0, 2).map((r) => r.value.title)).toEqual(['Omelette', 'Pâtes à la tomate']);
    expect(rankRecipes(list, stock('oeufs', 'beurre', 'pâtes', 'tomates concassées', 'ail'), [])[0]!.value.title).toBe('Omelette');
  });
  it('portions ; « J’ai cuisiné » retire du stock ; minuteurs d’une étape', () => {
    expect(scaleRecipe(omelette, 2).ingredients[0]).toEqual({ name: 'Œufs', qty: 6 });
    const pantry = [
      { id: 'oeuf', value: { ...newPantryItem('oeufs', TODAY), qty: 6 } },
      { id: 'beurre', value: newPantryItem('beurre', TODAY) },
    ];
    expect(afterCooking(omelette, pantry)).toEqual([
      { id: 'oeuf', value: { ...pantry[0]!.value, qty: 3, level: 'ok' } },
      { id: 'beurre', value: { ...pantry[1]!.value, level: 'low' } },
    ]);
    expect(stepTimers('Cuis 12 min, puis 1 h 30 au four, à 180 °C.')).toEqual([720, 5400]);
  });
});
