import type { FinanceData, Merchant, Movement, Nature } from './model';
import { normalizeText, titleCase } from './text';

/**
 * Les marchands : du libellé bancaire brut (« CB CARREFOUR CITY 4821 PARIS 11 ») au nom propre (« Carrefour City »).
 * On classe un marchand une fois ; ses mouvements passés et futurs suivent, sauf ceux corrigés un par un.
 */

/** Mots de la banque, pas du marchand. */
const NOISE = new Set(['cb', 'carte', 'paiement', 'par', 'achat', 'prlv', 'prelevement', 'prelevt', 'sepa', 'vir', 'virement', 'instantane', 'inst', 'recu', 'emis', 'de', 'du', 'vers', 'facture', 'ref', 'no', 'fr', 'eur', 'x']);
/** Terminaux de paiement : le marchand est ce qui suit. */
const PROCESSORS = new Set(['sumup', 'sq', 'zettle', 'izettle', 'paypal', 'lyf', 'stripe', 'sp', 'lydia']);
const MAX_WORDS = 3;

/** Clé stable d'un marchand, ou null si le libellé ne dit rien d'exploitable. */
export function merchantKey(label: string): string | null {
  const words = normalizeText(label)
    .split(' ')
    .filter((w) => w && !NOISE.has(w) && !/\d/.test(w));
  while (words.length > 1 && PROCESSORS.has(words[0]!)) words.shift();
  const key = words.slice(0, MAX_WORDS).join(' ');
  return key.length >= 2 ? key : null;
}

export const merchantId = (key: string) => `m:${key}`;
export const merchantName = (key: string) => titleCase(key);

/** Ce qu'un mouvement prend de son marchand, s'il n'a pas été corrigé à la main. */
export function applyMerchant(m: Movement, merchant: Merchant | undefined): Movement {
  if (m.edited || !merchant || merchant.nature === null) return m;
  // Une rentrée d'argent chez un marchand de dépense est un remboursement de cette dépense.
  const nature: Nature = merchant.nature === 'depense' && m.amount > 0 ? 'remboursement' : merchant.nature;
  const categoryId = nature === 'depense' || nature === 'remboursement' ? merchant.categoryId : null;
  if (m.nature === nature && m.categoryId === categoryId) return m;
  return { ...m, nature, categoryId, split: undefined };
}

/** Classer un marchand : il est retenu, et tous ses mouvements non corrigés suivent. */
export function classifyMerchant(data: FinanceData, id: string, choice: { nature: Nature; categoryId: string | null }): FinanceData {
  const merchants = data.merchants.map((x) => (x.id === id ? { ...x, nature: choice.nature, categoryId: choice.nature === 'depense' ? choice.categoryId : null, edited: true } : x));
  const merchant = merchants.find((x) => x.id === id);
  return { ...data, merchants, movements: data.movements.map((m) => (m.merchantId === id ? applyMerchant(m, merchant) : m)) };
}

/** Un mouvement reste à classer tant qu'on ne sait pas ce que c'est, ou qu'une dépense n'a pas de catégorie. */
export const needsClassifying = (m: Movement) => !m.pending && (m.nature === null || (m.nature === 'depense' && m.categoryId === null && !m.split?.length));

export interface ToClassify {
  merchantId: string | null;
  name: string;
  movements: Movement[];
  /** Somme des montants, en valeur absolue. */
  total: number;
}

/** « À classer », groupé par marchand, les plus gros d'abord. Les mouvements sans marchand restent seuls. */
export function toClassify(data: FinanceData): ToClassify[] {
  const names = new Map(data.merchants.map((m) => [m.id, m.name]));
  const groups = new Map<string, ToClassify>();
  for (const m of data.movements) {
    if (!needsClassifying(m)) continue;
    const key = m.merchantId ?? `solo:${m.id}`;
    const g = groups.get(key) ?? { merchantId: m.merchantId, name: (m.merchantId && names.get(m.merchantId)) || m.label, movements: [], total: 0 };
    g.movements.push(m);
    g.total += Math.abs(m.amount);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}
