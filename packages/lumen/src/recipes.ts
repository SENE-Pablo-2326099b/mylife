import { findFood, foodKey, type PantryItem } from './chef';

/**
 * MyChef, palier 2 : les recettes et « qu'est-ce que je fais avec ce que j'ai ? ». Moteur pur : le format d'échange
 * (`mychef-recipe`, le même pour l'import, le partage et les recettes fournies), la lecture d'une recette collée en texte
 * (sans IA) ou de la réponse d'une IA, les recettes fournies, ce qui est faisable avec le garde-manger, les portions,
 * et « J'ai cuisiné » qui retire du stock.
 */

export interface Ingredient {
  name: string;
  qty?: number;
  unit?: string;
  optional?: boolean;
}

export interface Recipe {
  format: 'mychef-recipe';
  v: 1;
  title: string;
  servings: number;
  /** Temps total en minutes. */
  minutes?: number;
  ingredients: Ingredient[];
  steps: string[];
  tags: string[];
}

/** Toujours là : jamais comptés comme « manquants ». */
export const BASICS: readonly string[] = ['sel', 'poivre', 'huile', 'huile d olive', 'eau', 'sucre'].map(foodKey);

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v * 100) / 100 : undefined);

/** Lecture prudente d'une recette (synchronisée, importée, reçue par un lien). */
export function parseRecipe(raw: unknown): Recipe | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const title = text(o.title ?? o.titre, 80);
  const list = (o.ingredients ?? []) as unknown[];
  if (!title || !Array.isArray(list)) return null;
  const ingredients: Ingredient[] = [];
  for (const x of list.slice(0, 40)) {
    const i = (typeof x === 'string' ? parseIngredientLine(x) : x) as Record<string, unknown> | null;
    const name = text(i?.name ?? i?.nom, 60);
    if (!name) continue;
    const qty = num(i!.qty ?? i!.quantite, 100_000);
    const unit = text(i!.unit ?? i!.unite, 12);
    ingredients.push({ name, ...(qty !== undefined ? { qty } : {}), ...(qty !== undefined && unit ? { unit } : {}), ...(i!.optional === true ? { optional: true } : {}) });
  }
  if (!ingredients.length) return null;
  const steps = (Array.isArray(o.steps ?? o.etapes) ? ((o.steps ?? o.etapes) as unknown[]) : []).map((s) => text(s, 600)).filter(Boolean).slice(0, 30);
  return {
    format: 'mychef-recipe',
    v: 1,
    title,
    servings: Math.round(num(o.servings ?? o.portions, 50) ?? 2),
    ...(num(o.minutes ?? o.temps, 1440) ? { minutes: Math.round(num(o.minutes ?? o.temps, 1440)!) } : {}),
    ingredients,
    steps,
    tags: (Array.isArray(o.tags) ? o.tags : []).map((t) => text(t, 20).toLowerCase()).filter(Boolean).slice(0, 8),
  };
}

const UNITS: readonly [RegExp, string][] = [
  [/^(kg|kilos?|kilogrammes?)$/, 'kg'],
  [/^(g|gr|grammes?)$/, 'g'],
  [/^(l|litres?)$/, 'L'],
  [/^(cl|centilitres?)$/, 'cl'],
  [/^(ml|millilitres?)$/, 'ml'],
  [/^(c\.?\s?a\.?\s?s\.?|cas|c\.?\s?a\s?soupe|cuill?eres? a soupe|cuill?eres? soupe|cs)$/, 'c. à soupe'],
  [/^(c\.?\s?a\.?\s?c\.?|cac|c\.?\s?a\s?cafe|cuill?eres? a cafe|cuill?eres? cafe|cc)$/, 'c. à café'],
  [/^(cubes?)$/, 'cube'],
  [/^(rouleaux?)$/, 'rouleau'],
  [/^(pots?)$/, 'pot'],
  [/^(paquets?)$/, 'paquet'],
  [/^(pincees?)$/, 'pincée'],
  [/^(tranches?)$/, 'tranche'],
  [/^(gousses?)$/, 'gousse'],
  [/^(boites?|boîtes?)$/, 'boîte'],
  [/^(sachets?)$/, 'sachet'],
  [/^(verres?)$/, 'verre'],
];

const plainLower = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** « 200 g de farine », « 3 œufs », « 1 c. à soupe d'huile », « sel » → un ingrédient. */
export function parseIngredientLine(line: string): Ingredient | null {
  let s = line.replace(/^[-•*·\d]+[.)]\s+/, '').replace(/^[-•*·]\s*/, '').trim();
  if (!s) return null;
  const optional = /\((facultatif|optionnel)\)|facultatif|optionnel/i.test(s);
  s = s.replace(/\((facultatif|optionnel)\)/gi, '').replace(/\b(facultatif|optionnel)\b/gi, '').trim();
  const m = /^(\d+(?:[.,]\d+)?|\d+\/\d+|½|¼)\s*(.*)$/.exec(s);
  let qty: number | undefined;
  let rest = s;
  if (m) {
    const raw = m[1]!;
    qty = raw === '½' ? 0.5 : raw === '¼' ? 0.25 : raw.includes('/') ? Number(raw.split('/')[0]) / Number(raw.split('/')[1]) : Number(raw.replace(',', '.'));
    rest = m[2]!.trim();
  }
  let unit: string | undefined;
  if (qty !== undefined) {
    // L'unité : un ou trois mots (« c. à soupe »), puis « de » / « d' ».
    const words = rest.split(/\s+/);
    for (const n of [3, 2, 1]) {
      const candidate = plainLower(words.slice(0, n).join(' ')).replace(/[.]+$/, '');
      const found = UNITS.find(([re]) => re.test(candidate));
      if (found) {
        unit = found[1];
        rest = words.slice(n).join(' ');
        break;
      }
    }
  }
  rest = rest.replace(/^(de |d['’]|des |du )/i, '').trim();
  if (!rest) return null;
  const name = rest.charAt(0).toUpperCase() + rest.slice(1);
  return { name: name.slice(0, 60), ...(qty !== undefined && Number.isFinite(qty) && qty > 0 ? { qty: Math.round(qty * 100) / 100 } : {}), ...(unit ? { unit } : {}), ...(optional ? { optional: true } : {}) };
}

/**
 * Une recette collée telle qu'elle est écrite (titre en première ligne, « Ingrédients », « Préparation ») : un
 * analyseur à règles, sans IA. Ce qui n'est pas compris est signalé, jamais inventé.
 */
export function parseRecipeText(input: string): { recipe: Recipe | null; ignored: string[] } {
  const lines = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { recipe: null, ignored: [] };
  let title = lines[0]!.replace(/^#+\s*/, '');
  let mode: 'head' | 'ing' | 'steps' = 'head';
  const ingredients: Ingredient[] = [];
  const steps: string[] = [];
  const ignored: string[] = [];
  let servings = 2;
  let minutes: number | undefined;
  for (const raw of lines.slice(1)) {
    const l = plainLower(raw);
    const serv = /(\d+)\s*(personnes?|pers\.?|portions?|parts?)/.exec(l);
    const time = /(\d+)\s*(min|minutes?)\b/.exec(l);
    if (/^ingredients?\s*:?$/.test(l)) {
      mode = 'ing';
      continue;
    }
    if (/^(preparation|etapes?|recette|instructions?)\s*:?$/.test(l)) {
      mode = 'steps';
      continue;
    }
    if (mode === 'head') {
      if (serv) servings = Number(serv[1]);
      if (time) minutes = Number(time[1]);
      if (!serv && !time) {
        // Pas d'en-tête de section : une ligne qui ressemble à un ingrédient ouvre la liste.
        const ing = parseIngredientLine(raw);
        if (ing && (ing.qty !== undefined || findFood(ing.name))) {
          mode = 'ing';
          ingredients.push(ing);
        } else ignored.push(raw);
      }
      continue;
    }
    if (mode === 'ing') {
      const ing = parseIngredientLine(raw);
      if (ing && raw.length <= 80) ingredients.push(ing);
      else {
        mode = 'steps';
        steps.push(raw.replace(/^\d+[.)]\s*/, ''));
      }
      continue;
    }
    steps.push(raw.replace(/^\d+[.)]\s*/, ''));
  }
  title = title.slice(0, 80);
  return { recipe: parseRecipe({ title, servings, minutes, ingredients, steps, tags: [] }), ignored };
}

/** La demande à coller dans n'importe quelle IA (avec la recette, une photo de livre, une capture). */
export const RECIPE_PROMPT = `Mets cette recette au format de l'application MyChef. Réponds UNIQUEMENT par un objet JSON valide, sans texte autour :

{
  "format": "mychef-recipe",
  "v": 1,
  "title": "nom de la recette",
  "servings": nombre de personnes,
  "minutes": temps total en minutes,
  "ingredients": [ { "name": "aliment (sans la quantité)", "qty": nombre, "unit": "g | kg | ml | cl | L | c. à soupe | c. à café | pincée | tranche | gousse | boîte (ou rien pour un nombre de pièces)", "optional": true si facultatif } ],
  "steps": [ "une étape par élément, dans l'ordre" ],
  "tags": [ "rapide", "végé", "protéiné", "batch", "sans four"… si c'est le cas ]
}

N'invente rien : ce qui n'est pas dans la recette n'y est pas. Voici la recette :
`;

// ---------------------------------------------------------------- recettes fournies (génériques)

const R = (title: string, servings: number, minutes: number, ingredients: string[], steps: string[], tags: string[]): Recipe =>
  parseRecipe({ title, servings, minutes, ingredients, steps, tags })!;

export const STARTER_RECIPES: readonly Recipe[] = [
  R('Pâtes à la tomate', 2, 20, ['200 g de pâtes', '1 boîte de tomates concassées', '1 gousse d’ail', '1 c. à soupe d’huile d’olive', 'Herbes fraîches (facultatif)', 'Fromage râpé (facultatif)'], ['Fais cuire les pâtes 10 min dans l’eau salée.', 'Fais revenir l’ail haché dans l’huile 1 min, ajoute les tomates, laisse mijoter 10 min.', 'Mélange avec les pâtes, sers avec le fromage.'], ['rapide', 'végé']),
  R('Omelette', 1, 10, ['3 œufs', '20 g de beurre', 'Fromage râpé (facultatif)', 'Herbes fraîches (facultatif)'], ['Bats les œufs avec sel et poivre.', 'Fais fondre le beurre, verse les œufs, cuis 3 min à feu moyen.', 'Garnis, plie, sers.'], ['rapide', 'végé', 'protéiné']),
  R('Riz sauté aux légumes et œufs', 2, 20, ['200 g de riz', '2 œufs', '1 oignon', '1 carotte', '100 g de légumes surgelés', '2 c. à soupe d’huile'], ['Fais cuire le riz 12 min.', 'Fais revenir oignon et carotte 5 min, ajoute les légumes surgelés.', 'Pousse sur le côté, brouille les œufs, mélange avec le riz.'], ['rapide']),
  R('Soupe de légumes', 4, 35, ['3 carottes', '2 pommes de terre', '1 courgette', '1 oignon', '1 cube de bouillon', '1 L d’eau'], ['Coupe les légumes en morceaux.', 'Fais revenir l’oignon, ajoute légumes, bouillon et eau.', 'Cuis 25 min, mixe.'], ['végé', 'batch']),
  R('Poulet au curry', 2, 30, ['300 g de poulet', '1 oignon', '20 cl de crème', '1 c. à café de curry', '150 g de riz'], ['Fais cuire le riz.', 'Fais dorer le poulet en morceaux avec l’oignon 8 min.', 'Ajoute curry et crème, mijote 10 min.'], ['protéiné']),
  R('Lentilles mijotées', 3, 35, ['250 g de lentilles', '1 oignon', '2 carottes', '1 cube de bouillon', '100 g de lardons (facultatif)'], ['Fais revenir oignon et carottes (et lardons).', 'Ajoute lentilles, bouillon et 3 fois leur volume d’eau.', 'Cuis 25 min.'], ['batch', 'protéiné']),
  R('Crêpes', 4, 30, ['250 g de farine', '4 œufs', '50 cl de lait', '30 g de beurre'], ['Mélange farine et œufs, ajoute le lait petit à petit, puis le beurre fondu.', 'Laisse reposer si tu peux.', 'Cuis les crêpes 1 min par face.'], ['végé']),
  R('Salade composée', 2, 15, ['1 salade', '2 tomates', '1 boîte de thon', '2 œufs', '1 c. à soupe de moutarde', '3 c. à soupe d’huile d’olive', '1 c. à soupe de vinaigre'], ['Cuis les œufs 9 min.', 'Prépare la vinaigrette.', 'Mélange salade, tomates, thon et œufs.'], ['rapide', 'sans four', 'protéiné']),
  R('Gratin de pommes de terre', 4, 60, ['1 kg de pommes de terre', '30 cl de crème', '100 g de fromage râpé', '1 gousse d’ail'], ['Coupe les pommes de terre en rondelles fines.', 'Frotte le plat avec l’ail, alterne pommes de terre et crème.', 'Couvre de fromage, 45 min au four à 180 °C.'], ['végé']),
  R('Croque-monsieur', 2, 15, ['4 tranches de pain', '2 tranches de jambon', '60 g de fromage râpé', '20 g de beurre'], ['Beurre le pain, garnis de jambon et de fromage.', '10 min au four (ou à la poêle).'], ['rapide']),
  R('Guacamole', 2, 10, ['2 avocats', '1 citron', '1 tomate', '1 oignon (facultatif)', 'Herbes fraîches (facultatif)'], ['Écrase les avocats avec le jus du citron.', 'Ajoute tomate et oignon en dés, sel, poivre.'], ['rapide', 'végé', 'sans four']),
  R('Porridge à la banane', 1, 8, ['50 g de flocons d’avoine', '25 cl de lait', '1 banane', '1 c. à café de miel (facultatif)'], ['Cuis les flocons dans le lait 5 min en remuant.', 'Ajoute la banane en rondelles et le miel.'], ['rapide', 'végé']),
];

// ---------------------------------------------------------------- avec ce que j'ai

export interface Availability {
  status: 'ready' | 'almost' | 'no';
  /** Ingrédients nécessaires absents (ni en stock, ni de base). */
  missing: Ingredient[];
  /** Combien d'ingrédients du garde-manger qui périment bientôt elle utilise. */
  usesExpiring: number;
}

/** Ce que le garde-manger a, par aliment (fini exclu). */
const inStock = (pantry: readonly PantryItem[]) => new Map(pantry.filter((p) => p.level !== 'out').map((p) => [foodKey(findFood(p.name)?.name ?? p.name), p]));
const keyOf = (name: string) => foodKey(findFood(name)?.name ?? name);

/** Faisable maintenant, à 1 ou 2 ingrédients près, ou non. */
export function availability(recipe: Recipe, pantry: readonly PantryItem[], expiring: ReadonlySet<string> = new Set()): Availability {
  const stock = inStock(pantry);
  const needed = recipe.ingredients.filter((i) => !i.optional && !BASICS.includes(keyOf(i.name)));
  const missing = needed.filter((i) => !stock.has(keyOf(i.name)));
  const usesExpiring = recipe.ingredients.filter((i) => expiring.has(keyOf(i.name))).length;
  return { status: missing.length === 0 ? 'ready' : missing.length <= 2 ? 'almost' : 'no', missing, usesExpiring };
}

/** Le classement : faisable d'abord, puis à peu près ; ce qui sauve un aliment qui périme ; puis le plus rapide. */
export function rankRecipes<T extends { value: Recipe }>(recipes: readonly T[], pantry: readonly PantryItem[], expiringNames: readonly string[]): (T & { availability: Availability })[] {
  const expiring = new Set(expiringNames.map(keyOf));
  const order = { ready: 0, almost: 1, no: 2 } as const;
  return recipes
    .map((r) => ({ ...r, availability: availability(r.value, pantry, expiring) }))
    .sort((a, b) => order[a.availability.status] - order[b.availability.status] || a.availability.missing.length - b.availability.missing.length || b.availability.usesExpiring - a.availability.usesExpiring || (a.value.minutes ?? 999) - (b.value.minutes ?? 999));
}

/** Les quantités pour un autre nombre de personnes. */
export function scaleRecipe(recipe: Recipe, servings: number): Recipe {
  const k = servings / Math.max(1, recipe.servings);
  return { ...recipe, servings, ingredients: recipe.ingredients.map((i) => (i.qty === undefined ? i : { ...i, qty: Math.round(i.qty * k * 100) / 100 })) };
}

/**
 * « J'ai cuisiné » : ce que la recette a pris au garde-manger. En quantité précise (même unité), on retire ; sinon le
 * niveau descend d'un cran (en stock → bientôt fini → fini). Renvoie les éléments modifiés, par clé d'aliment.
 */
export function afterCooking(recipe: Recipe, pantry: readonly { id: string; value: PantryItem }[]): { id: string; value: PantryItem }[] {
  const out: { id: string; value: PantryItem }[] = [];
  for (const ing of recipe.ingredients) {
    const key = keyOf(ing.name);
    if (BASICS.includes(key)) continue;
    const item = pantry.find((p) => p.value.level !== 'out' && keyOf(p.value.name) === key);
    if (!item) continue;
    const p = item.value;
    let next: PantryItem;
    if (p.qty !== undefined && ing.qty !== undefined && (p.unit ?? '') === (ing.unit ?? '')) {
      const qty = Math.max(0, Math.round((p.qty - ing.qty) * 100) / 100);
      next = { ...p, qty, level: qty === 0 ? 'out' : p.threshold !== undefined && qty <= p.threshold ? 'low' : p.level };
    } else next = { ...p, level: p.level === 'ok' ? 'low' : 'out' };
    out.push({ id: item.id, value: next });
  }
  return out;
}

/** Les minuteurs d'une étape (« cuis 12 min », « 1 h 30 ») en secondes. */
export function stepTimers(step: string): number[] {
  const out: number[] = [];
  const re = /(\d+)\s*h(?:eures?)?\s*(\d+)?|(\d+)\s*(?:min|minutes?)\b/gi;
  for (let m = re.exec(step); m; m = re.exec(step)) out.push(m[3] ? Number(m[3]) * 60 : Number(m[1]) * 3600 + Number(m[2] ?? 0) * 60);
  return out.filter((s) => s > 0 && s <= 12 * 3600).slice(0, 3);
}
