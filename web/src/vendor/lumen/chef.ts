// GÉNÉRÉ depuis MyLife/packages/lumen — ne pas modifier ici (MyLife : npm run vendor).
/**
 * MyChef (V4, 3.4), palier 1 : le garde-manger et les courses. Moteur pur : un catalogue d'aliments courants (rayon,
 * lieu, durée de conservation), la reconnaissance tolérante d'un nom (pluriels, accents, majuscules), le stock (simple :
 * en stock / bientôt fini / fini ; ou précis : une quantité), les péremptions, les indispensables qui reviennent seuls
 * sur la liste, la liste rangée par rayon, et « cocher = acheté → en stock ». Rien de personnel par défaut.
 */

export type Place = 'frigo' | 'placard' | 'congel';
export type Level = 'ok' | 'low' | 'out';
export type Aisle = 'fruits' | 'frais' | 'viande' | 'boulangerie' | 'epicerie' | 'boissons' | 'surgeles' | 'hygiene' | 'maison' | 'autre';

export const AISLES: readonly { id: Aisle; name: string }[] = [
  { id: 'fruits', name: 'Fruits et légumes' },
  { id: 'boulangerie', name: 'Boulangerie' },
  { id: 'frais', name: 'Frais (crèmerie, œufs)' },
  { id: 'viande', name: 'Viande et poisson' },
  { id: 'epicerie', name: 'Épicerie' },
  { id: 'boissons', name: 'Boissons' },
  { id: 'surgeles', name: 'Surgelés' },
  { id: 'hygiene', name: 'Hygiène' },
  { id: 'maison', name: 'Maison' },
  { id: 'autre', name: 'Autre' },
];
export const PLACES: readonly { id: Place; name: string }[] = [
  { id: 'frigo', name: 'Frigo' },
  { id: 'placard', name: 'Placard' },
  { id: 'congel', name: 'Congélateur' },
];

/** Un aliment du catalogue : rayon, lieu habituel, jours de conservation une fois acheté (indicatif), unité usuelle. */
export interface Food {
  name: string;
  aisle: Aisle;
  place: Place;
  days?: number;
  unit?: string;
  /** Autres noms reconnus (« oeuf », « tomate cerise »…). */
  also?: string[];
}

const F = (name: string, aisle: Aisle, place: Place, days?: number, unit?: string, also?: string[]): Food => ({ name, aisle, place, ...(days ? { days } : {}), ...(unit ? { unit } : {}), ...(also ? { also } : {}) });

/** Catalogue de départ : aliments courants, génériques (aucune habitude de quiconque). */
export const FOODS: readonly Food[] = [
  // Fruits et légumes
  F('Pommes', 'fruits', 'placard', 21, 'pièce'), F('Bananes', 'fruits', 'placard', 6, 'pièce'), F('Citrons', 'fruits', 'frigo', 21, 'pièce'), F('Oranges', 'fruits', 'placard', 14, 'pièce'),
  F('Tomates', 'fruits', 'placard', 6, 'pièce', ['tomate cerise', 'tomates cerises']), F('Salade', 'fruits', 'frigo', 5, undefined, ['laitue', 'mache', 'roquette']), F('Carottes', 'fruits', 'frigo', 21, 'pièce'),
  F('Oignons', 'fruits', 'placard', 30, 'pièce', ['oignon rouge']), F('Ail', 'fruits', 'placard', 60, 'tête'), F('Échalotes', 'fruits', 'placard', 30), F('Pommes de terre', 'fruits', 'placard', 30, 'kg', ['patates']),
  F('Courgettes', 'fruits', 'frigo', 7, 'pièce'), F('Poivrons', 'fruits', 'frigo', 7, 'pièce'), F('Concombre', 'fruits', 'frigo', 7, 'pièce'), F('Champignons', 'fruits', 'frigo', 5, 'g'),
  F('Brocoli', 'fruits', 'frigo', 5), F('Épinards', 'fruits', 'frigo', 4, 'g'), F('Avocats', 'fruits', 'placard', 5, 'pièce'), F('Fruits rouges', 'fruits', 'frigo', 3, 'g', ['fraises', 'framboises', 'myrtilles']),
  F('Herbes fraîches', 'fruits', 'frigo', 6, undefined, ['persil', 'coriandre', 'basilic', 'ciboulette']),
  // Boulangerie
  F('Pain', 'boulangerie', 'placard', 2, undefined, ['baguette', 'pain de mie']), F('Tortillas', 'boulangerie', 'placard', 14, 'paquet', ['wraps']),
  // Frais
  F('Lait', 'frais', 'frigo', 7, 'L'), F('Œufs', 'frais', 'frigo', 28, 'pièce', ['oeuf', 'oeufs']), F('Beurre', 'frais', 'frigo', 30, 'g'), F('Yaourts', 'frais', 'frigo', 14, 'pot', ['yaourt grec', 'skyr']),
  F('Fromage râpé', 'frais', 'frigo', 21, 'g', ['emmental rape', 'gruyere rape']), F('Fromage', 'frais', 'frigo', 14, 'g', ['comte', 'emmental', 'chevre', 'camembert', 'mozzarella', 'feta']),
  F('Crème fraîche', 'frais', 'frigo', 10, 'cl', ['creme', 'creme liquide']), F('Jambon', 'frais', 'frigo', 5, 'tranche'), F('Lardons', 'frais', 'frigo', 7, 'g'), F('Tofu', 'frais', 'frigo', 10, 'g'),
  F('Pâte feuilletée', 'frais', 'frigo', 10, 'rouleau', ['pate brisee', 'pate a pizza']),
  // Viande et poisson
  F('Poulet', 'viande', 'frigo', 2, 'g', ['blanc de poulet', 'escalope de poulet', 'filet de poulet']), F('Bœuf haché', 'viande', 'frigo', 1, 'g', ['steak hache', 'viande hachee']),
  F('Saumon', 'viande', 'frigo', 2, 'g'), F('Thon en boîte', 'epicerie', 'placard', 365, 'boîte', ['thon']), F('Poisson blanc', 'viande', 'frigo', 2, 'g', ['cabillaud', 'colin']),
  // Épicerie
  F('Pâtes', 'epicerie', 'placard', 365, 'g', ['spaghetti', 'penne', 'coquillettes']), F('Riz', 'epicerie', 'placard', 365, 'g'), F('Farine', 'epicerie', 'placard', 240, 'g'), F('Sucre', 'epicerie', 'placard', 720, 'g'),
  F('Huile d’olive', 'epicerie', 'placard', 365, 'L', ['huile']), F('Vinaigre', 'epicerie', 'placard', 720), F('Sel', 'epicerie', 'placard'), F('Poivre', 'epicerie', 'placard'), F('Épices', 'epicerie', 'placard', 365, undefined, ['paprika', 'cumin', 'curry']),
  F('Lentilles', 'epicerie', 'placard', 365, 'g'), F('Pois chiches', 'epicerie', 'placard', 365, 'boîte'), F('Haricots rouges', 'epicerie', 'placard', 365, 'boîte'), F('Tomates concassées', 'epicerie', 'placard', 365, 'boîte', ['coulis de tomate', 'sauce tomate']),
  F('Flocons d’avoine', 'epicerie', 'placard', 240, 'g', ['avoine']), F('Céréales', 'epicerie', 'placard', 120, 'boîte'), F('Café', 'epicerie', 'placard', 120, 'paquet'), F('Thé', 'epicerie', 'placard', 365, 'boîte'),
  F('Chocolat', 'epicerie', 'placard', 180, 'tablette'), F('Miel', 'epicerie', 'placard', 720, 'pot'), F('Confiture', 'epicerie', 'placard', 180, 'pot'), F('Moutarde', 'epicerie', 'frigo', 180, 'pot'),
  F('Bouillon', 'epicerie', 'placard', 365, 'cube'), F('Fruits secs', 'epicerie', 'placard', 180, 'g', ['amandes', 'noix', 'noisettes']), F('Beurre de cacahuète', 'epicerie', 'placard', 180, 'pot'),
  // Boissons
  F('Eau', 'boissons', 'placard', undefined, 'bouteille', ['eau gazeuse']), F('Jus de fruits', 'boissons', 'frigo', 7, 'L', ['jus d orange']),
  // Surgelés
  F('Légumes surgelés', 'surgeles', 'congel', 180, 'g', ['petits pois', 'haricots verts']), F('Frites', 'surgeles', 'congel', 180, 'g'), F('Glace', 'surgeles', 'congel', 180, 'pot'),
  // Hygiène, maison
  F('Papier toilette', 'hygiene', 'placard', undefined, 'rouleau'), F('Dentifrice', 'hygiene', 'placard'), F('Gel douche', 'hygiene', 'placard'), F('Liquide vaisselle', 'maison', 'placard'),
  F('Lessive', 'maison', 'placard'), F('Sacs poubelle', 'maison', 'placard', undefined, 'rouleau'), F('Essuie-tout', 'maison', 'placard', undefined, 'rouleau', ['sopalin']),
];

/** Clé d'un nom : minuscules, sans accents ni ponctuation, chaque mot au singulier (« Œufs frais » → « oeuf frai »). */
export function foodKey(name: string): string {
  return name
    .replace(/œ/gi, 'oe')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length > 3 ? w.replace(/(s|x)$/, '') : w))
    .join(' ');
}

const INDEX = new Map<string, Food>();
for (const f of FOODS) for (const n of [f.name, ...(f.also ?? [])]) INDEX.set(foodKey(n), f);

/** L'aliment du catalogue qui correspond à un nom tapé, ou null (un aliment inconnu reste possible, rangé « Autre »). */
export function findFood(name: string): Food | null {
  const k = foodKey(name);
  if (!k) return null;
  return INDEX.get(k) ?? null;
}

/** Suggestions pendant la saisie : le catalogue, en commençant par ce qui commence comme le texte tapé. */
export function suggestFoods(text: string, limit = 6): Food[] {
  const k = foodKey(text);
  if (k.length < 2) return [];
  const starts: Food[] = [];
  const contains: Food[] = [];
  for (const f of FOODS) {
    const keys = [f.name, ...(f.also ?? [])].map(foodKey);
    if (keys.some((x) => x.startsWith(k))) starts.push(f);
    else if (keys.some((x) => x.includes(k))) contains.push(f);
  }
  return [...starts, ...contains].slice(0, limit);
}

// ---------------------------------------------------------------- garde-manger

export interface PantryItem {
  v: 1;
  name: string;
  place: Place;
  aisle: Aisle;
  /** Simple : en stock, bientôt fini, fini. */
  level: Level;
  /** Précis (facultatif) : une quantité et son unité. */
  qty?: number;
  unit?: string;
  /** Date limite (DLC ou DDM, AAAA-MM-JJ). */
  expires?: string;
  /** Indispensable : revient tout seul sur la liste quand il est bientôt fini (ou sous ce seuil, en précis). */
  staple?: boolean;
  threshold?: number;
}

export interface ShoppingItem {
  v: 1;
  name: string;
  aisle: Aisle;
  qty?: number;
  unit?: string;
  /** Ajouté tout seul (indispensable à racheter) ou à la main. */
  auto?: boolean;
  /** Coché en magasin. */
  done?: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AISLE_IDS = AISLES.map((a) => a.id) as readonly string[];
const PLACE_IDS = PLACES.map((p) => p.id) as readonly string[];
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e6 ? Math.round(v * 100) / 100 : undefined);

export function parsePantryItem(raw: unknown): PantryItem | null {
  const o = raw as Record<string, unknown> | null;
  const name = text(o?.name, 60);
  if (!o || o.v !== 1 || !name) return null;
  const qty = num(o.qty);
  const threshold = num(o.threshold);
  return {
    v: 1,
    name,
    place: PLACE_IDS.includes(o.place as string) ? (o.place as Place) : 'placard',
    aisle: AISLE_IDS.includes(o.aisle as string) ? (o.aisle as Aisle) : 'autre',
    level: o.level === 'low' || o.level === 'out' ? o.level : 'ok',
    ...(qty !== undefined ? { qty } : {}),
    ...(qty !== undefined && text(o.unit, 12) ? { unit: text(o.unit, 12) } : {}),
    ...(typeof o.expires === 'string' && DATE.test(o.expires) ? { expires: o.expires } : {}),
    ...(o.staple === true ? { staple: true } : {}),
    ...(o.staple === true && threshold !== undefined ? { threshold } : {}),
  };
}

export function parseShoppingItem(raw: unknown): ShoppingItem | null {
  const o = raw as Record<string, unknown> | null;
  const name = text(o?.name, 60);
  if (!o || o.v !== 1 || !name) return null;
  const qty = num(o.qty);
  return {
    v: 1,
    name,
    aisle: AISLE_IDS.includes(o.aisle as string) ? (o.aisle as Aisle) : 'autre',
    ...(qty !== undefined ? { qty } : {}),
    ...(qty !== undefined && text(o.unit, 12) ? { unit: text(o.unit, 12) } : {}),
    ...(o.auto === true ? { auto: true } : {}),
    ...(o.done === true ? { done: true } : {}),
  };
}

const DAY = 86_400_000;
const ms = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
export const addDaysIso = (iso: string, n: number) => new Date(ms(iso) + n * DAY).toISOString().slice(0, 10);
export const daysUntil = (iso: string, today: string) => Math.round((ms(iso) - ms(today)) / DAY);

/** Un nouvel élément du stock à partir d'un nom : rayon, lieu et date limite proposés par le catalogue. */
export function newPantryItem(name: string, today: string, over: Partial<PantryItem> = {}): PantryItem {
  const food = findFood(name);
  return {
    v: 1,
    name: food?.name ?? text(name, 60),
    place: food?.place ?? 'placard',
    aisle: food?.aisle ?? 'autre',
    level: 'ok',
    ...(food?.days && food.days <= 60 ? { expires: addDaysIso(today, food.days) } : {}),
    ...over,
  };
}

/** Bientôt fini (ou fini) ? En précis : sous son seuil d'indispensable. */
export function isRunningLow(p: PantryItem): boolean {
  if (p.level !== 'ok') return true;
  return p.qty !== undefined && p.threshold !== undefined && p.qty <= p.threshold;
}

/** « À finir vite » : ce qui périme dans les `days` jours (déjà périmé compris), le plus pressé d'abord. */
export function expiringSoon<T extends { value: PantryItem }>(items: readonly T[], today: string, days = 3): T[] {
  return items
    .filter((i) => i.value.level !== 'out' && i.value.expires && daysUntil(i.value.expires, today) <= days)
    .sort((a, b) => a.value.expires!.localeCompare(b.value.expires!));
}

/** Les indispensables à racheter qui ne sont pas déjà sur la liste (par clé d'aliment). */
export function staplesToBuy<T extends { id: string; value: PantryItem }>(pantry: readonly T[], list: readonly { id: string; value: ShoppingItem }[]): T[] {
  const onList = new Set(list.filter((l) => !l.value.done).map((l) => foodKey(l.value.name)));
  return pantry.filter((p) => p.value.staple && isRunningLow(p.value) && !onList.has(foodKey(p.value.name)));
}

/** La liste rangée par rayon (dans l'ordre du magasin), ce qui reste à prendre d'abord. */
export function byAisle<T extends { value: ShoppingItem }>(list: readonly T[]): { aisle: Aisle; name: string; items: T[] }[] {
  return AISLES.map((a) => ({ aisle: a.id, name: a.name, items: list.filter((l) => l.value.aisle === a.id).sort((x, y) => Number(!!x.value.done) - Number(!!y.value.done) || x.value.name.localeCompare(y.value.name)) })).filter((g) => g.items.length);
}

/** Un article coché en magasin entre dans le stock : il redevient « en stock », la quantité s'ajoute, la date repart. */
export function stockAfterPurchase(existing: PantryItem | null, bought: ShoppingItem, today: string): PantryItem {
  const fresh = newPantryItem(bought.name, today);
  if (!existing) return { ...fresh, aisle: bought.aisle, ...(bought.qty !== undefined ? { qty: bought.qty, ...(bought.unit ? { unit: bought.unit } : {}) } : {}) };
  const qty = existing.qty !== undefined || bought.qty !== undefined ? Math.round(((existing.qty ?? 0) + (bought.qty ?? 0)) * 100) / 100 : undefined;
  const { expires: _old, ...rest } = existing;
  void _old;
  return { ...rest, level: 'ok', ...(qty !== undefined ? { qty } : {}), ...(fresh.expires ? { expires: fresh.expires } : {}) };
}

/** Identifiant stable d'un aliment (même aliment = même ligne, sur tous les appareils) : sa clé, sans espaces. */
export const foodId = (name: string) => foodKey(name).replace(/ /g, '-').slice(0, 64) || 'aliment';
