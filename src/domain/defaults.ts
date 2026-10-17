import type { AlertSettings, Category, Rule, RuleDirection, Settings } from '../db/types';

export const CAT = {
  courses: 'courses',
  cantines: 'cantines',
  restos: 'restos',
  livraison: 'livraison',
  sorties: 'sorties',
  transport: 'transport',
  shopping: 'shopping',
  tabac: 'tabac',
  trading: 'trading',
  abonnements: 'abonnements',
  sport: 'sport',
  logement: 'logement',
  autres: 'autres',
  revenus: 'revenus',
  transferts: 'transferts',
  epargne: 'epargne',
  remboursements: 'remboursements',
} as const;

type CatSeed = Omit<Category, 'order'>;

const seeds: CatSeed[] = [
  { id: CAT.courses, name: 'Courses', emoji: '🛒', color: '#3987e5', kind: 'variable', target: 15000, isFood: true },
  { id: CAT.cantines, name: 'Cantines', emoji: '🍽️', color: '#199e70', kind: 'variable', target: 6000, isFood: true },
  { id: CAT.restos, name: 'Restos & snacks', emoji: '🌮', color: '#d95926', kind: 'variable', target: 8000, isFood: true },
  { id: CAT.livraison, name: 'Livraison', emoji: '🛵', color: '#e66767', kind: 'variable', target: 4000, isFood: true },
  { id: CAT.sorties, name: 'Sorties', emoji: '🍻', color: '#9085e9', kind: 'variable', target: 6000, isFood: false },
  { id: CAT.transport, name: 'Transport', emoji: '🚌', color: '#c98500', kind: 'variable', target: 3000, isFood: false },
  { id: CAT.shopping, name: 'Shopping', emoji: '🛍️', color: '#d55181', kind: 'variable', target: 5000, isFood: false },
  { id: CAT.tabac, name: 'Tabac / vape', emoji: '🚬', color: '#8a8a85', kind: 'variable', target: 3000, isFood: false },
  { id: CAT.trading, name: 'Trading / prop firm', emoji: '📈', color: '#3987e5', kind: 'variable', target: null, isFood: false },
  { id: CAT.abonnements, name: 'Abonnements', emoji: '🔁', color: '#9085e9', kind: 'fixed', target: null, isFood: false },
  { id: CAT.sport, name: 'Sport & nutrition', emoji: '💪', color: '#199e70', kind: 'variable', target: 4000, isFood: false },
  { id: CAT.logement, name: 'Logement', emoji: '🏠', color: '#c98500', kind: 'fixed', target: null, isFood: false },
  { id: CAT.autres, name: 'Autres', emoji: '📦', color: '#8a8a85', kind: 'variable', target: null, isFood: false, system: true },
  { id: CAT.revenus, name: 'Revenus', emoji: '💶', color: '#008300', kind: 'income', target: null, isFood: false, system: true },
  { id: CAT.transferts, name: 'Transferts internes', emoji: '🔄', color: '#6f6e69', kind: 'excluded', target: null, isFood: false, system: true },
  { id: CAT.epargne, name: 'Épargne / investissement', emoji: '🏦', color: '#6f6e69', kind: 'excluded', target: null, isFood: false, system: true },
  { id: CAT.remboursements, name: 'Remboursements entre amis', emoji: '🤝', color: '#6f6e69', kind: 'excluded', target: null, isFood: false, system: true },
];

export const DEFAULT_CATEGORIES: Category[] = seeds.map((c, i) => ({ ...c, order: i }));

interface RuleSeed {
  cat: string;
  label: string;
  pattern: string;
  regex?: boolean;
  direction?: RuleDirection;
  min?: number;
  max?: number;
  person?: string;
  priority?: number;
}

function ruleSeeds(ownerName: string): RuleSeed[] {
  const owner = ownerName.trim();
  const ownerRegex = owner
    ? owner
        .split(/\s+/)
        .map((w) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ''))
        .join('.{0,3}')
    : '';
  const seeds: RuleSeed[] = [
    // Courses
    { cat: CAT.courses, label: 'Intermarché', pattern: 'intermarche' },
    { cat: CAT.courses, label: 'Albert Heijn', pattern: 'albert heijn' },
    { cat: CAT.courses, label: 'Huile Provençale', pattern: 'huile provencale' },
    // Cantines
    { cat: CAT.cantines, label: 'Eurest (cantine CEA)', pattern: 'eurest' },
    { cat: CAT.cantines, label: 'Crous', pattern: 'crous', max: 3000 },
    { cat: CAT.cantines, label: 'Cafétéria IUT', pattern: 'cafeteria iut' },
    { cat: CAT.cantines, label: 'Le Tropical', pattern: 'le tropical' },
    { cat: CAT.cantines, label: 'Le Campus', pattern: 'le campus' },
    // Restos & snacks
    { cat: CAT.restos, label: 'Machou', pattern: 'machou' },
    { cat: CAT.restos, label: "O'Tacos", pattern: 'o ?tacos', regex: true },
    { cat: CAT.restos, label: 'Crouzzeria', pattern: 'crouzzeria' },
    { cat: CAT.restos, label: 'Matefio', pattern: 'matefio' },
    { cat: CAT.restos, label: 'Porzione Fabrot', pattern: 'porzione' },
    { cat: CAT.restos, label: "L'Estello", pattern: 'estello' },
    { cat: CAT.restos, label: 'Gazelle', pattern: 'gazelle' },
    { cat: CAT.restos, label: 'Sb Aix', pattern: 'sb aix' },
    // Livraison
    { cat: CAT.livraison, label: 'Deliveroo', pattern: 'deliveroo' },
    { cat: CAT.livraison, label: 'Uber Eats', pattern: 'uber ?eats', regex: true, priority: 5 },
    // Sorties
    { cat: CAT.sorties, label: 'Bar des PTT', pattern: 'bar des ptt' },
    { cat: CAT.sorties, label: 'Les Chansons Du', pattern: 'les chansons du' },
    { cat: CAT.sorties, label: "Bel'Rencontre", pattern: 'bel ?rencontre', regex: true },
    // Transport
    { cat: CAT.transport, label: 'Métropole Aix-Marseille-Provence', pattern: 'metropole aix marseille' },
    { cat: CAT.transport, label: 'Métropole AMP', pattern: 'metropole amp' },
    { cat: CAT.transport, label: 'Sud Mobilités', pattern: 'sud mobilites' },
    // Shopping
    { cat: CAT.shopping, label: 'Amazon', pattern: 'amazon|amzn', regex: true },
    { cat: CAT.shopping, label: 'Bsa Shop', pattern: 'bsa shop' },
    { cat: CAT.shopping, label: 'Superdry', pattern: 'superdry' },
    // Tabac
    { cat: CAT.tabac, label: 'Tabac Presse', pattern: 'tabac' },
    // Trading
    { cat: CAT.trading, label: 'GetLeveraged', pattern: 'leveraged' },
    // Abonnements
    { cat: CAT.abonnements, label: 'Anthropic / Claude', pattern: 'anthropic|claude\\.ai|claude ai', regex: true },
    { cat: CAT.abonnements, label: 'SoundCloud', pattern: 'soundcloud' },
    { cat: CAT.abonnements, label: 'Google', pattern: 'google' },
    { cat: CAT.abonnements, label: 'Cardif', pattern: 'cardif' },
    {
      cat: CAT.abonnements,
      label: 'Forfait téléphone',
      pattern: 'free mobile|sosh|red by sfr|\\bsfr\\b|bouygues telecom|b and you|orange sa|prixtel|lebara|forfait',
      regex: true,
    },
    // Sport
    { cat: CAT.sport, label: 'Fitness Park', pattern: 'fitness park' },
    { cat: CAT.sport, label: 'DistriProt', pattern: 'distriprot' },
    { cat: CAT.sport, label: 'Intersport', pattern: 'intersport' },
    // Logement : prélèvement CROUS supérieur à 100 € = loyer
    { cat: CAT.logement, label: 'Loyer CROUS', pattern: 'crous', min: 10000, direction: 'debit', priority: 20 },
    { cat: CAT.logement, label: 'Loyer', pattern: 'loyer', priority: 15 },
    // Transferts internes
    { cat: CAT.transferts, label: 'Top up Revolut', pattern: 'top.?up', regex: true, priority: 50 },
    { cat: CAT.transferts, label: 'Virement vers Revolut', pattern: '\\b(vir|virement)\\b.*revolut', regex: true, direction: 'debit', priority: 45 },
    // Épargne / investissement
    { cat: CAT.epargne, label: 'Trade Republic', pattern: 'trade republic', priority: 40 },
    { cat: CAT.epargne, label: 'Livret A', pattern: 'livret a', priority: 40 },
    { cat: CAT.epargne, label: 'PEA', pattern: '\\bpea\\b', regex: true, priority: 40 },
    { cat: CAT.epargne, label: 'PEE', pattern: '\\bpee\\b', regex: true, priority: 40 },
    { cat: CAT.epargne, label: 'Bitcoin', pattern: 'bitcoin|\\bbtc\\b', regex: true, priority: 40 },
    // Remboursements entre amis
    { cat: CAT.remboursements, label: 'Lancelot Simon', pattern: 'lancelot simon', person: 'Lancelot Simon', priority: 30 },
    // Revenus
    { cat: CAT.revenus, label: 'Salaire', pattern: 'salaire|paie|remuneration', regex: true, direction: 'credit', priority: 10 },
    { cat: CAT.revenus, label: 'CAF (APL, prime d’activité)', pattern: '\\bcaf\\b|\\bapl\\b|prime d.?activite', regex: true, direction: 'credit', priority: 10 },
  ];
  if (ownerRegex) {
    seeds.push({
      cat: CAT.transferts,
      label: `Virement entre mes comptes (${owner})`,
      pattern: `(paiement envoye par|payment from|virement (de|a|vers)|vir( sepa)?( inst)?( recu)?( de| a)?)\\W+(m\\.?\\W+|mr\\W+)?${ownerRegex}`,
      regex: true,
      priority: 60,
    });
  }
  return seeds;
}

export function buildDefaultRules(ownerName: string, now = Date.now()): Rule[] {
  return ruleSeeds(ownerName).map((s, i) => ({
    id: `default-${String(i).padStart(3, '0')}`,
    categoryId: s.cat,
    pattern: s.pattern,
    isRegex: !!s.regex,
    direction: s.direction ?? 'any',
    minAmount: s.min ?? null,
    maxAmount: s.max ?? null,
    person: s.person ?? null,
    priority: s.priority ?? 0,
    label: s.label,
    enabled: true,
    createdAt: now,
  }));
}

export const DEFAULT_ALERTS: AlertSettings = {
  deliveries: { enabled: true, maxCount: 4 },
  amazon: { enabled: true, minAmount: 0 },
  dailyOverrun: { enabled: true, days: 3 },
  transportPass: { enabled: true, passPrice: 10000, keyword: 'metropole' },
  categoryTarget: { enabled: true, warnPercent: 80 },
};

export const DEFAULT_SETTINGS: Settings = {
  id: 'main',
  payday: 26,
  salary: 153700,
  apl: 17000,
  activityBonus: 0,
  fixedCharges: 35900,
  investment: 45000,
  envelopeOverride: null,
  ownerName: 'PABLO SENE',
  alerts: DEFAULT_ALERTS,
  bridgePassword: '',
  initialSyncDays: 90,
  autoSyncHours: 6,
};

/** Enveloppe « vie courante » du cycle = revenus − charges fixes − investissement (sauf saisie manuelle). */
export function computeEnvelope(s: Settings): number {
  if (s.envelopeOverride !== null) return s.envelopeOverride;
  return defaultEnvelope(s);
}

export function defaultEnvelope(s: Pick<Settings, 'salary' | 'apl' | 'activityBonus' | 'fixedCharges' | 'investment'>): number {
  return s.salary + s.apl + s.activityBonus - s.fixedCharges - s.investment;
}

export function totalIncome(s: Settings): number {
  return s.salary + s.apl + s.activityBonus;
}
