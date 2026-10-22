import type { Category, Rule, Settings } from '../src/db/types';
import { buildDefaultRules, CAT, DEFAULT_CATEGORIES } from '../src/domain/defaults';
import { newRule } from '../src/domain/learn';
import { normalizeSettings } from '../src/domain/settingsModel';

/**
 * Un profil personnalisé complet, tel qu'un utilisateur le configure (c'est aussi le profil v1 de
 * l'app, migré) : paie le 26, 1 537 € + 170 € d'APL, 359 € de charges fixes, 450 € investis.
 * Les tests métier tournent sur ce profil plutôt que sur les valeurs par défaut (vides).
 */
export const PROFILE: Settings = normalizeSettings({
  payday: 26,
  salary: 153700,
  apl: 17000,
  activityBonus: 0,
  fixedCharges: 35900,
  investment: 45000,
  ownerName: 'PABLO SENE',
  alerts: {
    deliveries: { enabled: true, maxCount: 4 },
    amazon: { enabled: true, minAmount: 0 },
    dailyOverrun: { enabled: true, days: 3 },
    transportPass: { enabled: true, passPrice: 10000, keyword: 'metropole' },
    categoryTarget: { enabled: true, warnPercent: 80 },
  },
});

const TARGETS: Record<string, number> = {
  [CAT.courses]: 15000,
  [CAT.restos]: 8000,
  [CAT.livraison]: 4000,
  [CAT.sorties]: 6000,
  [CAT.transport]: 3000,
  [CAT.shopping]: 5000,
  [CAT.sport]: 4000,
};

/** Catégories par défaut + objectifs + deux catégories personnelles. */
export const PROFILE_CATEGORIES: Category[] = [
  ...DEFAULT_CATEGORIES.map((c) => ({ ...c, target: TARGETS[c.id] ?? c.target })),
  { id: CAT.cantines, name: 'Cantines', emoji: '🍽️', color: '#2DD4BF', kind: 'variable', target: 6000, isFood: true, order: 50 },
  { id: CAT.tabac, name: 'Tabac', emoji: '🚬', color: '#94A3B8', kind: 'variable', target: 3000, isFood: false, order: 51 },
];

/** Règles par défaut + règles ajoutées par l'utilisateur (commerçants locaux, un ami). */
export const PROFILE_RULES: Rule[] = [
  ...buildDefaultRules(PROFILE.holderNames, 0),
  newRule({ id: 'u-eurest', categoryId: CAT.cantines, pattern: 'eurest', label: 'Eurest' }),
  newRule({ id: 'u-tabac', categoryId: CAT.tabac, pattern: 'tabac', label: 'Tabac' }),
  newRule({ id: 'u-lancelot', categoryId: CAT.remboursements, pattern: 'lancelot simon', person: 'Lancelot Simon', label: 'Lancelot Simon', priority: 30 }),
  newRule({ id: 'u-revolut', categoryId: CAT.transferts, pattern: 'top.?up', isRegex: true, label: 'Top up Revolut', priority: 50 }),
];
