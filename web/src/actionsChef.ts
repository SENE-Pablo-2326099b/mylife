import { mealId, runPendingActions, STARTER_RECIPES, type ActionSpec, type MyLifeAction, type ShoppingItem, type Slot } from './vendor/lumen';
import { loadCrews } from './crew';
import { listItemFor, plan, recipes, shopping } from './myChefData';
import { spaceSnapshot, writeSpace } from './spaceSync';

/**
 * Exécuteur de MyChef (actions validées, V4 F1) : ajouter à la liste de courses (la tienne, ou celle du foyer si tu en
 * as une), prévoir un repas, et leurs inverses. MyChef vit dans l'accueil : l'exécution est immédiate.
 */
async function activeList(): Promise<{ get: (id: string) => ShoppingItem | null; put: (id: string, v: ShoppingItem) => void; remove: (id: string) => void }> {
  const s = await loadCrews();
  const space = s.lists[0];
  if (space && s.uid) {
    const uid = s.uid;
    return {
      get: (id) => (spaceSnapshot(space.id).records.find((r) => r.tbl === 'item' && r.rid === id)?.row as ShoppingItem | undefined) ?? null,
      put: (id, v) => writeSpace(space, uid, 'item', id, v, true),
      remove: (id) => writeSpace(space, uid, 'item', id, null, true),
    };
  }
  return { get: (id) => shopping.get(id), put: (id, v) => shopping.put(id, v), remove: (id) => shopping.remove(id) };
}

const recipeTitle = (id: string) => recipes.get(id)?.title ?? (id.startsWith('fournie-') ? STARTER_RECIPES[Number(id.slice(8))]?.title : undefined);

async function execute(a: MyLifeAction): Promise<ActionSpec | null> {
  const p = a.params;
  if (a.kind === 'chef.addToList') {
    const list = await activeList();
    const { id, item } = listItemFor(String(p.name));
    const existing = list.get(id);
    if (existing && !existing.done) throw new Error(`${existing.name} est déjà sur la liste.`);
    list.put(id, { ...item, ...(typeof p.qty === 'number' ? { qty: p.qty, ...(typeof p.unit === 'string' ? { unit: p.unit } : {}) } : {}) });
    return { kind: 'chef.removeFromList', params: { itemId: id }, summary: `Retirer « ${item.name} » de la liste` };
  }
  if (a.kind === 'chef.removeFromList') {
    const list = await activeList();
    const id = String(p.itemId);
    const item = list.get(id);
    if (!item) throw new Error('Cet article n’est plus sur la liste.');
    list.remove(id);
    return { kind: 'chef.addToList', params: { name: item.name, ...(item.qty !== undefined ? { qty: item.qty, ...(item.unit ? { unit: item.unit } : {}) } : {}) }, summary: `Remettre « ${item.name} » sur la liste` };
  }
  if (a.kind === 'chef.planMeal' || a.kind === 'chef.clearMeal') {
    const day = String(p.day);
    const slot = p.slot as Slot;
    const id = mealId(day, slot);
    const before = plan.get(id);
    const restore: ActionSpec = before?.recipeId
      ? { kind: 'chef.planMeal', params: { day, slot, recipeId: before.recipeId }, summary: `Remettre « ${before.title} » au ${slot} du ${day}` }
      : { kind: 'chef.clearMeal', params: { day, slot }, summary: `Ne rien prévoir au ${slot} du ${day}` };
    if (a.kind === 'chef.clearMeal') {
      if (!before) throw new Error('Rien n’était prévu à ce repas.');
      plan.remove(id);
      return restore;
    }
    const title = recipeTitle(String(p.recipeId));
    if (!title) throw new Error('Cette recette n’existe plus dans MyChef.');
    plan.put(id, { v: 1, day, slot, recipeId: String(p.recipeId), title, servings: 2 });
    return restore;
  }
  throw new Error(`Action inconnue de MyChef : ${a.kind}`);
}

export const runChefActions = () => runPendingActions('chef', execute);
