import { EQUIPMENTS, MUSCLES } from '../types';
import { PROGRAM_FORMAT, PROGRAM_VERSION } from './format';

/**
 * Les instructions à donner à n'importe quel LLM gratuit (ChatGPT, Gemini, Le Chat, Claude…) pour qu'il
 * transforme un programme (texte, PDF, capture, photo) en JSON MyPerf. Elles disent quoi faire quand
 * une information manque : l'omettre, jamais l'inventer.
 */
export function programPrompt(): string {
  return `Tu vas convertir mon programme de musculation en JSON pour l'app MyPerf. Je te le donne juste après ce message (texte, PDF, capture ou photo).

Réponds UNIQUEMENT avec le JSON, dans un seul bloc \`\`\`json, sans rien avant ni après.

Format exact :
{
  "format": "${PROGRAM_FORMAT}",
  "version": ${PROGRAM_VERSION},
  "name": "nom du programme",
  "notes": "consignes générales (facultatif)",
  "sessions": [
    {
      "name": "nom de la séance (ex. Push, Jambes, Séance A)",
      "days": ["lundi", "jeudi"],
      "notes": "facultatif",
      "exercises": [
        {
          "name": "Développé couché",
          "sets": 4,
          "reps": "6-8",
          "percent1RM": 75,
          "kg": 80,
          "rpe": 8,
          "restSeconds": 120,
          "notes": "tempo, consignes… (facultatif)",
          "equipment": "barbell",
          "muscles": ["chest", "triceps"],
          "bodyweight": false,
          "format": "sets",
          "superset": "A",
          "progression": "double"
        }
      ]
    }
  ],
  "oneRepMaxes": [{ "exercise": "Squat", "kg": 140 }],
  "macrocycles": [
    {
      "name": "Saison 2026",
      "blocks": [
        {
          "name": "Cycle 1",
          "type": "accumulation",
          "start": "2026-12-07",
          "weeks": [
            ["top 1x4 @80%", "backoff 4x6 @70%"],
            ["top 1x4 @83%", "backoff 4x6 @73%", "2x3 @75% pause 2 s"],
            ["top 1x3 @86%", "backoff EMOM 6x2 @72%"]
          ],
          "deload": { "weeks": 1, "sets": ["top 1x3 @65%", "backoff 2x5 @55%"], "accessories": { "load": 0.6, "volume": 0.5 } },
          "lifts": { "Squat": [{ "week": 3, "sets": ["top 1x2 @90%", "backoff 3x4 @78%"] }] }
        }
      ]
    }
  ]
}

Règles :
- Une entrée par exercice, dans l'ordre de la séance. Une séance par jour d'entraînement différent.
- "sets" : un nombre entier. "reps" : une chaîne : "8", "6-8", "max" (jusqu'à l'échec) ou une durée comme "30s".
- "percent1RM", "kg", "rpe", "restSeconds" : des nombres, seulement s'ils sont écrits dans le programme. Repos en secondes (2 min = 120).
- "days" : jours en français minuscules (lundi … dimanche), seulement s'ils sont indiqués.
- "equipment" parmi : ${EQUIPMENTS.join(', ')}.
- "muscles" parmi : ${MUSCLES.join(', ')}.
- "bodyweight": true pour un exercice au poids du corps qu'on peut lester (tractions, dips) ; la charge "kg" est alors le lest.
- Garde les noms d'exercices en français, tels qu'ils sont écrits (corrige seulement les fautes évidentes).
- Si une information manque ou est illisible, omets la clé : n'invente jamais une valeur.
- "oneRepMaxes" : seulement si mes maximums (1RM) sont écrits.
- "format" : "sets" (séries, par défaut), "emom" (une série chaque minute : "minutes" = durée totale, "reps" = reps par minute, "everySeconds" si ce n'est pas 60), "amrap" (max de tours en "minutes"), "for_time" (le plus vite possible). Un exercice tenu (gainage) : "reps": "45s".
- "superset" : la même lettre ("A", "B"…) sur des exercices qui se suivent et s'enchaînent sans repos ; "sets" = nombre de tours.
- "progression" : "percent" si les charges sont en % du 1RM ou suivent des blocs, "double" pour une fourchette de reps (8-12), "linear" si on ajoute une charge fixe à chaque séance, "free" sinon. Omets-la si ce n'est pas clair.
- Périodisation, seulement si elle est écrite : "macrocycles" (une saison, une préparation) contiennent leurs "blocks" (mésocycles), dans l'ordre ; des blocs sans macrocycle vont dans "blocks" à la racine. Un bloc : "name", "type" parmi accumulation, transmutation, realization, transition, custom, "start" (AAAA-MM-JJ) si écrit, sinon il suit le précédent.
- "weeks" d'un bloc : la liste de ses semaines de travail (microcycles), dans l'ordre, chacune une liste de groupes de séries pour les mouvements au % du 1RM, dans l'ordre exact du programme. Un groupe s'écrit « [type] [EMOM] séries x reps @pourcentage% [consigne] [repos durée] » : type parmi top, backoff, échauffement, drop (rien = séries droites) ; « 3x45s » pour des séries au temps ; « 1x3-5 » pour une fourchette ; « EMOM » (ou « E2MOM ») pour une série chaque minute ; la consigne en clair (« pause 2 s », « tempo 3-1-1 ») ; « repos 3 min » si écrit. N'importe quelle combinaison : top set + backoffs, séries pausées à un autre %, vagues, EMOM, séries droites. Si seules les durées sont écrites, "weeks" peut être un nombre.
- "deload" : la ou les semaines de décharge ("weeks" : 0 à 2), leurs groupes dans "sets", et "accessories" (charge et volume des accessoires, en fraction : 0.6 = 60 %) si c'est écrit.
- "lifts" : les exceptions d'un exercice (son nom → [{ "week": numéro de semaine du bloc, la décharge comprise, "sets": ses groupes }]), seulement si le programme en donne.

Voici mon programme :
`;
}
