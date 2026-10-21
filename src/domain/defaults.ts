import type { AlertSettings, BudgetLine, Category, FireSettings, Rule, RuleDirection, Settings } from '../db/types';
import { normalizeText } from '../lib/text';

/**
 * Valeurs de départ, pensées pour n'importe qui en France : catégories courantes, règles pour les
 * enseignes nationales, aucun réglage personnel (revenus, charges, noms) — l'accueil les demande.
 */

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
  sante: 'sante',
  logement: 'logement',
  autres: 'autres',
  revenus: 'revenus',
  transferts: 'transferts',
  epargne: 'epargne',
  remboursements: 'remboursements',
} as const;

type CatSeed = Omit<Category, 'order'>;

const seeds: CatSeed[] = [
  { id: CAT.courses, name: 'Courses', emoji: '🛒', color: '#2DD4BF', kind: 'variable', target: null, isFood: true },
  { id: CAT.restos, name: 'Restos & cafés', emoji: '🍽️', color: '#FBBF24', kind: 'variable', target: null, isFood: true },
  { id: CAT.livraison, name: 'Livraison', emoji: '🛵', color: '#F472B6', kind: 'variable', target: null, isFood: true },
  { id: CAT.sorties, name: 'Sorties & loisirs', emoji: '🎟️', color: '#60A5FA', kind: 'variable', target: null, isFood: false },
  { id: CAT.transport, name: 'Transport', emoji: '🚆', color: '#A3E635', kind: 'variable', target: null, isFood: false },
  { id: CAT.shopping, name: 'Shopping', emoji: '🛍️', color: '#FB923C', kind: 'variable', target: null, isFood: false },
  { id: CAT.sante, name: 'Santé', emoji: '🩺', color: '#C084FC', kind: 'variable', target: null, isFood: false },
  { id: CAT.sport, name: 'Sport', emoji: '💪', color: '#2DD4BF', kind: 'variable', target: null, isFood: false },
  { id: CAT.abonnements, name: 'Abonnements', emoji: '🔁', color: '#60A5FA', kind: 'fixed', target: null, isFood: false },
  { id: CAT.logement, name: 'Logement & énergie', emoji: '🏠', color: '#FBBF24', kind: 'fixed', target: null, isFood: false },
  { id: CAT.autres, name: 'Autres', emoji: '📦', color: '#94A3B8', kind: 'variable', target: null, isFood: false, system: true },
  { id: CAT.revenus, name: 'Revenus', emoji: '💶', color: '#4ADE80', kind: 'income', target: null, isFood: false, system: true },
  { id: CAT.transferts, name: 'Transferts internes', emoji: '🔄', color: '#94A3B8', kind: 'excluded', target: null, isFood: false, system: true },
  { id: CAT.epargne, name: 'Épargne & investissement', emoji: '🏦', color: '#94A3B8', kind: 'excluded', target: null, isFood: false, system: true },
  { id: CAT.remboursements, name: 'Entre amis', emoji: '🤝', color: '#94A3B8', kind: 'excluded', target: null, isFood: false, system: true },
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

/** Mots d'un nom propre, normalisés, pour une expression régulière tolérante (« M. », ponctuation). */
function nameRegex(name: string): string {
  return normalizeText(name)
    .split(' ')
    .filter(Boolean)
    .join('.{0,3}');
}

/** Enseignes nationales : de quoi classer automatiquement la plupart des opérations dès la première synchro. */
const MERCHANTS: RuleSeed[] = [
  // Courses
  {
    cat: CAT.courses,
    label: 'Supermarchés',
    pattern:
      '\\b(carrefour|e ?leclerc|leclerc|auchan|lidl|aldi|intermarche|monoprix|franprix|casino|super u|hyper u|u express|picard|grand frais|netto|biocoop|naturalia|la vie claire|cora|match|spar|vival|g20|leader price|bio c bon)\\b',
    regex: true,
  },
  { cat: CAT.courses, label: 'Boulangerie', pattern: 'boulangerie' },
  // Restos & cafés
  {
    cat: CAT.restos,
    label: 'Restauration rapide',
    pattern: '\\b(mc ?donald ?s?|mcdo|burger king|kfc|o ?tacos|quick|subway|five guys|domino s?|pizza hut|starbucks|columbus|paul|brioche doree|pret a manger|big fernand|bagelstein|cojean|sushi shop|planet sushi)\\b',
    regex: true,
  },
  { cat: CAT.restos, label: 'Restaurant', pattern: '\\b(restaurant|resto|brasserie|pizzeria|creperie|cafe|bistrot|kebab|sushi)\\b', regex: true },
  { cat: CAT.restos, label: 'Restauration collective', pattern: '\\b(crous|eurest|sodexo|elior|compass|cantine|self)\\b', regex: true, max: 3000 },
  // Livraison
  { cat: CAT.livraison, label: 'Deliveroo', pattern: 'deliveroo', priority: 5 },
  { cat: CAT.livraison, label: 'Uber Eats', pattern: 'uber ?eats', regex: true, priority: 5 },
  { cat: CAT.livraison, label: 'Just Eat', pattern: 'just ?eat', regex: true, priority: 5 },
  // Sorties & loisirs
  { cat: CAT.sorties, label: 'Cinéma', pattern: '\\b(ugc|pathe|gaumont|cgr|mk2|cinema|kinepolis)\\b', regex: true },
  { cat: CAT.sorties, label: 'Billetterie', pattern: '\\b(fnac spectacles|ticketmaster|see tickets|shotgun|dice|weezevent|billetterie)\\b', regex: true },
  { cat: CAT.sorties, label: 'Bar', pattern: '\\b(bar|pub)\\b', regex: true },
  // Transport
  { cat: CAT.transport, label: 'Train', pattern: '\\b(sncf|sncf connect|ouigo|tgv|ter|trenitalia|eurostar|thalys|db bahn)\\b', regex: true },
  { cat: CAT.transport, label: 'Transports en commun', pattern: '\\b(ratp|navigo|tcl|tisseo|star|tan|tbm|rtm|metropole|keolis|transdev|ile de france mobilites)\\b', regex: true },
  { cat: CAT.transport, label: 'VTC & mobilité', pattern: '\\b(uber|bolt|heetch|free now|lime|dott|tier|voi|blablacar|getaround|marcel)\\b', regex: true },
  { cat: CAT.transport, label: 'Carburant & péage', pattern: '\\b(total ?energies|total access|esso|shell|bp|avia|station|carburant|vinci autoroutes|sanef|aprr|peage)\\b', regex: true },
  // Shopping
  { cat: CAT.shopping, label: 'Amazon', pattern: 'amazon|amzn', regex: true },
  {
    cat: CAT.shopping,
    label: 'Enseignes',
    pattern: '\\b(fnac|darty|boulanger|decathlon|zara|h ?m|uniqlo|kiabi|action|ikea|leroy merlin|castorama|sephora|nocibe|primark|celio|jules|shein|zalando|vinted|leboncoin|cdiscount|aliexpress|temu)\\b',
    regex: true,
  },
  // Santé
  { cat: CAT.sante, label: 'Pharmacie', pattern: 'pharmacie|pharma', regex: true },
  { cat: CAT.sante, label: 'Soins', pattern: '\\b(docteur|dr|medecin|dentiste|kine|ophtalmo|laboratoire|doctolib|hopital|clinique|optic|opticien)\\b', regex: true },
  { cat: CAT.sante, label: 'Assurance maladie', pattern: '\\b(cpam|ameli|assurance maladie|mutuelle|harmonie|mgen|alan|swiss ?life)\\b', regex: true, priority: 8 },
  // Sport
  { cat: CAT.sport, label: 'Salle de sport', pattern: '\\b(basic ?fit|fitness park|keep ?cool|on air|neoness|l orange bleue|cmg sports|club med gym|fitness)\\b', regex: true },
  { cat: CAT.sport, label: 'Équipement sport', pattern: '\\b(intersport|go sport|decathlon pro)\\b', regex: true },
  // Abonnements
  {
    cat: CAT.abonnements,
    label: 'Streaming & logiciels',
    pattern:
      '\\b(netflix|spotify|deezer|disney|canal|prime video|amazon prime|youtube premium|apple com bill|apple music|icloud|google one|google storage|microsoft|office 365|adobe|dropbox|openai|chatgpt|anthropic|claude ai|notion|soundcloud|crunchyroll|paramount|playstation|xbox|nintendo|twitch)\\b',
    regex: true,
    priority: 6,
  },
  {
    cat: CAT.abonnements,
    label: 'Forfait téléphone & box',
    pattern: '\\b(free mobile|free telecom|freebox|sosh|red by sfr|sfr|bouygues telecom|b and you|orange|prixtel|lebara|youprice|la poste mobile|nrj mobile|syma)\\b',
    regex: true,
    priority: 6,
  },
  { cat: CAT.abonnements, label: 'Assurances', pattern: '\\b(assurance|axa|maif|macif|matmut|groupama|allianz|gmf|maaf|mma|cardif|luko|lovys|leocare)\\b', regex: true, priority: 4 },
  // Logement & énergie
  { cat: CAT.logement, label: 'Loyer', pattern: 'loyer', priority: 15 },
  { cat: CAT.logement, label: 'Loyer CROUS', pattern: 'crous', min: 10000, direction: 'debit', priority: 20 },
  { cat: CAT.logement, label: 'Électricité & gaz', pattern: '\\b(edf|engie|total ?energies electricite|ekwateur|ohm energie|mint energie|vattenfall|eni|grdf|enedis|octopus energy)\\b', regex: true, priority: 12 },
  { cat: CAT.logement, label: 'Eau', pattern: '\\b(veolia|suez|eau de paris|saur)\\b', regex: true, priority: 12 },
  // Épargne & investissement
  {
    cat: CAT.epargne,
    label: 'Courtiers & crypto',
    pattern: '\\b(trade republic|bitstack|boursorama bourse|boursobank bourse|degiro|interactive brokers|bourse direct|fortuneo bourse|scalable|binance|coinbase|kraken|bitpanda|paymium|meria|yomoni|nalo|ramify|linxea|goodvest)\\b',
    regex: true,
    priority: 40,
  },
  { cat: CAT.epargne, label: 'Livrets & PEA', pattern: '\\b(livret a|ldds|lep|livret jeune|pea|pee|perco|per|assurance vie|epargne)\\b', regex: true, priority: 40 },
  // Transferts internes génériques
  { cat: CAT.transferts, label: 'Rechargement de compte', pattern: 'top.?up|rechargement|recharge compte', regex: true, priority: 50 },
  { cat: CAT.transferts, label: 'Virement vers néobanque', pattern: '\\b(vir|virement)\\b.*\\b(revolut|n26|lydia sumeria|nickel|wise|qonto)\\b', regex: true, direction: 'debit', priority: 45 },
  // Entre amis
  { cat: CAT.remboursements, label: 'Lydia / Wero / Paylib', pattern: '\\b(lydia|wero|paylib|pumpkin|paypal friends)\\b', regex: true, priority: 30 },
  // Revenus
  { cat: CAT.revenus, label: 'Salaire', pattern: 'salaire|paie|remuneration|traitement', regex: true, direction: 'credit', priority: 10 },
  { cat: CAT.revenus, label: 'Aides (CAF, France Travail)', pattern: '\\b(caf|apl|prime d.?activite|france travail|pole emploi|allocation)\\b', regex: true, direction: 'credit', priority: 10 },
];

function ruleSeeds(holderNames: readonly string[]): RuleSeed[] {
  const out = [...MERCHANTS];
  for (const name of holderNames) {
    const re = nameRegex(name);
    if (!re) continue;
    out.push({
      cat: CAT.transferts,
      label: `Virement entre mes comptes (${name.trim()})`,
      pattern: `(paiement envoye par|payment from|transfer (from|to)|virement (de|a|vers)|vir( sepa)?( inst)?( recu| emis)?( de| a| ben| vers)?)\\W+(m\\.?\\W+|mr\\W+|mme\\W+)?${re}`,
      regex: true,
      priority: 60,
    });
  }
  return out;
}

/**
 * Règles par défaut ajoutées après coup : identifiant stable (les règles d'origine sont numérotées
 * par position), posées une seule fois sur les installations existantes par `ensureSeeded`.
 */
export const ADDED_RULE_SEEDS: (RuleSeed & { id: string })[] = [
  {
    id: 'default-broker-ops',
    cat: CAT.epargne,
    label: 'Ordres de bourse & versements PEA',
    pattern: '\\b(buy trade|sell trade|savings plan execution|saveback|round ?up|versement pea|execution d ?ordre|ordre d ?achat|ordre de vente)\\b',
    regex: true,
    priority: 45,
  },
];

function seedToRule(s: RuleSeed, id: string, now: number): Rule {
  return {
    id,
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
  };
}

export function addedRules(now = Date.now()): Rule[] {
  return ADDED_RULE_SEEDS.map((s) => seedToRule(s, s.id, now));
}

export function buildDefaultRules(holderNames: readonly string[] | string, now = Date.now()): Rule[] {
  const names = typeof holderNames === 'string' ? [holderNames] : holderNames;
  return [...ruleSeeds(names).map((s, i) => seedToRule(s, `default-${String(i).padStart(3, '0')}`, now)), ...addedRules(now)];
}

/** Règle « virement entre mes comptes » d'un titulaire (ajoutée quand on renseigne son nom). */
export function holderRule(name: string, now = Date.now()): Rule | null {
  const [seed] = ruleSeeds([name]).slice(MERCHANTS.length);
  if (!seed) return null;
  return {
    id: `holder-${normalizeText(name).replace(/ /g, '-')}`,
    categoryId: seed.cat,
    pattern: seed.pattern,
    isRegex: true,
    direction: 'any',
    minAmount: null,
    maxAmount: null,
    person: null,
    priority: seed.priority ?? 60,
    label: seed.label,
    enabled: true,
    createdAt: now,
  };
}

export const DEFAULT_ALERTS: AlertSettings = {
  deliveries: { enabled: true, maxCount: 4 },
  amazon: { enabled: true, minAmount: 0 },
  dailyOverrun: { enabled: true, days: 3 },
  transportPass: { enabled: false, passPrice: 0, keyword: '' },
  categoryTarget: { enabled: true, warnPercent: 80 },
};

export const DEFAULT_FIRE: FireSettings = {
  annualReturnBp: 500,
  inflationBp: 200,
  // 3,5 % : plus prudent que la règle des 4 % (pensée pour 30 ans) quand l'indépendance arrive tôt.
  withdrawalBp: 350,
  annualSpendingOverride: null,
  birthYear: null,
  retirementAge: 64,
  pensionMonthly: 0,
  feesBp: 20,
  excludedIds: [],
  essentialCategoryIds: null,
  lastMilestone: 0,
};

export const DEFAULT_SETTINGS: Settings = {
  id: 'main',
  firstName: '',
  holderNames: [],
  onboarded: false,
  payday: 1,
  incomes: [],
  fixedCharges: [],
  savings: { mode: 'auto', manual: 0 },
  plannedSavingsAuto: 0,
  envelopeOverride: null,
  alerts: DEFAULT_ALERTS,
  bridgePassword: '',
  ebOwnApp: null,
  initialSyncDays: 90,
  autoSyncHours: 6,
  bankCountry: 'FR',
  theme: 'nuit',
  followSystem: false,
  haptics: true,
  reduceMotion: false,
  fire: DEFAULT_FIRE,
};

export const sumLines = (lines: readonly BudgetLine[]): number => lines.reduce((s, l) => s + l.amount, 0);

export function totalIncome(s: Pick<Settings, 'incomes'>): number {
  return sumLines(s.incomes);
}

export function totalFixed(s: Pick<Settings, 'fixedCharges'>): number {
  return sumLines(s.fixedCharges);
}

/** Épargne et investissement prévus par mois : plans + objectifs (auto) ou montant saisi. */
export function plannedSavings(s: Pick<Settings, 'savings' | 'plannedSavingsAuto'>): number {
  return s.savings.mode === 'auto' ? s.plannedSavingsAuto : s.savings.manual;
}

export function defaultEnvelope(s: Pick<Settings, 'incomes' | 'fixedCharges' | 'savings' | 'plannedSavingsAuto'>): number {
  return totalIncome(s) - totalFixed(s) - plannedSavings(s);
}

/** Enveloppe « vie courante » du cycle = revenus − charges fixes − épargne prévue (sauf saisie manuelle). */
export function computeEnvelope(s: Settings): number {
  if (s.envelopeOverride !== null) return s.envelopeOverride;
  return defaultEnvelope(s);
}
