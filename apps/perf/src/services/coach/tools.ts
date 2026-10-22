/**
 * The coach's hands on the app. Read tools answer from the local database; write tools never act
 * directly — they describe a change, the user approves it in the chat, then `applyCoachChange` runs it.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { weeklyConsistency } from '@/domain/analytics';
import { bodyTrend } from '@/domain/bodyTrend';
import { addDays, startOfWeek, weekday } from '@/domain/dates';
import { searchKey } from '@/domain/text';
import { describeStrengthWeek, mesocycleForDate, phaseFor } from '@/domain/mesocycle';
import { mesoKindInfo, parseMesoKind, schemeForKind } from '@/domain/mesoTypes';
import { formatPercent, plainWeight } from '@/domain/math';
import { RELIABLE_MAX_REPS } from '@/domain/reference';
import type { Intention, StrengthWeek, WeekOverride } from '@/domain/types';
import { latestBodyweight, listBodyEntries } from '@/db/repos/body';
import { emptyOverride, saveWeekOverride, weekOverrides } from '@/db/repos/cyclePlans';
import { getMesocycle, listMesocycles, saveMesocycle } from '@/db/repos/cycles';
import { getExercise, listExercises } from '@/db/repos/exercises';
import { replacementsOf, workoutSummaries } from '@/db/repos/history';
import { addPlanned, listPlanned } from '@/db/repos/planning';
import { loadSettings } from '@/db/repos/settings';
import {
  addTemplateExercise,
  getTemplate,
  getTemplateExercise,
  getWeekPattern,
  listTemplateExercises,
  listTemplates,
  updateTemplateExercise,
} from '@/db/repos/templates';
import { listSetsForWorkout, listWorkoutExercises } from '@/db/repos/workouts';
import { exerciseStats, weekVolume } from '@/services/statsService';
import { MUSCLE_LABEL } from '@/ui/labels';
import { cyclePlanPreview, referenceFor, templatePreview } from '@/services/workoutService';

type Input = Record<string, unknown>;

export class ToolInputError extends Error {}

// ---------------------------------------------------------------- input helpers

function str(input: Input, key: string, required = true): string | undefined {
  const v = input[key];
  if (v === undefined || v === null || (!required && v === '')) {
    if (required) throw new ToolInputError(`Paramètre « ${key} » manquant`);
    return undefined;
  }
  if (typeof v !== 'string' || v.trim() === '') throw new ToolInputError(`« ${key} » doit être un texte`);
  return v;
}

function num(input: Input, key: string, min: number, max: number, required = false): number | undefined {
  const v = input[key];
  if (v === undefined || v === null) {
    if (required) throw new ToolInputError(`Paramètre « ${key} » manquant`);
    return undefined;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ToolInputError(`« ${key} » doit être un nombre`);
  if (v < min || v > max) throw new ToolInputError(`« ${key} » doit être entre ${min} et ${max}`);
  return v;
}

function int(input: Input, key: string, min: number, max: number, required = false): number | undefined {
  const v = num(input, key, min, max, required);
  if (v !== undefined && !Number.isInteger(v)) throw new ToolInputError(`« ${key} » doit être un entier`);
  return v;
}

function date(input: Input, key: string, required = true): string | undefined {
  const v = str(input, key, required);
  if (v !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ToolInputError(`« ${key} » doit être une date AAAA-MM-JJ`);
  return v;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const pct = (v: number) => Math.round(v * 1000) / 10;

// ---------------------------------------------------------------- definitions

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
});

const READ_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'get_overview',
    description:
      "Vue d'ensemble : date du jour, poids de corps, mésocycle et semaine en cours, semaine type, séances types (ids), lifts principaux avec leur 1RM de référence, régularité, réglages utiles. À appeler en premier.",
    input_schema: obj({}),
  },
  {
    name: 'list_exercises',
    description: 'Bibliothèque d’exercices (id, nom, muscles, matériel, progression, fourchette de reps). Filtre optionnel par texte.',
    input_schema: obj({ query: { type: 'string', description: 'Texte à chercher dans le nom ou les muscles' } }),
  },
  {
    name: 'get_templates',
    description: 'Séances types avec leurs créneaux (template_exercise_id, exercice, séries, reps, progression, intention).',
    input_schema: obj({}),
  },
  {
    name: 'get_mesocycles',
    description:
      'Tous les mésocycles : dates, semaines, structure top set + backoff semaine par semaine (% du 1RM), deload, et réglages par exercice/semaine déjà faits.',
    input_schema: obj({}),
  },
  {
    name: 'get_cycle_plan',
    description: 'Charges proposées semaine par semaine pour un lift principal dans un mésocycle (calculées depuis le 1RM de référence).',
    input_schema: obj({ mesocycle_id: { type: 'string' }, exercise_id: { type: 'string' } }, ['mesocycle_id', 'exercise_id']),
  },
  {
    name: 'get_exercise_history',
    description: 'Historique d’un exercice : séances récentes (séries), records, 1RM de référence (lifts principaux), stagnation, séances où il a été remplacé (replaced_on).',
    input_schema: obj({ exercise_id: { type: 'string' }, sessions: { type: 'integer', description: 'Nombre de séances (défaut 8, max 30)' } }, ['exercise_id']),
  },
  {
    name: 'get_recent_workouts',
    description: 'Séances des N derniers jours avec exercices et séries réalisées ; « replaces » = exercice prévu dans le créneau, remplacé volontairement par celui-ci.',
    input_schema: obj({ days: { type: 'integer', description: 'Défaut 14, max 90' } }),
  },
  {
    name: 'get_week_volume',
    description: 'Séries effectives par muscle pour une semaine (lundi), et objectifs de volume.',
    input_schema: obj({ week_start: { type: 'string', description: 'AAAA-MM-JJ, défaut : semaine en cours' } }),
  },
  {
    name: 'get_planning',
    description: 'Séances planifiées dans le calendrier entre deux dates (faites ou non).',
    input_schema: obj({ from: { type: 'string' }, to: { type: 'string' } }, ['from', 'to']),
  },
  {
    name: 'get_body_weight',
    description: 'Pesées, moyenne 7 jours, rythme kg/semaine et objectif.',
    input_schema: obj({}),
  },
  {
    name: 'get_session_preview',
    description:
      'Ce que l’application prescrira pour une séance à une date (même moteur que le démarrage) : charge du top set des lifts principaux (lest pour les exercices lestés), séries × reps des accessoires, deload compris. Par défaut la séance planifiée ce jour-là.',
    input_schema: obj({ date: { type: 'string', description: 'AAAA-MM-JJ, défaut : aujourd’hui' }, template_id: { type: 'string', description: 'Séance type, défaut : celle planifiée à cette date' } }),
  },
];

const WRITE_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'set_exercise_week',
    description:
      "PROPOSE (l'utilisateur valide) de régler une semaine d'un lift principal dans un mésocycle : nombre de top sets, reps du top set (1-5), % du 1RM du top set, backoffs (nombre, reps 3-6, % du 1RM). Les champs omis gardent leur valeur ; reset=true revient aux valeurs du cycle. week_index = workWeeks+1 pour le deload.",
    input_schema: obj(
      {
        mesocycle_id: { type: 'string' },
        exercise_id: { type: 'string' },
        week_index: { type: 'integer' },
        top_sets: { type: 'integer' },
        top_reps: { type: 'integer' },
        top_percent: { type: 'number', description: 'Fraction du 1RM, ex. 0.85' },
        backoff_sets: { type: 'integer' },
        backoff_reps: { type: 'integer' },
        backoff_percent: { type: 'number', description: 'Fraction du 1RM, ex. 0.75' },
        reset: { type: 'boolean' },
        reason: { type: 'string', description: 'Pourquoi, en une phrase (affiché à l’utilisateur)' },
      },
      ['mesocycle_id', 'exercise_id', 'week_index', 'reason'],
    ),
  },
  {
    name: 'set_cycle_week',
    description:
      "PROPOSE de modifier une semaine de la structure d'un mésocycle (tous les lifts principaux) : top sets, reps, % du 1RM, backoffs. week_index = workWeeks+1 pour la semaine de deload.",
    input_schema: obj(
      {
        mesocycle_id: { type: 'string' },
        week_index: { type: 'integer' },
        top_sets: { type: 'integer' },
        top_reps: { type: 'integer' },
        top_percent: { type: 'number' },
        backoff_sets: { type: 'integer' },
        backoff_reps: { type: 'integer' },
        backoff_percent: { type: 'number' },
        reason: { type: 'string' },
      },
      ['mesocycle_id', 'week_index', 'reason'],
    ),
  },
  {
    name: 'set_mesocycle_type',
    description:
      "PROPOSE de changer le type de bloc d'un mésocycle (accumulation, transmutation, realization, transition, custom). Hors custom, la structure top set + backoff est re-remplie avec celle du type (et le nombre de semaines typique si apply_typical_weeks).",
    input_schema: obj(
      {
        mesocycle_id: { type: 'string' },
        kind: { type: 'string', enum: ['accumulation', 'transmutation', 'realization', 'transition', 'custom'] },
        apply_typical_weeks: { type: 'boolean' },
        reason: { type: 'string' },
      },
      ['mesocycle_id', 'kind', 'reason'],
    ),
  },
  {
    name: 'update_template_slot',
    description:
      'PROPOSE de modifier un créneau d’une séance type : séries (double progression), fourchette de reps, nombre de top sets / backoffs (lifts principaux), intention (power/strength/hypertrophy).',
    input_schema: obj(
      {
        template_exercise_id: { type: 'string' },
        target_sets: { type: 'integer' },
        rep_min: { type: 'integer' },
        rep_max: { type: 'integer' },
        top_sets: { type: 'integer' },
        backoff_sets: { type: 'integer' },
        intention: { type: 'string', enum: ['power', 'strength', 'hypertrophy'] },
        reason: { type: 'string' },
      },
      ['template_exercise_id', 'reason'],
    ),
  },
  {
    name: 'replace_template_exercise',
    description: 'PROPOSE de remplacer l’exercice d’un créneau de séance type par un autre exercice de la bibliothèque.',
    input_schema: obj({ template_exercise_id: { type: 'string' }, exercise_id: { type: 'string' }, reason: { type: 'string' } }, ['template_exercise_id', 'exercise_id', 'reason']),
  },
  {
    name: 'add_template_exercise',
    description: 'PROPOSE d’ajouter un exercice à la fin d’une séance type.',
    input_schema: obj(
      { template_id: { type: 'string' }, exercise_id: { type: 'string' }, target_sets: { type: 'integer' }, reason: { type: 'string' } },
      ['template_id', 'exercise_id', 'reason'],
    ),
  },
  {
    name: 'plan_session',
    description: 'PROPOSE d’ajouter une séance type au calendrier à une date.',
    input_schema: obj({ date: { type: 'string', description: 'AAAA-MM-JJ' }, template_id: { type: 'string' }, reason: { type: 'string' } }, ['date', 'template_id', 'reason']),
  },
];

export const COACH_TOOLS: Anthropic.Beta.BetaTool[] = [...READ_TOOLS, ...WRITE_TOOLS];
export const WRITE_TOOL_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));

/** Short French label of what a tool call does, for the chat. */
export function toolActivityLabel(name: string, input: Input): string {
  const ex = typeof input.exercise_id === 'string' ? getExercise(input.exercise_id)?.name : undefined;
  switch (name) {
    case 'get_overview':
      return 'Lecture du programme';
    case 'list_exercises':
      return 'Bibliothèque d’exercices';
    case 'get_templates':
      return 'Séances types';
    case 'get_mesocycles':
      return 'Mésocycles';
    case 'get_cycle_plan':
      return `Plan du cycle${ex === undefined ? '' : ` · ${ex}`}`;
    case 'get_exercise_history':
      return `Historique${ex === undefined ? '' : ` · ${ex}`}`;
    case 'get_recent_workouts':
      return 'Séances récentes';
    case 'get_week_volume':
      return 'Volume de la semaine';
    case 'get_planning':
      return 'Calendrier';
    case 'get_body_weight':
      return 'Poids de corps';
    case 'get_session_preview':
      return 'Séance prévue';
    default:
      return name;
  }
}

// ---------------------------------------------------------------- read tools

function overview(today: string) {
  const settings = loadSettings();
  const mesos = listMesocycles();
  const meso = mesocycleForDate(mesos, today);
  const phase = meso === null ? null : phaseFor(meso, today);
  const templates = listTemplates();
  const names = new Map(templates.map((t) => [t.id, t.name]));
  const bw = latestBodyweight(today);
  const exercises = listExercises();
  const mainIds = new Set<string>();
  for (const t of templates) {
    for (const te of listTemplateExercises(t.id)) {
      const ex = exercises.find((e) => e.id === te.exerciseId);
      if (ex !== undefined && (te.progressionType ?? ex.progressionType) === 'top_set_backoff') mainIds.add(ex.id);
    }
  }
  const dates = workoutSummaries(addDays(today, -365), today)
    .filter((w) => w.status === 'completed' && w.setCount > 0)
    .map((w) => w.date);
  const consistency = weeklyConsistency(dates, today, settings.weeklyGoal);
  return {
    today,
    weekday: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'][weekday(today)],
    bodyweight_kg: bw,
    current_mesocycle:
      meso === null
        ? null
        : {
            id: meso.id,
            name: meso.name,
            type: mesoKindInfo(meso.kind).label,
            start: meso.startDate,
            work_weeks: meso.workWeeks,
            deload_weeks: meso.deloadWeeks,
            phase: phase === null ? null : phase.kind === 'before' ? `commence dans ${phase.daysUntilStart} j` : phase.kind === 'work' ? `semaine ${phase.week}` : phase.kind === 'deload' ? 'deload' : 'terminé',
          },
    week_pattern: getWeekPattern().map((p) => ({ weekday: p.weekday, template: names.get(p.templateId) ?? p.templateId })),
    templates: templates.map((t) => ({ id: t.id, name: t.name })),
    main_lifts: [...mainIds].map((id) => {
      const ex = exercises.find((e) => e.id === id);
      const ref = referenceFor(id, today);
      const lest = ex?.loadType === 'bodyweight';
      return {
        exercise_id: id,
        name: ex?.name,
        weighted_lest: lest,
        reference_1rm_total_kg: ref === null ? null : r1(ref.value),
        reference_1rm_lest_kg: ref === null || !lest ? null : r1(ref.value - (bw ?? 0)),
        reference_status: ref?.status ?? null,
        reference_source: ref === null ? null : ref.basis.kind === 'manual' ? 'saisi par l’athlète' : 'estimé (historique)',
        reference_basis: ref === null ? null : `${ref.basis.kind} ${ref.basis.date} ${plainWeight(r1(ref.basis.load - ref.basis.bodyweight))}×${ref.basis.reps}`,
      };
    }),
    consistency: { weekly_goal: settings.weeklyGoal, streak_weeks: consistency.streak, sessions_last_12_weeks: consistency.weeks.map((w) => w.sessions) },
    settings: { increment_kg: settings.increment, volume_targets: settings.volumeTargets, bodyweight_goal_kg: settings.bodyweightGoal },
  };
}

function exercisesList(query: string | undefined) {
  const q = query === undefined ? undefined : searchKey(query);
  return listExercises()
    .filter(
      (e) =>
        q === undefined ||
        searchKey(e.name).includes(q) ||
        // Muscles match by id ("chest") and by French label ("pectoraux").
        [...e.primaryMuscles, ...e.secondaryMuscles].some((m) => m.includes(q) || searchKey(MUSCLE_LABEL[m]).includes(q)),
    )
    .map((e) => ({
      id: e.id,
      name: e.name,
      muscles: e.primaryMuscles,
      secondary: e.secondaryMuscles,
      equipment: e.equipment,
      progression: e.progressionType,
      load: e.loadType === 'bodyweight' ? 'lest' : 'externe',
      reps: `${e.repRangeMin}-${e.repRangeMax}`,
    }));
}

function templatesList() {
  const exercises = new Map(listExercises(true).map((e) => [e.id, e]));
  return listTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    slots: listTemplateExercises(t.id).map((te) => {
      const ex = exercises.get(te.exerciseId);
      return {
        template_exercise_id: te.id,
        exercise_id: te.exerciseId,
        exercise: ex?.name,
        progression: te.progressionType ?? ex?.progressionType,
        intention: te.intention,
        target_sets: te.targetSets,
        reps: `${te.repMin ?? ex?.repRangeMin}-${te.repMax ?? ex?.repRangeMax}`,
        top_sets: te.topSets,
        backoff_sets: te.backoffSets,
      };
    }),
  }));
}

const weekJson = (w: StrengthWeek) => ({
  label: describeStrengthWeek(w),
  top_sets: w.topSets,
  top_reps: w.topRepsMin,
  top_percent: pct(w.topPercent),
  backoff_sets: w.backoffSets,
  backoff_reps: w.backoffReps,
  backoff_percent: pct(w.backoffPercent),
});

function mesocyclesList() {
  const exercises = new Map(listExercises(true).map((e) => [e.id, e.name]));
  return listMesocycles().map((m) => {
    const tweaked = [...exercises.keys()].flatMap((exId) => {
      const o = weekOverrides(m.id, exId);
      return o.size === 0 ? [] : [{ exercise_id: exId, exercise: exercises.get(exId), weeks: [...o.values()] }];
    });
    return {
      id: m.id,
      name: m.name,
      type: m.kind,
      type_label: mesoKindInfo(m.kind).label,
      start: m.startDate,
      work_weeks: m.workWeeks,
      deload_weeks: m.deloadWeeks,
      weeks: m.scheme.map((w, i) => ({ week_index: i + 1, ...weekJson(w) })),
      deload: { week_index: m.workWeeks + 1, main_lifts: weekJson(m.deload.main), accessories_load_factor: m.deload.loadFactor, accessories_volume_factor: m.deload.volumeFactor },
      per_exercise_tweaks: tweaked,
    };
  });
}

function cyclePlan(mesocycleId: string, exerciseId: string) {
  if (getMesocycle(mesocycleId) === null) throw new ToolInputError('Mésocycle inconnu');
  if (getExercise(exerciseId) === null) throw new ToolInputError('Exercice inconnu');
  return cyclePlanPreview(mesocycleId, exerciseId).map((p) => ({
    week_index: p.weekIndex,
    date: p.date,
    deload: p.isDeload,
    plan: p.prescription.label,
    sets: p.prescription.sets.map((s) => `${s.setType} ${s.targetWeight === null ? '?' : plainWeight(s.targetWeight)}×${s.targetReps}`),
    reference_1rm_total_kg: p.reference === null ? null : r1(p.reference.value),
  }));
}

function exerciseHistory(exerciseId: string, sessions: number, today: string) {
  const ex = getExercise(exerciseId);
  if (ex === null) throw new ToolInputError('Exercice inconnu');
  const st = exerciseStats(exerciseId, today);
  const ref = st.reference;
  return {
    exercise: { id: ex.id, name: ex.name, progression: ex.progressionType, lest: ex.loadType === 'bodyweight', reps: `${ex.repRangeMin}-${ex.repRangeMax}` },
    reference_1rm: ref === null ? null : { total_kg: r1(ref.value), status: ref.status, basis: ref.basis, calibrations: ref.calibrations },
    best_e1rm: st.prs.bestE1rm === null ? null : { ...st.prs.bestE1rm, e1rm: r1(st.prs.bestE1rm.e1rm) },
    heaviest: st.prs.heaviest,
    stagnation: st.stagnation,
    reliable_reps_max: st.reliableMaxReps ?? RELIABLE_MAX_REPS,
    sessions: st.sessions.slice(0, sessions).map((s) => ({ date: s.date, best_e1rm: r1(s.bestE1rm), sets: s.sets.map((x) => `${x.setType} ${plainWeight(x.weight)}×${x.reps}${x.note === '' ? '' : ` — note : ${x.note}`}`) })),
    // Planned but swapped for another exercise (the athlete's choice): not missed sessions.
    replaced_on: replacementsOf(exerciseId).map((r) => ({ date: r.date, by: getExercise(r.byExerciseId)?.name ?? r.byExerciseId })),
  };
}

function recentWorkouts(days: number, today: string) {
  const exercises = new Map(listExercises(true).map((e) => [e.id, e.name]));
  return workoutSummaries(addDays(today, -days + 1), today).map((w) => {
    const sets = listSetsForWorkout(w.id);
    return {
      id: w.id,
      date: w.date,
      name: w.name,
      status: w.status,
      deload: w.isDeload,
      week_index: w.weekIndex,
      exercises: listWorkoutExercises(w.id).map((we) => ({
        exercise: exercises.get(we.exerciseId),
        ...(we.replacesExerciseId === null ? {} : { replaces: exercises.get(we.replacesExerciseId) ?? we.replacesExerciseId }),
        sets: sets
          .filter((s) => s.workoutExerciseId === we.id && s.completed)
          .map((s) => `${s.setType} ${s.weight === null ? '?' : plainWeight(s.weight)}×${s.reps ?? '?'}${s.barSpeed === null ? '' : ` (${s.barSpeed})`}${s.note === '' ? '' : ` — note : ${s.note}`}`),
      })),
    };
  });
}

function bodyWeight(today: string) {
  const entries = listBodyEntries('bodyweight');
  const goal = loadSettings().bodyweightGoal;
  const trend = bodyTrend(entries, goal);
  return {
    entries: entries.slice(-30).map((e) => ({ date: e.date, kg: e.value })),
    trend: trend === null ? null : { average_7d: r1(trend.average), kg_per_week: trend.ratePerWeek === null ? null : Math.round(trend.ratePerWeek * 100) / 100, goal_kg: goal, goal_date: trend.goalDate },
    today,
  };
}

/** Runs a read tool. Throws ToolInputError on bad input (sent back to the model as an error). */
export function runReadTool(name: string, input: Input, today: string): unknown {
  switch (name) {
    case 'get_overview':
      return overview(today);
    case 'list_exercises':
      return exercisesList(str(input, 'query', false));
    case 'get_templates':
      return templatesList();
    case 'get_mesocycles':
      return mesocyclesList();
    case 'get_cycle_plan':
      return cyclePlan(str(input, 'mesocycle_id') ?? '', str(input, 'exercise_id') ?? '');
    case 'get_exercise_history':
      return exerciseHistory(str(input, 'exercise_id') ?? '', int(input, 'sessions', 1, 30) ?? 8, today);
    case 'get_recent_workouts':
      return recentWorkouts(int(input, 'days', 1, 90) ?? 14, today);
    case 'get_week_volume': {
      const start = startOfWeek(date(input, 'week_start', false) ?? today);
      return { week_start: start, volume: weekVolume(start), targets: loadSettings().volumeTargets };
    }
    case 'get_planning': {
      const from = date(input, 'from') ?? today;
      const to = date(input, 'to') ?? today;
      const names = new Map(listTemplates().map((t) => [t.id, t.name]));
      return listPlanned(from, to).map((p) => ({ date: p.date, template: p.templateId === null ? p.title : (names.get(p.templateId) ?? p.title), done: p.workoutId !== null }));
    }
    case 'get_body_weight':
      return bodyWeight(today);
    case 'get_session_preview': {
      const day = date(input, 'date', false) ?? today;
      const templateId = str(input, 'template_id', false) ?? listPlanned(day, day).find((p) => p.templateId !== null)?.templateId ?? null;
      if (templateId === null) return { date: day, session: null, note: 'Aucune séance type planifiée ce jour-là : précise template_id.' };
      const template = getTemplate(templateId);
      if (template === null) throw new ToolInputError(`Séance type inconnue : ${templateId}`);
      return {
        date: day,
        session: template.name,
        exercises: templatePreview(templateId, day).map((l) => ({
          exercise_id: l.exerciseId,
          name: l.name,
          main_lift: l.main,
          prescription: l.label,
          top_set: l.top === null ? null : `${l.lest ? 'lest ' : ''}${plainWeight(l.top.weight)} kg × ${l.top.reps}`,
        })),
      };
    }
    default:
      throw new ToolInputError(`Outil inconnu : ${name}`);
  }
}

// ---------------------------------------------------------------- write tools (proposals)

export interface CoachChange {
  /** One line the user reads before approving. */
  title: string;
  details: string[];
  reason: string;
  apply: () => string;
}

function strengthPatch(input: Input) {
  return {
    topSets: int(input, 'top_sets', 0, 5),
    topReps: int(input, 'top_reps', 1, 5),
    topPercent: num(input, 'top_percent', 0.3, 1),
    backoffSets: int(input, 'backoff_sets', 0, 8),
    backoffReps: int(input, 'backoff_reps', 3, 6),
    backoffPercent: num(input, 'backoff_percent', 0.3, 1),
  };
}

function patchLines(p: ReturnType<typeof strengthPatch>) {
  const out: string[] = [];
  if (p.topSets !== undefined) out.push(`Top sets : ${p.topSets}`);
  if (p.topReps !== undefined) out.push(`Reps top set : ${p.topReps}`);
  if (p.topPercent !== undefined) out.push(`Top set : ${formatPercent(p.topPercent)} du 1RM`);
  if (p.backoffSets !== undefined) out.push(`Backoffs : ${p.backoffSets}`);
  if (p.backoffReps !== undefined) out.push(`Reps backoff : ${p.backoffReps}`);
  if (p.backoffPercent !== undefined) out.push(`Backoffs : ${formatPercent(p.backoffPercent)} du 1RM`);
  return out;
}

/**
 * Validates a write tool call and describes the change. Nothing is written until `apply()` runs
 * (after the user approved). Throws ToolInputError on bad input.
 */
export function prepareCoachChange(name: string, input: Input): CoachChange {
  const reason = str(input, 'reason', false) ?? '';
  switch (name) {
    case 'set_exercise_week': {
      const meso = getMesocycle(str(input, 'mesocycle_id') ?? '');
      if (meso === null) throw new ToolInputError('Mésocycle inconnu');
      const ex = getExercise(str(input, 'exercise_id') ?? '');
      if (ex === null) throw new ToolInputError('Exercice inconnu');
      const week = int(input, 'week_index', 1, meso.workWeeks + meso.deloadWeeks, true) ?? 1;
      const reset = input.reset === true;
      const patch = strengthPatch(input);
      const lines = reset ? ['Retour aux valeurs du cycle'] : patchLines(patch);
      if (lines.length === 0) throw new ToolInputError('Aucun changement demandé');
      const label = week > meso.workWeeks ? 'deload' : `semaine ${week}`;
      return {
        title: `${ex.name} · ${meso.name}, ${label}`,
        details: lines,
        reason,
        apply: () => {
          const current = weekOverrides(meso.id, ex.id).get(week) ?? emptyOverride(week);
          const next: WeekOverride = reset
            ? emptyOverride(week)
            : {
                ...current,
                topSets: patch.topSets ?? current.topSets,
                topRepsMin: patch.topReps ?? current.topRepsMin,
                topRepsMax: patch.topReps ?? current.topRepsMax,
                topPercent: patch.topPercent ?? current.topPercent,
                backoffSets: patch.backoffSets ?? current.backoffSets,
                backoffReps: patch.backoffReps ?? current.backoffReps,
                backoffPercent: patch.backoffPercent ?? current.backoffPercent,
              };
          saveWeekOverride(meso.id, ex.id, next);
          return `Appliqué : ${ex.name}, ${meso.name} ${label}`;
        },
      };
    }
    case 'set_cycle_week': {
      const meso = getMesocycle(str(input, 'mesocycle_id') ?? '');
      if (meso === null) throw new ToolInputError('Mésocycle inconnu');
      const week = int(input, 'week_index', 1, meso.workWeeks + Math.max(1, meso.deloadWeeks), true) ?? 1;
      const p = strengthPatch(input);
      const lines = patchLines(p);
      if (lines.length === 0) throw new ToolInputError('Aucun changement demandé');
      const deload = week > meso.workWeeks;
      return {
        title: `${meso.name} · ${deload ? 'deload' : `semaine ${week}`} (tous les lifts principaux)`,
        details: lines,
        reason,
        apply: () => {
          const fresh = getMesocycle(meso.id);
          if (fresh === null) return 'Mésocycle supprimé entre-temps';
          const base = deload ? fresh.deload.main : fresh.scheme[week - 1];
          if (base === undefined) return 'Semaine introuvable';
          const next: StrengthWeek = {
            ...base,
            topSets: p.topSets ?? base.topSets,
            topRepsMin: p.topReps ?? base.topRepsMin,
            topRepsMax: p.topReps ?? base.topRepsMax,
            topPercent: p.topPercent ?? base.topPercent,
            backoffSets: p.backoffSets ?? base.backoffSets,
            backoffReps: p.backoffReps ?? base.backoffReps,
            backoffPercent: p.backoffPercent ?? base.backoffPercent,
          };
          if (deload) saveMesocycle({ ...fresh, deload: { ...fresh.deload, main: next } });
          else saveMesocycle({ ...fresh, scheme: fresh.scheme.map((w, i) => (i === week - 1 ? next : w)) });
          return `Appliqué : ${fresh.name} ${deload ? 'deload' : `semaine ${week}`}`;
        },
      };
    }
    case 'set_mesocycle_type': {
      const meso = getMesocycle(str(input, 'mesocycle_id') ?? '');
      if (meso === null) throw new ToolInputError('Mésocycle inconnu');
      const kindRaw = str(input, 'kind') ?? '';
      const kind = parseMesoKind(kindRaw);
      if (kind !== kindRaw) throw new ToolInputError('Type inconnu');
      const info = mesoKindInfo(kind);
      const typical = input.apply_typical_weeks === true;
      const weeks = typical ? info.weeks : meso.workWeeks;
      const scheme = schemeForKind(kind, weeks);
      return {
        title: `${meso.name} → bloc ${info.label}`,
        details: [
          `Volume ${info.volume}, intensité ${info.intensity}`,
          ...(scheme === null ? ['Structure actuelle conservée'] : [`Structure ${info.label} sur ${weeks} semaines`]),
          ...(typical ? [`${info.weeks} semaines + ${info.deloadWeeks} deload`] : []),
        ],
        reason,
        apply: () => {
          const fresh = getMesocycle(meso.id);
          if (fresh === null) return 'Mésocycle supprimé entre-temps';
          saveMesocycle({
            ...fresh,
            kind,
            workWeeks: weeks,
            deloadWeeks: typical ? info.deloadWeeks : fresh.deloadWeeks,
            scheme: scheme ?? fresh.scheme,
          });
          return `Appliqué : ${fresh.name} en bloc ${info.label}`;
        },
      };
    }
    case 'update_template_slot': {
      const te = getTemplateExercise(str(input, 'template_exercise_id') ?? '');
      if (te === null) throw new ToolInputError('Créneau inconnu');
      const ex = getExercise(te.exerciseId);
      const tpl = getTemplate(te.templateId);
      const targetSets = int(input, 'target_sets', 1, 10);
      const repMin = int(input, 'rep_min', 1, 50);
      const repMax = int(input, 'rep_max', 1, 50);
      const topSets = int(input, 'top_sets', 1, 5);
      const backoffSets = int(input, 'backoff_sets', 0, 8);
      const intentionRaw = str(input, 'intention', false);
      if (intentionRaw !== undefined && !['power', 'strength', 'hypertrophy'].includes(intentionRaw)) throw new ToolInputError('Intention invalide');
      const intention = intentionRaw as Intention | undefined;
      const min = repMin ?? te.repMin ?? ex?.repRangeMin ?? 1;
      const max = repMax ?? te.repMax ?? ex?.repRangeMax ?? 50;
      if (min > max) throw new ToolInputError('rep_min doit être ≤ rep_max');
      const lines: string[] = [];
      if (targetSets !== undefined) lines.push(`Séries : ${targetSets}`);
      if (repMin !== undefined || repMax !== undefined) lines.push(`Reps : ${min}-${max}`);
      if (topSets !== undefined) lines.push(`Top sets : ${topSets}`);
      if (backoffSets !== undefined) lines.push(`Backoffs : ${backoffSets}`);
      if (intention !== undefined) lines.push(`Intention : ${intention}`);
      if (lines.length === 0) throw new ToolInputError('Aucun changement demandé');
      return {
        title: `${tpl?.name ?? 'Séance type'} · ${ex?.name ?? 'exercice'}`,
        details: lines,
        reason,
        apply: () => {
          const cur = getTemplateExercise(te.id);
          if (cur === null) return 'Créneau supprimé entre-temps';
          updateTemplateExercise({
            ...cur,
            targetSets: targetSets ?? cur.targetSets,
            repMin: repMin ?? cur.repMin,
            repMax: repMax ?? cur.repMax,
            topSets: topSets ?? cur.topSets,
            backoffSets: backoffSets ?? cur.backoffSets,
            intention: intention ?? cur.intention,
          });
          return `Appliqué : ${tpl?.name ?? ''} · ${ex?.name ?? ''}`;
        },
      };
    }
    case 'replace_template_exercise': {
      const te = getTemplateExercise(str(input, 'template_exercise_id') ?? '');
      if (te === null) throw new ToolInputError('Créneau inconnu');
      const next = getExercise(str(input, 'exercise_id') ?? '');
      if (next === null) throw new ToolInputError('Exercice inconnu');
      const prev = getExercise(te.exerciseId);
      const tpl = getTemplate(te.templateId);
      return {
        title: `${tpl?.name ?? 'Séance type'} : ${prev?.name ?? '?'} → ${next.name}`,
        details: [`Les séances déjà faites gardent ${prev?.name ?? 'l’ancien exercice'}`],
        reason,
        apply: () => {
          const cur = getTemplateExercise(te.id);
          if (cur === null) return 'Créneau supprimé entre-temps';
          // Exercise-specific settings come from the new exercise (as the in-session swap does).
          updateTemplateExercise({ ...cur, exerciseId: next.id, repMin: null, repMax: null, progressionType: null, backoffPercent: null });
          return `Appliqué : ${next.name} dans ${tpl?.name ?? 'la séance type'}`;
        },
      };
    }
    case 'add_template_exercise': {
      const tpl = getTemplate(str(input, 'template_id') ?? '');
      if (tpl === null) throw new ToolInputError('Séance type inconnue');
      const ex = getExercise(str(input, 'exercise_id') ?? '');
      if (ex === null) throw new ToolInputError('Exercice inconnu');
      const sets = int(input, 'target_sets', 1, 10);
      return {
        title: `${tpl.name} : ajouter ${ex.name}`,
        details: sets === undefined ? [] : [`${sets} séries`],
        reason,
        apply: () => {
          const id = addTemplateExercise(tpl.id, ex);
          const te = getTemplateExercise(id);
          if (te !== null && sets !== undefined) updateTemplateExercise({ ...te, targetSets: sets });
          return `Appliqué : ${ex.name} ajouté à ${tpl.name}`;
        },
      };
    }
    case 'plan_session': {
      const day = date(input, 'date') ?? '';
      const tpl = getTemplate(str(input, 'template_id') ?? '');
      if (tpl === null) throw new ToolInputError('Séance type inconnue');
      return {
        title: `Planifier ${tpl.name} le ${day}`,
        details: [],
        reason,
        apply: () => {
          addPlanned(day, tpl.id, tpl.name);
          return `Appliqué : ${tpl.name} planifiée le ${day}`;
        },
      };
    }
    default:
      throw new ToolInputError(`Outil inconnu : ${name}`);
  }
}
