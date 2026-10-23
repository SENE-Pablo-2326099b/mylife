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
          "bodyweight": false
        }
      ]
    }
  ],
  "oneRepMaxes": [{ "exercise": "Squat", "kg": 140 }]
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

Voici mon programme :
`;
}
