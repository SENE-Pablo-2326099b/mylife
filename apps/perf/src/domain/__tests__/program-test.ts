import { parseExerciseLine, parseProgramInput, readProgram, repsOf, secondsOf } from '../program/format';
import { canonical, guessExercise, matchExercise } from '../program/match';
import { buildPlan, newExercises, programToFile, slotNotes, summarizePlan } from '../program/plan';
import { programPrompt } from '../program/prompt';
import { READY_PROGRAMS } from '../program/ready';
import { SEEDS } from '../seedLibrary';

const LIBRARY = SEEDS.map((s) => ({ id: s.id, name: s.name }));

describe('lecture des valeurs', () => {
  it('répétitions : nombre, fourchette, max, durée', () => {
    expect(repsOf('8')).toMatchObject({ repMin: 8, repMax: 8, amrap: false });
    expect(repsOf('6-8')).toMatchObject({ repMin: 6, repMax: 8 });
    expect(repsOf('8 à 12')).toMatchObject({ repMin: 8, repMax: 12 });
    expect(repsOf('AMRAP')).toMatchObject({ amrap: true, repMin: null });
    expect(repsOf('30s')).toMatchObject({ seconds: 30, repMin: null });
    expect(repsOf(10)).toMatchObject({ repMin: 10, repMax: 10 });
  });
  it('repos : secondes, minutes, 2’30', () => {
    expect(secondsOf(90)).toBe(90);
    expect(secondsOf('90s')).toBe(90);
    expect(secondsOf('2 min')).toBe(120);
    expect(secondsOf("2'30")).toBe(150);
    expect(secondsOf('1 min 30')).toBe(90);
    expect(secondsOf('1,5 min')).toBe(90);
  });
});

describe('JSON produit par un LLM', () => {
  it('bloc ```json entouré de texte, virgules en trop, guillemets typographiques', () => {
    const answer = 'Voici ton programme :\n```json\n{ “name”: “PPL”, "sessions": [ { "name": "Push", "days": ["Lundi"], "exercises": [ { "name": "DC", "sets": 4, "reps": "6-8", "percent1RM": 75, }, ], }, ], }\n```\nBon entraînement !';
    const r = parseProgramInput(answer);
    expect(r.source).toBe('json');
    expect(r.program?.name).toBe('PPL');
    expect(r.program?.sessions[0]).toMatchObject({ name: 'Push', weekdays: [0] });
    expect(r.program?.sessions[0]?.exercises[0]).toMatchObject({ name: 'DC', sets: 4, repMin: 6, repMax: 8, percent: 75 });
  });

  it('clés en français, « 4x8 » dans une seule clé, pourcentage en fraction, repos en texte', () => {
    const r = readProgram({ nom: 'Mon prog', séances: [{ nom: 'Jambes', jours: 'mardi, vendredi', exercices: [{ exercice: 'Squat', séries: '4x8', intensité: 0.7, repos: '2 min' }] }] });
    const s = r.program!.sessions[0]!;
    expect(s.weekdays).toEqual([1, 4]);
    expect(s.exercises[0]).toMatchObject({ name: 'Squat', sets: 4, repMin: 8, percent: 70, restSeconds: 120 });
  });

  it('ce qui manque est signalé, jamais inventé ; version future refusée', () => {
    const r = readProgram({ sessions: [{ name: 'A', exercises: [{ name: 'Curl' }, { sets: 3 }] }] });
    expect(r.program?.sessions[0]?.exercises).toHaveLength(1);
    expect(r.program?.sessions[0]?.exercises[0]).toMatchObject({ sets: 3, kg: null, percent: null, rpe: null });
    expect(r.issues.join(' ')).toMatch(/séries absent/);
    expect(r.issues.join(' ')).toMatch(/sans nom/);
    expect(readProgram({ version: 9, sessions: [] }).program).toBeNull();
  });

  it('matériel et muscles donnés par le LLM, filtrés sur les valeurs connues', () => {
    const r = readProgram({ sessions: [{ name: 'A', exercises: [{ name: 'Pec deck', sets: 3, equipment: 'machine', muscles: ['chest', 'wings'] }] }] });
    expect(r.program?.sessions[0]?.exercises[0]).toMatchObject({ equipment: 'machine', muscles: ['chest'] });
  });
});

describe('texte libre, sans LLM', () => {
  it('lignes d’exercices : séries × reps, %, kg, RPE, repos, consigne', () => {
    expect(parseExerciseLine('- Squat 4x8 @75% repos 2min')).toMatchObject({ name: 'Squat', sets: 4, repMin: 8, percent: 75, restSeconds: 120 });
    expect(parseExerciseLine('Développé couché : 3×10 80kg RPE 8 tempo lent')).toMatchObject({ name: 'Développé couché', sets: 3, repMin: 10, kg: 80, rpe: 8, notes: 'tempo lent' });
    expect(parseExerciseLine('Tractions 3 séries de max')).toMatchObject({ name: 'Tractions', sets: 3, amrap: true });
    expect(parseExerciseLine('Gainage 3x30s')).toMatchObject({ name: 'Gainage', sets: 3, seconds: 30 });
    expect(parseExerciseLine('Jour 1 – Push')).toBeNull();
  });

  it('titres de séance, jours, nom du programme, lignes incomprises signalées', () => {
    const r = parseProgramInput('Mon PPL\n\n## Lundi – Push\nDC 4x6-8\nÉlévations latérales 3x15\n\nMercredi : Pull\nTractions 4x max\nRowing barre 3x10\nun peu de cardio après la séance pour finir en douceur et bien récupérer');
    expect(r.source).toBe('text');
    expect(r.program?.name).toBe('Mon PPL');
    expect(r.program?.sessions.map((s) => [s.name, s.weekdays])).toEqual([
      ['Lundi – Push', [0]],
      ['Mercredi : Pull', [2]],
    ]);
    expect(r.issues).toHaveLength(1);
  });

  it('rien de reconnu : un exemple est proposé', () => {
    expect(parseProgramInput('bonjour').program).toBeNull();
    expect(parseProgramInput('bonjour').issues[0]).toMatch(/Squat 4x8/);
  });
});

describe('rapprochement avec la bibliothèque', () => {
  it('nom exact, synonymes (français, anglais, abréviations), fautes de frappe', () => {
    expect(matchExercise('Squat', LIBRARY)).toEqual({ kind: 'exact', exerciseId: 'ex_squat' });
    expect(matchExercise('DC', LIBRARY)).toEqual({ kind: 'synonym', exerciseId: 'ex_bench' });
    expect(matchExercise('Bench press', LIBRARY).exerciseId).toBe('ex_bench');
    expect(matchExercise('pull-ups', LIBRARY).exerciseId).toBe('ex_pullup');
    expect(matchExercise('Dévelopé couché', LIBRARY)).toEqual({ kind: 'close', exerciseId: 'ex_bench' });
    expect(matchExercise('Elevations laterales', LIBRARY).exerciseId).toBe('ex_lateral_raise');
  });
  it('inconnu : nouvel exercice, matériel et muscles devinés', () => {
    expect(matchExercise('Pec deck', LIBRARY)).toEqual({ kind: 'new', exerciseId: null });
    expect(guessExercise('Curl incliné haltères')).toMatchObject({ equipment: 'dumbbell', primaryMuscles: ['biceps'], category: 'isolation' });
    expect(guessExercise('Front lever')).toMatchObject({ equipment: 'bodyweight', loadType: 'bodyweight' });
    expect(guessExercise('Tirage poulie un bras')).toMatchObject({ equipment: 'cable', unilateral: true });
  });
  it('les exercices de l’utilisateur comptent aussi', () => {
    expect(matchExercise('Mon exo maison', [...LIBRARY, { id: 'x1', name: 'Mon exo maison' }])).toEqual({ kind: 'exact', exerciseId: 'x1' });
  });
  it('forme comparable : accents, ponctuation, pluriels', () => {
    expect(canonical('Élévations  Latérales !')).toBe(canonical('elevation laterale'));
  });
});

describe('plan d’import', () => {
  it('séances renommées si le nom est pris, consignes rangées dans les notes, résumé', () => {
    const program = parseProgramInput('Push\nDC 4x6-8 @75% repos 2min\nPec deck 3x12\nPull\nTractions 3x max').program!;
    const plan = buildPlan(program, LIBRARY, ['push']);
    expect(plan.sessions.map((s) => s.name)).toEqual(['Push (2)', 'Pull']);
    expect(plan.sessions[0]?.exercises[0]).toMatchObject({ exerciseId: 'ex_bench', intention: 'hypertrophy', notes: '75 % du 1RM · repos 2 min' });
    expect(newExercises(plan).map((e) => e.name)).toEqual(['Pec deck']);
    expect(summarizePlan(plan)).toMatchObject({ sessions: 2, exercises: 3, recognized: 2, created: 1 });
  });
  it('consignes d’un exercice lesté et chronométré', () => {
    expect(slotNotes({ name: 'x', sets: 3, repMin: null, repMax: null, amrap: false, seconds: 45, kg: 20, percent: null, rpe: null, restSeconds: 90, notes: '', equipment: null, muscles: [], bodyweight: true })).toBe('45 s · +20 kg · repos 1 min 30');
  });
});

describe('programmes prêts et export', () => {
  it('chaque programme prêt se lit sans remarque et n’utilise que des exercices de la bibliothèque', () => {
    for (const ready of READY_PROGRAMS) {
      const r = readProgram(ready.file);
      expect(r.issues).toEqual([]);
      const plan = buildPlan(r.program!, LIBRARY, []);
      expect({ id: ready.id, unknown: newExercises(plan).map((e) => e.name) }).toEqual({ id: ready.id, unknown: [] });
      expect(plan.sessions.every((s) => s.weekdays.length > 0)).toBe(true);
    }
  });
  it('export puis réimport : mêmes séances, mêmes jours, mêmes séries', () => {
    const file = programToFile({
      name: 'Mon programme',
      sessions: [{ name: 'Push', notes: '', exercises: [{ name: 'Développé couché', sets: 4, repMin: 6, repMax: 8, notes: 'repos 2 min', equipment: 'barbell', muscles: ['chest'], bodyweight: false }] }],
      pattern: [{ weekday: 0, session: 'Push' }, { weekday: 3, session: 'Push' }],
      oneRms: [{ name: 'Développé couché', kg: 100 }],
    });
    const back = readProgram(JSON.parse(JSON.stringify(file)));
    expect(back.issues).toEqual([]);
    expect(back.program?.sessions[0]).toMatchObject({ name: 'Push', weekdays: [0, 3] });
    expect(back.program?.sessions[0]?.exercises[0]).toMatchObject({ name: 'Développé couché', sets: 4, repMin: 6, repMax: 8, restSeconds: null, notes: 'repos 2 min' });
    expect(back.program?.oneRms).toEqual([{ name: 'Développé couché', kg: 100 }]);
  });
  it('le prompt donne le format, les valeurs permises et interdit d’inventer', () => {
    const prompt = programPrompt();
    expect(prompt).toContain('"format": "myperf-program"');
    expect(prompt).toContain('barbell');
    expect(prompt).toContain('hamstrings');
    expect(prompt).toMatch(/n'invente jamais/);
  });
});
