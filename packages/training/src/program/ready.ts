import { PROGRAM_FORMAT, type ProgramFile } from './format';

/**
 * Programmes prêts à l'emploi, pour ceux qui n'ont rien à importer. Des structures classiques et
 * génériques, écrites dans le format d'échange (le même chemin que l'import). Noms d'exercices = ceux
 * de la bibliothèque de base.
 */
export interface ReadyProgram {
  id: string;
  title: string;
  level: string;
  summary: string;
  file: ProgramFile;
}

const p = (name: string, notes: string, sessions: ProgramFile['sessions']): ProgramFile => ({ format: PROGRAM_FORMAT, version: 1, name, notes, sessions });

export const READY_PROGRAMS: readonly ReadyProgram[] = [
  {
    id: 'fullbody',
    title: 'Full body débutant',
    level: 'Débutant · 3 jours',
    summary: 'Tout le corps à chaque séance, deux séances qui alternent. Le meilleur départ.',
    file: p('Full body débutant', 'Alterne A et B. Ajoute un peu de charge dès que toutes les séries sont réussies en haut de la fourchette.', [
      {
        name: 'Full body A',
        days: ['lundi', 'vendredi'],
        exercises: [
          { name: 'Squat', sets: 3, reps: '5-8', restSeconds: 150 },
          { name: 'Développé couché', sets: 3, reps: '5-8', restSeconds: 150 },
          { name: 'Rowing barre', sets: 3, reps: '8-10', restSeconds: 120 },
          { name: 'Élévations latérales', sets: 2, reps: '12-15', restSeconds: 60 },
          { name: 'Curl haltères', sets: 2, reps: '10-12', restSeconds: 60 },
        ],
      },
      {
        name: 'Full body B',
        days: ['mercredi'],
        exercises: [
          { name: 'Soulevé de terre', sets: 2, reps: '5', restSeconds: 180 },
          { name: 'Développé militaire', sets: 3, reps: '6-8', restSeconds: 150 },
          { name: 'Tirage vertical', sets: 3, reps: '8-12', restSeconds: 120 },
          { name: 'Fentes bulgares', sets: 2, reps: '8-10', restSeconds: 90 },
          { name: 'Extension triceps poulie', sets: 2, reps: '10-12', restSeconds: 60 },
        ],
      },
    ]),
  },
  {
    id: 'upperlower',
    title: 'Haut / Bas',
    level: 'Intermédiaire · 4 jours',
    summary: 'Haut du corps et jambes en alternance, chaque muscle deux fois par semaine.',
    file: p('Haut / Bas', 'Deux séances lourdes (lundi, mardi), deux plus volumineuses (jeudi, vendredi).', [
      {
        name: 'Haut lourd',
        days: ['lundi'],
        exercises: [
          { name: 'Développé couché', sets: 4, reps: '4-6', restSeconds: 180 },
          { name: 'Rowing barre', sets: 4, reps: '6-8', restSeconds: 150 },
          { name: 'Développé militaire', sets: 3, reps: '6-8', restSeconds: 150 },
          { name: 'Tractions', sets: 3, reps: 'max', restSeconds: 120 },
          { name: 'Curl barre', sets: 2, reps: '8-10', restSeconds: 90 },
        ],
      },
      {
        name: 'Bas lourd',
        days: ['mardi'],
        exercises: [
          { name: 'Squat', sets: 4, reps: '4-6', restSeconds: 180 },
          { name: 'Soulevé de terre roumain', sets: 3, reps: '6-8', restSeconds: 150 },
          { name: 'Presse à cuisses', sets: 3, reps: '8-10', restSeconds: 120 },
          { name: 'Mollets debout', sets: 3, reps: '8-12', restSeconds: 90 },
        ],
      },
      {
        name: 'Haut volume',
        days: ['jeudi'],
        exercises: [
          { name: 'Développé incliné haltères', sets: 3, reps: '8-12', restSeconds: 120 },
          { name: 'Tirage horizontal', sets: 3, reps: '10-12', restSeconds: 90 },
          { name: 'Élévations latérales', sets: 3, reps: '12-15', restSeconds: 60 },
          { name: 'Face pull', sets: 3, reps: '15', restSeconds: 60 },
          { name: 'Barre au front', sets: 3, reps: '10-12', restSeconds: 60 },
        ],
      },
      {
        name: 'Bas volume',
        days: ['vendredi'],
        exercises: [
          { name: 'Front squat', sets: 3, reps: '6-8', restSeconds: 150 },
          { name: 'Hip thrust', sets: 3, reps: '8-12', restSeconds: 120 },
          { name: 'Leg curl', sets: 3, reps: '10-12', restSeconds: 90 },
          { name: 'Leg extension', sets: 3, reps: '12-15', restSeconds: 60 },
        ],
      },
    ]),
  },
  {
    id: 'ppl',
    title: 'Push Pull Legs',
    level: 'Intermédiaire · 3 ou 6 jours',
    summary: 'Poussée, tirage, jambes. Une fois par semaine sur 3 jours, ou deux fois sur 6.',
    file: p('Push Pull Legs', 'Sur 3 jours : lundi, mercredi, vendredi. Pour 6 jours, ajoute jeudi, vendredi, samedi dans ta semaine type.', [
      {
        name: 'Push',
        days: ['lundi'],
        exercises: [
          { name: 'Développé couché', sets: 4, reps: '6-8', restSeconds: 150 },
          { name: 'Développé épaules haltères', sets: 3, reps: '8-10', restSeconds: 120 },
          { name: 'Développé incliné haltères', sets: 3, reps: '8-12', restSeconds: 120 },
          { name: 'Élévations latérales', sets: 3, reps: '12-15', restSeconds: 60 },
          { name: 'Extension triceps poulie', sets: 3, reps: '10-12', restSeconds: 60 },
        ],
      },
      {
        name: 'Pull',
        days: ['mercredi'],
        exercises: [
          { name: 'Tractions', sets: 4, reps: '6-10', restSeconds: 150 },
          { name: 'Rowing barre', sets: 3, reps: '8-10', restSeconds: 120 },
          { name: 'Tirage horizontal', sets: 3, reps: '10-12', restSeconds: 90 },
          { name: 'Face pull', sets: 3, reps: '15', restSeconds: 60 },
          { name: 'Curl marteau', sets: 3, reps: '10-12', restSeconds: 60 },
        ],
      },
      {
        name: 'Legs',
        days: ['vendredi'],
        exercises: [
          { name: 'Squat', sets: 4, reps: '6-8', restSeconds: 180 },
          { name: 'Soulevé de terre roumain', sets: 3, reps: '8-10', restSeconds: 150 },
          { name: 'Presse à cuisses', sets: 3, reps: '10-12', restSeconds: 120 },
          { name: 'Leg curl', sets: 3, reps: '10-12', restSeconds: 90 },
          { name: 'Mollets debout', sets: 3, reps: '10-15', restSeconds: 60 },
        ],
      },
    ]),
  },
  {
    id: 'force5x5',
    title: 'Force 5×5',
    level: 'Débutant et plus · 3 jours',
    summary: 'Les grands mouvements, cinq séries de cinq. Simple, efficace pour la force.',
    file: p('Force 5×5', 'Alterne A et B. Quand les 5×5 passent, ajoute 2,5 kg (5 kg au soulevé de terre).', [
      {
        name: 'Force A',
        days: ['lundi', 'vendredi'],
        exercises: [
          { name: 'Squat', sets: 5, reps: '5', restSeconds: 180 },
          { name: 'Développé couché', sets: 5, reps: '5', restSeconds: 180 },
          { name: 'Rowing barre', sets: 5, reps: '5', restSeconds: 150 },
        ],
      },
      {
        name: 'Force B',
        days: ['mercredi'],
        exercises: [
          { name: 'Squat', sets: 5, reps: '5', restSeconds: 180 },
          { name: 'Développé militaire', sets: 5, reps: '5', restSeconds: 180 },
          { name: 'Soulevé de terre', sets: 1, reps: '5', restSeconds: 180 },
        ],
      },
    ]),
  },
  {
    id: 'streetlifting',
    title: 'Street lifting',
    level: 'Intermédiaire · 3 jours',
    summary: 'Tractions et dips lestés, muscle-up et squat : les mouvements de compétition.',
    file: p('Street lifting', 'Charges en lest (poids du corps + lest pour les calculs). Les top sets se règlent avec ton 1RM.', [
      {
        name: 'Tirage',
        days: ['lundi'],
        exercises: [
          { name: 'Traction lestée', sets: 4, reps: '3-5', restSeconds: 180, bodyweight: true },
          { name: 'Muscle-up lesté', sets: 3, reps: '2-3', restSeconds: 180, bodyweight: true },
          { name: 'Rowing barre', sets: 3, reps: '8-10', restSeconds: 120 },
          { name: 'Curl marteau', sets: 3, reps: '10-12', restSeconds: 60 },
        ],
      },
      {
        name: 'Poussée',
        days: ['mercredi'],
        exercises: [
          { name: 'Dips lestés', sets: 4, reps: '3-5', restSeconds: 180, bodyweight: true },
          { name: 'Développé militaire', sets: 3, reps: '6-8', restSeconds: 150 },
          { name: 'Pompes', sets: 3, reps: 'max', restSeconds: 90 },
          { name: 'Extension triceps poulie', sets: 3, reps: '10-12', restSeconds: 60 },
        ],
      },
      {
        name: 'Jambes et volume',
        days: ['vendredi'],
        exercises: [
          { name: 'Squat', sets: 4, reps: '3-5', restSeconds: 180 },
          { name: 'Tractions', sets: 3, reps: '6-10', restSeconds: 120 },
          { name: 'Dips', sets: 3, reps: '8-12', restSeconds: 90 },
          { name: 'Relevés de jambes suspendu', sets: 3, reps: '10-15', restSeconds: 60 },
        ],
      },
    ]),
  },
];
