// GÉNÉRÉ depuis MyLife/packages/lumen — ne pas modifier ici (MyLife : npm run vendor).
import { foodKey, findFood, type PantryItem, type ShoppingItem } from './chef';
import { BASICS, availability, type Ingredient, type Recipe } from './recipes';

/**
 * MyChef, palier 3 : le planning de la semaine. Moteur pur : une grille de jours (midi, soir), la proposition
 * automatique d'une semaine (ce qui périme d'abord, ce qui est faisable, de la variété, des restes, pas de dîner un soir
 * de sortie, plus de protéines un jour de séance), et la liste de courses qui en découle (quantités additionnées, sans
 * ce qu'il y a déjà).
 */

export type Slot = 'midi' | 'soir';
export const SLOTS: readonly Slot[] = ['midi', 'soir'];

export interface PlannedMeal {
  v: 1;
  day: string;
  slot: Slot;
  /** Identifiant de la recette (les tiennes ou `fournie-<n>`), absent pour un repas noté à la main. */
  recipeId?: string;
  title: string;
  servings: number;
  /** Les restes d'un repas précédent (rien à cuisiner). */
  leftover?: boolean;
}

export const mealId = (day: string, slot: Slot) => `${day}-${slot}`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function parsePlannedMeal(raw: unknown): PlannedMeal | null {
  const o = raw as Partial<PlannedMeal> | null;
  if (!o || o.v !== 1 || typeof o.day !== 'string' || !DATE.test(o.day) || (o.slot !== 'midi' && o.slot !== 'soir') || typeof o.title !== 'string' || !o.title.trim()) return null;
  return {
    v: 1,
    day: o.day,
    slot: o.slot,
    ...(typeof o.recipeId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(o.recipeId) ? { recipeId: o.recipeId } : {}),
    title: o.title.trim().slice(0, 80),
    servings: typeof o.servings === 'number' && o.servings >= 1 && o.servings <= 20 ? Math.round(o.servings) : 2,
    ...(o.leftover === true ? { leftover: true } : {}),
  };
}

export interface DayContext {
  /** Une sortie ce soir-là (agenda commun) : pas de dîner à prévoir. */
  outTonight?: string;
  /** Une séance de sport ce jour-là (agenda commun) : un plat protéiné de préférence. */
  training?: boolean;
}

export interface WeekInput {
  days: readonly string[];
  /** Repas déjà prévus (ils restent). */
  planned: readonly PlannedMeal[];
  recipes: readonly { id: string; value: Recipe }[];
  pantry: readonly PantryItem[];
  /** Noms des aliments qui périment bientôt. */
  expiring: readonly string[];
  context?: Readonly<Record<string, DayContext>>;
  /** Personnes à table (2 par défaut). */
  people?: number;
  slots?: readonly Slot[];
}

const keyOf = (name: string) => foodKey(findFood(name)?.name ?? name);

/**
 * Propose les repas des cases vides. Glouton et explicable : pour chaque case, la meilleure recette pas encore prise
 * cette semaine ; une recette faite pour au moins deux fois plus de monde que la table donne des restes au repas suivant.
 */
export function proposeWeek(input: WeekInput): PlannedMeal[] {
  const people = input.people ?? 2;
  const slots = input.slots ?? ['soir'];
  const taken = new Map(input.planned.map((m) => [mealId(m.day, m.slot), m]));
  const used = new Set(input.planned.map((m) => m.recipeId).filter(Boolean));
  const expiring = new Set(input.expiring.map(keyOf));
  // Stock simulé : ce qui est utilisé par une recette prévue n'est plus « à sauver » pour la suivante.
  const saved = new Set<string>();
  const out: PlannedMeal[] = [];
  const order = { ready: 0, almost: 1, no: 2 } as const;
  const cells: { day: string; slot: Slot }[] = input.days.flatMap((day) => SLOTS.filter((s) => slots.includes(s)).map((slot) => ({ day, slot })));
  for (const [n, cell] of cells.entries()) {
    const id = mealId(cell.day, cell.slot);
    if (taken.has(id)) continue;
    const ctx = input.context?.[cell.day];
    if (cell.slot === 'soir' && ctx?.outTonight) continue;
    const score = (r: { id: string; value: Recipe }) => {
      const a = availability(r.value, input.pantry, new Set([...expiring].filter((k) => !saved.has(k))));
      const protein = ctx?.training && r.value.tags.includes('protéiné') ? -1 : 0;
      return [order[a.status], -a.usesExpiring, protein, a.missing.length, r.value.minutes ?? 60] as const;
    };
    const candidates = input.recipes.filter((r) => !used.has(r.id)).map((r) => ({ r, s: score(r) }));
    candidates.sort((x, y) => {
      for (let i = 0; i < x.s.length; i++) if (x.s[i] !== y.s[i]) return (x.s[i] as number) - (y.s[i] as number);
      return x.r.value.title.localeCompare(y.r.value.title);
    });
    const best = candidates[0]?.r;
    if (!best) break;
    used.add(best.id);
    for (const ing of best.value.ingredients) saved.add(keyOf(ing.name));
    const servings = best.value.servings >= people * 2 ? people * 2 : people;
    out.push({ v: 1, day: cell.day, slot: cell.slot, recipeId: best.id, title: best.value.title, servings });
    taken.set(id, out[out.length - 1]!);
    // Les restes : le repas suivant, s'il est libre.
    const next = cells[n + 1];
    if (servings >= people * 2 && next && !taken.has(mealId(next.day, next.slot)) && !(next.slot === 'soir' && input.context?.[next.day]?.outTonight)) {
      const left: PlannedMeal = { v: 1, day: next.day, slot: next.slot, recipeId: best.id, title: `${best.value.title} (restes)`, servings: people, leftover: true };
      out.push(left);
      taken.set(mealId(next.day, next.slot), left);
    }
  }
  return out;
}

/**
 * Ce qu'il faut acheter pour les repas prévus : les ingrédients (aux portions prévues) qui ne sont ni en stock, ni de base,
 * ni déjà sur la liste ; même aliment et même unité additionnés.
 */
export function shoppingForPlan(meals: readonly PlannedMeal[], recipes: readonly { id: string; value: Recipe }[], pantry: readonly PantryItem[], list: readonly ShoppingItem[]): Ingredient[] {
  const have = new Set(pantry.filter((p) => p.level !== 'out').map((p) => keyOf(p.name)));
  const onList = new Set(list.filter((l) => !l.done).map((l) => keyOf(l.name)));
  const need = new Map<string, Ingredient>();
  for (const m of meals) {
    if (m.leftover || !m.recipeId) continue;
    const r = recipes.find((x) => x.id === m.recipeId)?.value;
    if (!r) continue;
    const k = m.servings / Math.max(1, r.servings);
    for (const ing of r.ingredients) {
      const key = keyOf(ing.name);
      if (ing.optional || BASICS.includes(key) || have.has(key) || onList.has(key)) continue;
      const slot = `${key}|${ing.unit ?? ''}`;
      const prev = need.get(slot);
      const qty = ing.qty === undefined ? undefined : Math.round(ing.qty * k * 100) / 100;
      need.set(slot, { name: findFood(ing.name)?.name ?? ing.name, ...(prev?.qty !== undefined || qty !== undefined ? { qty: Math.round(((prev?.qty ?? 0) + (qty ?? 0)) * 100) / 100 } : {}), ...(ing.unit ? { unit: ing.unit } : {}) });
    }
  }
  return [...need.values()];
}
