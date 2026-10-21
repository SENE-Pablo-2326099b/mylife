import type Anthropic from '@anthropic-ai/sdk';

import { createTestDb } from '@/db/__tests__/testDb';
import { weekOverrides } from '@/db/repos/cyclePlans';
import { getMesocycle } from '@/db/repos/cycles';
import { listPlanned } from '@/db/repos/planning';
import { getTemplateExercise, listTemplateExercises } from '@/db/repos/templates';
import { db } from '@/db/db';
import { MIGRATIONS } from '@/db/migrations';
import { getExercise } from '@/db/repos/exercises';
import { listWorkoutExercises, updateSet } from '@/db/repos/workouts';
import { importPersonalData } from '@/import/importer';
import { finishWorkout, loadWorkoutDoc, replaceExercise, startWorkout } from '@/services/workoutService';

import { advance, repairHistory, requestParams, resolveApproval, userMessage, visibleText, type CreateMessage, type Msg } from '../agent';
import { COACH_TOOLS, prepareCoachChange, runReadTool, ToolInputError } from '../tools';

const TODAY = '2026-10-07';

/** A scripted Claude: returns the queued responses in order and records every request. */
function fakeClaude(responses: Partial<Anthropic.Beta.BetaMessage>[]) {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const create: CreateMessage = async (params) => {
    requests.push(JSON.parse(JSON.stringify(params)));
    const next = responses.shift();
    if (next === undefined) throw new Error('no more scripted responses');
    return { id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [], ...next } as Anthropic.Beta.BetaMessage;
  };
  return { create, requests };
}

const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use' as const, id, name, input });
const text = (t: string) => ({ type: 'text' as const, text: t, citations: null });

describe('coach tools', () => {
  beforeEach(() => {
    createTestDb();
    importPersonalData();
  });

  it('every tool has a valid schema and a French description', () => {
    for (const t of COACH_TOOLS) {
      expect(t.input_schema.type).toBe('object');
      expect(t.description?.length ?? 0).toBeGreaterThan(20);
    }
    expect(new Set(COACH_TOOLS.map((t) => t.name)).size).toBe(COACH_TOOLS.length);
  });

  it('reads the whole program: overview, templates, cycles, plan, history, volume, body', () => {
    const o = runReadTool('get_overview', {}, TODAY) as { current_mesocycle: { name: string; phase: string }; main_lifts: { name: string; reference_status: string }[]; templates: unknown[] };
    expect(o.current_mesocycle).toMatchObject({ name: 'Bloc 1 — Remise en route', phase: 'deload' });
    expect(o.templates).toHaveLength(5);
    expect(o.main_lifts.map((l) => l.name).sort()).toEqual(['Back squat', 'Dips lesté', 'Pull-up lesté pronation']);
    expect(o.main_lifts.find((l) => l.name === 'Back squat')?.reference_status).toBe('provisional');

    expect(JSON.stringify(runReadTool('get_templates', {}, TODAY))).toContain('template_exercise_id');
    expect(JSON.stringify(runReadTool('get_mesocycles', {}, TODAY))).toContain('1×5 @80 %');
    const plan = runReadTool('get_cycle_plan', { mesocycle_id: 'meso_cycle1', exercise_id: 'ex_squat' }, TODAY) as { sets: string[] }[];
    expect(plan[0]?.sets[0]).toBe('top_set 80×5');
    const hist = runReadTool('get_exercise_history', { exercise_id: 'ex_weighted_dip', sessions: 2 }, TODAY) as { sessions: unknown[] };
    expect(hist.sessions).toHaveLength(2);
    expect(JSON.stringify(runReadTool('get_recent_workouts', { days: 7 }, TODAY))).toContain('Dimanche');
    expect(runReadTool('get_week_volume', { week_start: '2026-09-28' }, TODAY)).toMatchObject({ week_start: '2026-09-28' });
    expect(runReadTool('get_body_weight', {}, TODAY)).toMatchObject({ entries: [{ date: '2026-09-07', kg: 63 }] });
    expect((runReadTool('list_exercises', { query: 'dips' }, TODAY) as unknown[]).length).toBeGreaterThanOrEqual(2);
    const preview = runReadTool('get_session_preview', { date: '2026-10-15', template_id: 'tpl_jeudi' }, TODAY) as { exercises: { name: string; top_set: string | null }[] };
    expect(preview.exercises.find((e) => e.name === 'Back squat')?.top_set).toMatch(/kg × 5$/);
    // Accent-insensitive, and muscles match by their French label too.
    expect((runReadTool('list_exercises', { query: 'developpe' }, TODAY) as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect((runReadTool('list_exercises', { query: 'pectoraux' }, TODAY) as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('rejects bad input with a readable error', () => {
    expect(() => runReadTool('get_exercise_history', { exercise_id: 'nope' }, TODAY)).toThrow(ToolInputError);
    expect(() => runReadTool('get_recent_workouts', { days: 500 }, TODAY)).toThrow('entre 1 et 90');
    expect(() => prepareCoachChange('set_exercise_week', { mesocycle_id: 'meso_cycle1', exercise_id: 'ex_squat', week_index: 1, top_reps: 6, reason: '' })).toThrow('entre 1 et 5');
    expect(() => prepareCoachChange('set_exercise_week', { mesocycle_id: 'meso_cycle1', exercise_id: 'ex_squat', week_index: 1, reason: '' })).toThrow('Aucun changement');
  });

  it('write tools change nothing until applied', () => {
    const change = prepareCoachChange('set_exercise_week', { mesocycle_id: 'meso_cycle1', exercise_id: 'ex_squat', week_index: 2, top_percent: 0.82, reason: 'Montée plus douce' });
    expect(change.title).toContain('Back squat');
    expect(change.details).toEqual(['Top set : 82 % du 1RM']);
    expect(weekOverrides('meso_cycle1', 'ex_squat').has(2)).toBe(false);
    change.apply();
    expect(weekOverrides('meso_cycle1', 'ex_squat').get(2)?.topPercent).toBe(0.82);
  });

  it('applies cycle, template and calendar changes', () => {
    prepareCoachChange('set_cycle_week', { mesocycle_id: 'meso_cycle1', week_index: 5, top_reps: 2, reason: '' }).apply();
    expect(getMesocycle('meso_cycle1')?.deload.main.topRepsMin).toBe(2);
    prepareCoachChange('set_cycle_week', { mesocycle_id: 'meso_cycle1', week_index: 1, backoff_sets: 3, reason: '' }).apply();
    expect(getMesocycle('meso_cycle1')?.scheme[0]?.backoffSets).toBe(3);

    const slot = listTemplateExercises('tpl_mardi')[1];
    if (slot === undefined) throw new Error('slot');
    prepareCoachChange('update_template_slot', { template_exercise_id: slot.id, target_sets: 4, rep_min: 6, rep_max: 8, reason: '' }).apply();
    expect(getTemplateExercise(slot.id)).toMatchObject({ targetSets: 4, repMin: 6, repMax: 8 });
    prepareCoachChange('replace_template_exercise', { template_exercise_id: slot.id, exercise_id: 'ex_incline_db_press', reason: '' }).apply();
    expect(getTemplateExercise(slot.id)?.exerciseId).toBe('ex_incline_db_press');
    const before = listTemplateExercises('tpl_mardi').length;
    prepareCoachChange('add_template_exercise', { template_id: 'tpl_mardi', exercise_id: 'ex_face_pull', target_sets: 3, reason: '' }).apply();
    expect(listTemplateExercises('tpl_mardi')).toHaveLength(before + 1);
    prepareCoachChange('plan_session', { date: '2026-10-09', template_id: 'tpl_jeudi', reason: '' }).apply();
    prepareCoachChange('set_mesocycle_type', { mesocycle_id: 'meso_cycle2', kind: 'transmutation', reason: '' }).apply();
    expect(getMesocycle('meso_cycle2')).toMatchObject({ kind: 'transmutation', workWeeks: 4 });
    expect(getMesocycle('meso_cycle2')?.scheme[0]).toMatchObject({ topRepsMin: 3, topPercent: 0.85 });
    prepareCoachChange('set_mesocycle_type', { mesocycle_id: 'meso_cycle3', kind: 'realization', apply_typical_weeks: true, reason: '' }).apply();
    expect(getMesocycle('meso_cycle3')).toMatchObject({ kind: 'realization', workWeeks: 3 });
    expect(() => prepareCoachChange('set_mesocycle_type', { mesocycle_id: 'meso_cycle3', kind: 'peaking', reason: '' })).toThrow('Type inconnu');
    expect(listPlanned('2026-10-09', '2026-10-09').map((p) => p.templateId)).toContain('tpl_jeudi');
  });
});

describe('coach agent loop', () => {
  beforeEach(() => {
    createTestDb();
    importPersonalData();
  });

  it('sends Sonnet by default (Opus on deep), the fallback flag, and marks the system, tools and last message as cached', () => {
    const p = requestParams([userMessage('Salut', TODAY)]);
    expect(p).toMatchObject({ model: 'claude-sonnet-5-5', fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'], output_config: { effort: 'medium' } });
    expect(requestParams([userMessage('Salut', TODAY)], 'deep').model).toBe('claude-opus-5-5');

    // Cache markers: system (always), last tool (caches the whole tool list), and last message
    // (caches the whole history). Any other content stays uncached.
    expect(JSON.stringify(p.system)).toContain('ephemeral');
    expect(p.tools).toHaveLength(COACH_TOOLS.length);
    expect(p.tools?.at(-1)).toMatchObject({ cache_control: { type: 'ephemeral' } });
    expect(p.tools?.at(0)).not.toHaveProperty('cache_control');
    const lastMsg = p.messages[p.messages.length - 1];
    const lastBlock = Array.isArray(lastMsg?.content) ? lastMsg?.content[lastMsg.content.length - 1] : null;
    expect(lastBlock).toMatchObject({ cache_control: { type: 'ephemeral' } });

    expect(JSON.stringify(p.messages)).toContain(`Date du jour : ${TODAY}`);
  });

  it('runs read tools, returns every result in one user message, and keeps assistant content unchanged', async () => {
    const thinking = { type: 'thinking' as const, thinking: '', signature: 'sig' };
    const { create, requests } = fakeClaude([
      { stop_reason: 'tool_use', content: [thinking, toolUse('t1', 'get_overview', {}), toolUse('t2', 'get_exercise_history', { exercise_id: 'nope' })] },
      { stop_reason: 'end_turn', content: [text('Ton squat est en **référence provisoire**.')] },
    ]);
    const out = await advance([userMessage('Où en est mon squat ?', TODAY)], create, TODAY);
    expect(out.kind).toBe('done');
    const second = requests[1]?.messages ?? [];
    expect(second[1]).toEqual({ role: 'assistant', content: [thinking, toolUse('t1', 'get_overview', {}), toolUse('t2', 'get_exercise_history', { exercise_id: 'nope' })] });
    const results = second[2]?.content;
    expect(Array.isArray(results) && results.map((r) => (r.type === 'tool_result' ? [r.tool_use_id, r.is_error === true] : null))).toEqual([
      ['t1', false],
      ['t2', true],
    ]);
    expect(visibleText(out.messages[out.messages.length - 1] as Msg)).toContain('référence provisoire');
    expect(visibleText(out.messages[0] as Msg)).toBe('Où en est mon squat ?');
  });

  it('pauses on a write tool, applies only after approval, then continues', async () => {
    const { create, requests } = fakeClaude([
      {
        stop_reason: 'tool_use',
        content: [
          text('Je te propose de baisser S2.'),
          toolUse('w1', 'set_exercise_week', { mesocycle_id: 'meso_cycle1', exercise_id: 'ex_squat', week_index: 2, top_percent: 0.82, reason: 'Montée plus douce' }),
          toolUse('w2', 'plan_session', { date: '2026-10-09', template_id: 'tpl_jeudi', reason: 'Rattrapage' }),
          toolUse('r1', 'get_templates', {}),
        ],
      },
      { stop_reason: 'end_turn', content: [text('C’est noté.')] },
    ]);
    const out = await advance([userMessage('Ajuste mon squat', TODAY)], create, TODAY);
    expect(out.kind).toBe('approval');
    if (out.kind !== 'approval') return;
    expect(out.pending.changes.map((c) => c.toolUseId)).toEqual(['w1', 'w2']);
    expect(out.pending.ready.map((r) => r.tool_use_id)).toEqual(['r1']);
    expect(weekOverrides('meso_cycle1', 'ex_squat').has(2)).toBe(false);

    const { outcome, applied } = await resolveApproval(out.messages, out.pending, new Map([['w1', true], ['w2', false]]), create, TODAY);
    expect(outcome.kind).toBe('done');
    expect(applied).toHaveLength(1);
    expect(weekOverrides('meso_cycle1', 'ex_squat').get(2)?.topPercent).toBe(0.82);
    expect(listPlanned('2026-10-09', '2026-10-09').some((p) => p.templateId === 'tpl_jeudi')).toBe(false);
    const results = requests[1]?.messages[requests[1].messages.length - 1]?.content;
    const contents = Array.isArray(results) ? results.map((r) => (r.type === 'tool_result' ? `${r.tool_use_id}:${String(r.content)}` : '')) : [];
    expect(contents[0]?.startsWith('r1:')).toBe(true);
    expect(contents[1]).toContain('validé');
    expect(contents[2]).toContain('refusé');
  });

  it('reports refusals and truncation, and repairs a history cut during an approval', async () => {
    const refusal = fakeClaude([{ stop_reason: 'refusal', content: [] }]);
    expect((await advance([userMessage('?', TODAY)], refusal.create, TODAY)).kind === 'done').toBe(true);
    const cut = fakeClaude([{ stop_reason: 'max_tokens', content: [text('…')] }]);
    const res = await advance([userMessage('?', TODAY)], cut.create, TODAY);
    expect(res.kind === 'done' && res.notice).toContain('coupée');

    const broken: Msg[] = [userMessage('x', TODAY), { role: 'assistant', content: [toolUse('w9', 'plan_session', { date: '2026-10-09', template_id: 'tpl_jeudi', reason: '' })] }];
    const fixed = repairHistory(broken);
    expect(fixed).toHaveLength(3);
    expect(JSON.stringify(fixed[2])).toContain('w9');
  });
});

describe('coach and swaps', () => {
  beforeEach(() => {
    createTestDb();
    importPersonalData();
  });

  it('sees a swapped exercise as done instead of the planned one, and the planned one as replaced, not missed', () => {
    const id = startWorkout({ date: TODAY, templateId: 'tpl_mercredi' });
    const row = loadWorkoutDoc(id)?.items.find((i) => i.exercise.id === 'ex_barbell_row');
    if (row === undefined) throw new Error('missing slot');
    replaceExercise(row.we.id, 'ex_machine_row');
    const set = loadWorkoutDoc(id)?.items.find((i) => i.we.id === row.we.id)?.sets[0];
    if (set === undefined) throw new Error('no set');
    updateSet({ ...set, weight: 60, reps: 10, completed: true, completedAt: Date.now() });
    finishWorkout(id);
    const recent = JSON.stringify(runReadTool('get_recent_workouts', { days: 3 }, TODAY));
    expect(recent).toContain(`"replaces":"${row.exercise.name}"`);
    const history = runReadTool('get_exercise_history', { exercise_id: 'ex_barbell_row' }, TODAY) as { replaced_on: { date: string; by: string }[] };
    expect(history.replaced_on).toEqual([{ date: TODAY, by: getExercise('ex_machine_row')?.name }]);
  });

  it('back-fills swaps made before the column existed (migration 8)', () => {
    const id = startWorkout({ date: TODAY, templateId: 'tpl_mercredi' });
    const row = loadWorkoutDoc(id)?.items.find((i) => i.exercise.id === 'ex_barbell_row');
    if (row === undefined) throw new Error('missing slot');
    replaceExercise(row.we.id, 'ex_machine_row');
    db().run('UPDATE workout_exercises SET replaces_exercise_id = NULL');
    // An exercise that differs from its slot without a recorded swap is left alone.
    db().run("UPDATE workout_exercises SET exercise_id = 'ex_leg_curl' WHERE workout_id = ? AND position = 4", [id]);
    db().exec((MIGRATIONS[7] ?? '').replace(/ALTER TABLE[^;]+;/, ''));
    const byPos = listWorkoutExercises(id).map((we) => we.replacesExerciseId);
    expect(byPos[row.we.position]).toBe('ex_barbell_row');
    expect(byPos.filter((v) => v !== null)).toHaveLength(1);
  });
});
