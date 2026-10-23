import type { Equipment, ExerciseCategory, LoadType, Muscle } from '../types';
import { normalizeText } from './format';

/**
 * Rapprocher un nom d'exercice écrit n'importe comment (« DC », « bench press », « dévelopé couché »)
 * de la bibliothèque. D'abord les synonymes connus (français, anglais, abréviations), puis les noms de
 * la bibliothèque (y compris les exercices créés par l'utilisateur), puis une tolérance aux fautes.
 * Sinon : nouvel exercice, dont le matériel et les muscles sont devinés d'après le nom.
 */

/** Synonymes des exercices de base (identifiants stables de db/seed.ts). */
export const SYNONYMS: Record<string, readonly string[]> = {
  ex_weighted_pullup: ['traction lestee', 'tractions lestees', 'weighted pull up', 'weighted pullup', 'pull up leste', 'traction pronation lestee'],
  ex_weighted_dip: ['dips lestes', 'dip leste', 'weighted dip', 'weighted dips'],
  ex_weighted_muscleup: ['muscle up leste', 'weighted muscle up', 'muscle-up leste'],
  ex_squat: ['squat', 'back squat', 'squat barre', 'squat arriere', 'squats'],
  ex_bench: ['developpe couche', 'dc', 'bench', 'bench press', 'developpe couche barre', 'developpe couche a la barre'],
  ex_deadlift: ['souleve de terre', 'sdt', 'deadlift', 'dl', 'souleve de terre conventionnel'],
  ex_ohp: ['developpe militaire', 'militaire', 'overhead press', 'ohp', 'military press', 'developpe militaire barre'],
  ex_weighted_chinup: ['traction supination lestee', 'chin up leste', 'weighted chin up'],
  ex_pullup: ['tractions', 'traction', 'pull up', 'pull ups', 'pullups', 'traction pronation'],
  ex_dip: ['dips', 'dip', 'dips aux barres'],
  ex_pushup: ['pompes', 'pompe', 'push up', 'push ups', 'pushups'],
  ex_front_squat: ['front squat', 'squat avant'],
  ex_rdl: ['souleve de terre roumain', 'rdl', 'romanian deadlift', 'sdt roumain', 'souleve de terre jambes tendues'],
  ex_barbell_row: ['rowing barre', 'barbell row', 'rowing', 'bent over row', 'rowing buste penche'],
  ex_db_row: ['rowing haltere', 'dumbbell row', 'rowing un bras', 'one arm row'],
  ex_incline_db_press: ['developpe incline halteres', 'incline dumbbell press', 'developpe incline haltere', 'di halteres'],
  ex_incline_bench: ['developpe incline barre', 'incline bench', 'incline bench press', 'developpe incline', 'di barre'],
  ex_db_press: ['developpe halteres', 'dumbbell press', 'developpe couche halteres', 'dumbbell bench press'],
  ex_db_ohp: ['developpe epaules halteres', 'developpe assis halteres', 'dumbbell shoulder press', 'shoulder press'],
  ex_lat_pulldown: ['tirage vertical', 'lat pulldown', 'tirage poitrine', 'pulldown', 'tirage nuque'],
  ex_cable_row: ['tirage horizontal', 'seated cable row', 'cable row', 'tirage assis'],
  ex_leg_press: ['presse a cuisses', 'presse', 'leg press', 'presse jambes'],
  ex_hack_squat: ['hack squat'],
  ex_bulgarian: ['fentes bulgares', 'bulgarian split squat', 'split squat bulgare', 'fente bulgare'],
  ex_hip_thrust: ['hip thrust', 'hip thrusts', 'pont fessier'],
  ex_inverted_row: ['rowing inverse', 'inverted row', 'australian pull up', 'tractions australiennes'],
  ex_barbell_curl: ['curl barre', 'barbell curl', 'curl biceps barre'],
  ex_db_curl: ['curl halteres', 'dumbbell curl', 'curl biceps', 'curl', 'curl haltere'],
  ex_hammer_curl: ['curl marteau', 'hammer curl'],
  ex_preacher_curl: ['curl pupitre', 'preacher curl', 'curl larry scott'],
  ex_triceps_pushdown: ['extension triceps poulie', 'triceps pushdown', 'pushdown', 'triceps poulie', 'extensions triceps poulie haute'],
  ex_skullcrusher: ['barre au front', 'skull crusher', 'skullcrusher', 'skull crushers'],
  ex_overhead_ext: ['extension triceps nuque', 'overhead triceps extension', 'extension nuque'],
  ex_lateral_raise: ['elevations laterales', 'elevation laterale', 'lateral raise', 'lateral raises', 'elevations laterales halteres'],
  ex_cable_lateral: ['elevation laterale poulie', 'cable lateral raise'],
  ex_face_pull: ['face pull', 'face pulls'],
  ex_reverse_fly: ['oiseau', 'reverse fly', 'rear delt fly', 'oiseau halteres'],
  ex_cable_fly: ['ecarte poulie', 'cable fly', 'cable crossover', 'ecartes poulie', 'pec fly'],
  ex_leg_extension: ['leg extension', 'leg extensions', 'extension jambes', 'extension quadriceps'],
  ex_leg_curl: ['leg curl', 'leg curls', 'curl ischios', 'curl jambes'],
  ex_standing_calf: ['mollets debout', 'standing calf raise', 'calf raise', 'mollets', 'extension mollets'],
  ex_seated_calf: ['mollets assis', 'seated calf raise'],
  ex_shrug: ['shrugs', 'shrug', 'haussement d epaules'],
  ex_cable_crunch: ['crunch poulie', 'cable crunch'],
  ex_hanging_leg_raise: ['releves de jambes suspendu', 'hanging leg raise', 'releve de jambes', 'releves de jambes'],
  ex_wrist_curl: ['curl poignets', 'wrist curl'],
  ex_adductor: ['adducteurs machine', 'adducteurs', 'adductor machine'],
};

export interface LibraryEntry {
  id: string;
  name: string;
}

export type MatchKind = 'exact' | 'synonym' | 'close' | 'new';

export interface Match {
  kind: MatchKind;
  exerciseId: string | null;
}

/** Forme comparable : sans accents, sans ponctuation, sans pluriel final simple. */
export function canonical(name: string): string {
  return normalizeText(name)
    .replace(/[%.,-]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length]!;
}

export function matchExercise(name: string, library: readonly LibraryEntry[]): Match {
  const want = canonical(name);
  if (!want) return { kind: 'new', exerciseId: null };
  const known = new Set(library.map((e) => e.id));
  for (const e of library) if (canonical(e.name) === want) return { kind: 'exact', exerciseId: e.id };
  for (const [id, words] of Object.entries(SYNONYMS)) if (known.has(id) && words.some((w) => canonical(w) === want)) return { kind: 'synonym', exerciseId: id };
  // Fautes de frappe : une à deux lettres d'écart selon la longueur.
  let best: { id: string; d: number } | null = null;
  const candidates: [string, string][] = [...library.map((e) => [e.id, canonical(e.name)] as [string, string]), ...Object.entries(SYNONYMS).filter(([id]) => known.has(id)).flatMap(([id, ws]) => ws.map((w) => [id, canonical(w)] as [string, string]))];
  for (const [id, c] of candidates) {
    if (c.length < 5) continue;
    const d = distance(want, c);
    const allowed = c.length >= 12 ? 2 : 1;
    if (d <= allowed && (!best || d < best.d)) best = { id, d };
  }
  return best ? { kind: 'close', exerciseId: best.id } : { kind: 'new', exerciseId: null };
}

// ---------------------------------------------------------------- deviner un nouvel exercice

const EQUIPMENT_WORDS: [RegExp, Equipment][] = [
  [/haltere|dumbbell|\bdb\b/, 'dumbbell'],
  [/poulie|cable|vis a vis/, 'cable'],
  [/machine|presse|smith|guidee|hack/, 'machine'],
  [/kettlebell|\bkb\b/, 'kettlebell'],
  [/elastique|band/, 'band'],
  [/barre|barbell|\bez\b/, 'barbell'],
  [/traction|dip|pompe|muscle up|gainage|planche|pull up|push up|chin up|front lever|l sit|abdo|crunch|burpee|pistol/, 'bodyweight'],
];

const MUSCLE_WORDS: [RegExp, Muscle[]][] = [
  [/couche|pec|chest|bench|pompe|push up|ecarte|fly|dip/, ['chest']],
  [/traction|pull up|chin up|tirage|pulldown|lat/, ['lats', 'back']],
  [/rowing|row\b|tirage horizontal/, ['back']],
  [/militaire|epaule|shoulder|overhead|elevation|lateral|arnold/, ['shoulders']],
  [/oiseau|rear|face pull/, ['rear_delts']],
  [/curl(?! ischio| jambe|.*leg)|biceps/, ['biceps']],
  [/triceps|extension nuque|barre au front|skull|pushdown|kick back/, ['triceps']],
  [/squat|presse|fente|lunge|leg extension|quadri|pistol/, ['quads', 'glutes']],
  [/souleve|deadlift|rdl|ischio|leg curl|good morning/, ['hamstrings', 'glutes']],
  [/hip thrust|fessier|glute/, ['glutes']],
  [/mollet|calf/, ['calves']],
  [/abdo|crunch|gainage|planche|plank|releve de jambe|leg raise|core|l sit/, ['abs']],
  [/shrug|trapeze/, ['traps']],
  [/lombaire|extension dos/, ['lower_back']],
  [/poignet|wrist|avant bras|forearm/, ['forearms']],
  [/adducteur/, ['adductors']],
];

export interface GuessedExercise {
  equipment: Equipment;
  primaryMuscles: Muscle[];
  category: ExerciseCategory;
  loadType: LoadType;
  unilateral: boolean;
}

export function guessExercise(name: string, hint: { equipment?: Equipment | null; muscles?: readonly Muscle[]; bodyweight?: boolean | null } = {}): GuessedExercise {
  // Le nom tel quel (pluriels compris : « un bras », « dips »), sans accents ni ponctuation.
  const n = normalizeText(name).replace(/[%.,-]/g, ' ');
  const equipment = hint.equipment ?? EQUIPMENT_WORDS.find(([re]) => re.test(n))?.[1] ?? 'other';
  const muscles = hint.muscles?.length ? [...hint.muscles] : [...new Set(MUSCLE_WORDS.filter(([re]) => re.test(n)).flatMap(([, m]) => m))].slice(0, 3);
  const isolation = /curl|extension|elevation|ecarte|fly|oiseau|mollet|calf|crunch|shrug|kick back|face pull|poignet/.test(n);
  return {
    equipment,
    primaryMuscles: muscles,
    category: isolation ? 'isolation' : 'compound',
    loadType: hint.bodyweight ?? equipment === 'bodyweight' ? 'bodyweight' : 'external',
    unilateral: /unilateral|un bras|une jambe|one arm|single|alterne|bulgare|pistol/.test(n),
  };
}
