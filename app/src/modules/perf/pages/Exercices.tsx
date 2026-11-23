import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Field, Glass, IconButton, List, ListRow, Notice, Segmented, Sheet } from '@mylife/kit';
import { call } from '../data/client';
import type { ExerciseDetail, ExercisesView } from '../data/exercises';
import { Head } from './common';
import { NewExerciseSheet } from './Reglages';
import { errorText, MUSCLES, today, useData } from './util';
import '../perf.css';

/**
 * Les exercices (maquettes V3-Exercices et V3-Fiche, validées le 22/11) : la bibliothèque (ceux du programme d'abord,
 * avec leur repère), les variantes et les formats à soi ; la fiche d'un exercice (1RM de référence au même niveau que
 * l'estimé, courbe sur 1M/3M/6M/Tout, charges de travail, records, historique), qu'on modifie et dont on crée des
 * variantes. Lest net partout pour un lesté.
 */
const FILTERS: readonly { id: string; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'barbell', label: 'Barre' },
  { id: 'bodyweight', label: 'Poids du corps' },
  { id: 'weighted', label: 'Lestés' },
  { id: 'time', label: 'Au temps' },
  { id: 'mine', label: 'À moi' },
];
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function ExercisesPage() {
  const date = today();
  const { data: v, error, reload } = useData<ExercisesView>(() => call('exercisesView', date), [date]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [all, setAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const keep = useMemo(() => (l: { name: string; detail: string; kinds: string[] }) => (filter === 'all' || l.kinds.includes(filter)) && (!q || norm(`${l.name} ${l.detail}`).includes(norm(q))), [q, filter]);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!v) return <span className="t-small muted">Lecture des exercices…</span>;
  const program = v.inProgram.filter(keep);
  const others = v.others.filter(keep);
  const searching = q !== '' || filter !== 'all';
  const shownOthers = all || searching ? others : [];
  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 110 }}>
      <div className="pf-amb" aria-hidden="true" />
      <Head
        back="/"
        kicker={`${v.total} exercices · ${v.formats} format${v.formats > 1 ? 's' : ''}`}
        title="Exercices"
        right={
          <Button variant="action" onClick={() => setCreating(true)}>
            + Nouveau
          </Button>
        }
      />
      <input className="input" aria-label="Chercher un exercice" placeholder="Chercher : nom, muscle, matériel" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`pf-chip${filter === f.id ? '' : ' is-neutral'}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {program.length > 0 && (
        <>
          <span className="pf-sec">
            <span>Dans ton programme</span>
            <span>{program.length}</span>
          </span>
          <List>
            {program.map((l) => (
              <ListRow
                key={l.id}
                href={`/sport/exercices/${l.id}`}
                title={<span className="t-strong">{l.name}</span>}
                detail={l.detail}
                value={
                  l.value ? (
                    <span className="pf-val">
                      <b>{l.value}</b>
                      <small>{l.valueLabel}</small>
                    </span>
                  ) : undefined
                }
              />
            ))}
          </List>
        </>
      )}

      {!searching && v.variants.length > 0 && (
        <>
          <span className="pf-sec">
            <span>Variantes et formats</span>
            <span>à toi</span>
          </span>
          <List>
            {v.variants.map((x) => (
              <ListRow key={x.id} href={x.href} title={<span className="t-strong">{x.name}</span>} detail={x.detail} value={<span className="pf-chip is-neutral">{x.chip}</span>} />
            ))}
          </List>
        </>
      )}

      {shownOthers.length > 0 && (
        <>
          <span className="pf-sec">
            <span>{searching ? 'Les autres' : 'Tous les autres'}</span>
            <span>{others.length}</span>
          </span>
          <List>
            {shownOthers.map((l) => (
              <ListRow key={l.id} href={`/sport/exercices/${l.id}`} title={l.name} detail={l.detail} />
            ))}
          </List>
        </>
      )}
      {!searching && others.length > 0 && (
        <button type="button" className="pf-link is-muted" style={{ alignSelf: 'center' }} onClick={() => setAll(!all)}>
          {all ? 'Moins' : `Autres : ${others.length} exercices · tout voir`}
        </button>
      )}
      {searching && program.length + others.length === 0 && <span className="t-small muted">Aucun exercice ne correspond.</span>}

      <NewExerciseSheet
        open={creating}
        name={q}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          reload();
          navigate(`/sport/exercices/${id}`);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- la fiche

const PERIODS = [
  { id: '1M', days: 31 },
  { id: '3M', days: 92 },
  { id: '6M', days: 183 },
  { id: 'Tout', days: 100_000 },
] as const;

function Curve({ points, reference }: { points: { date: string; value: number }[]; reference: number | null }) {
  if (points.length < 2) return <span className="t-small muted">Pas encore assez de séances pour tracer la courbe.</span>;
  const values = [...points.map((p) => p.value), ...(reference !== null ? [reference] : [])];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const y = (v: number) => 104 - ((v - min) / span) * 84;
  const x = (i: number) => (i / (points.length - 1)) * 320;
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!;
  return (
    <>
      <svg viewBox="0 0 320 120" width="100%" height="120" role="img" aria-label={`Courbe du 1RM estimé, de ${points[0]!.value} à ${last.value} kg`}>
        <defs>
          <linearGradient id="pf-curve" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--tone-solid)" stopOpacity=".35" />
            <stop offset="1" stopColor="var(--tone-solid)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {reference !== null && <line x1="0" x2="320" y1={y(reference)} y2={y(reference)} stroke="var(--ink-2)" strokeOpacity=".5" strokeDasharray="4 5" />}
        <path d={`M0 ${y(points[0]!.value)} L${line.replace(/ /g, ' L')} L320 120 L0 120 Z`} fill="url(#pf-curve)" />
        <polyline points={line} fill="none" stroke="var(--tone-solid)" strokeWidth="2.5" />
        <circle cx="320" cy={y(last.value)} r="4" fill="var(--tone-solid)" />
      </svg>
      <div className="row t-small muted">
        <span className="grow">{new Date(`${points[0]!.date}T12:00:00`).toLocaleDateString('fr-FR', { month: 'long' })}</span>
        <span>{new Date(`${last.date}T12:00:00`).toLocaleDateString('fr-FR', { month: 'long' })}</span>
      </div>
    </>
  );
}

export function ExercisePage() {
  const { id = '' } = useParams();
  const date = today();
  const navigate = useNavigate();
  const { data: e, error, reload } = useData<ExerciseDetail | null>(() => call('exerciseDetail', id, date), [id, date]);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['id']>('3M');
  const [sheet, setSheet] = useState<'edit' | 'reference' | 'variant' | null>(null);
  const [kept, setKept] = useState(false);
  const [history, setHistory] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => setKept(false), [id]);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (e === null) return <Notice>Cet exercice n’existe plus.</Notice>;
  if (!e) return <span className="t-small muted">Lecture…</span>;
  const act = async (p: Promise<unknown>) => {
    try {
      await p;
      setFailed(null);
      setSheet(null);
      reload();
    } catch (err) {
      setFailed(errorText(err));
    }
  };
  const cutoff = new Date(Date.now() - PERIODS.find((p) => p.id === period)!.days * 86_400_000).toISOString().slice(0, 10);
  const points = e.curve.filter((p) => p.date >= cutoff);
  const unit = e.weighted ? 'kg de lest' : 'kg';
  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 110 }}>
      <div className="pf-amb" aria-hidden="true" />
      <Head back="/sport/exercices" kicker={e.kicker} title={e.name} right={<IconButton icon="settings" label="Modifier l’exercice" onClick={() => setSheet('edit')} />} />
      {failed && <Notice tone="bad">{failed}</Notice>}
      {e.variantOf && <span className="t-small muted" style={{ marginTop: -8 }}>{`variante de ${e.variantOf.name}`}</span>}

      <div className="card-module pf-hero">
        <div className="pf-two">
          <button type="button" className="pf-stat-big" onClick={() => setSheet('reference')}>
            <span className="t-label muted">1RM de référence</span>
            <span className="pf-big" style={{ fontSize: 30 }}>
              {e.reference?.source === 'saisi' ? e.reference.text.replace(' kg', '') : '—'}
            </span>
            <span className="t-small muted">{e.reference?.source === 'saisi' ? `${unit} · le ${e.reference.when}` : 'à saisir'}</span>
          </button>
          <span className="pf-stat-big">
            <span className="t-label muted">Estimé</span>
            <span className="pf-big c-tone" style={{ fontSize: 30 }}>
              {e.estimate ? e.estimate.text.replace(' kg', '') : '—'}
            </span>
            <span className="t-small muted">{e.estimate ? `${unit}${e.estimate.delta ? ` · ${e.estimate.delta}` : ''}` : 'pas encore de séries'}</span>
          </span>
        </div>
        {e.proposal && !kept && (
          <div className="row pf-proposal">
            <span className="grow t-small">
              Passer la référence à <b>{e.proposal.text}</b> ?
            </span>
            <Button onClick={() => setKept(true)}>Garder</Button>
            <Button variant="action" onClick={() => void act(call('setReference', e.id, e.proposal!.value, date))}>
              Appliquer
            </Button>
          </div>
        )}
      </div>

      <Glass className="pf-curvecard">
        <div className="row">
          <span className="grow t-strong">1RM estimé</span>
          <div className="segmented" role="group" aria-label="Période">
            {PERIODS.map((p) => (
              <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>
                {p.id}
              </button>
            ))}
          </div>
        </div>
        <Curve points={points} reference={e.reference?.source === 'saisi' ? e.reference.value : null} />
      </Glass>

      {e.loads.length > 0 && (
        <>
          <span className="pf-sec">
            <span>Charges de travail</span>
            <span>{e.weighted ? 'lest' : 'kg'}</span>
          </span>
          <Glass className="pf-tablewrap">
            <table className="pf-table">
              <thead>
                <tr>
                  <th />
                  {e.loads.map((l) => (
                    <th key={l.reps}>{l.reps}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="pf-tl">reps</td>
                  {e.loads.map((l) => (
                    <td key={l.reps}>{l.text}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </Glass>
        </>
      )}

      {e.records.length > 0 && (
        <>
          <span className="pf-sec">
            <span>Records</span>
            <span />
          </span>
          <List>
            {e.records.map((r) => (
              <ListRow key={r.label} title={r.label} value={<span className="row" style={{ gap: 8 }}><b>{r.value}</b>{r.when && <span className="pf-chip">{r.when}</span>}</span>} />
            ))}
          </List>
        </>
      )}

      <List>
        <ListRow title="Variantes" value={<span className="t-small muted">{e.variants.length ? e.variants.map((x) => x.name).join(', ') : '+ créer'}</span>} onClick={() => setSheet('variant')} />
        <ListRow title="Historique" value={<span className="t-small muted">{`${e.sessions} séance${e.sessions > 1 ? 's' : ''}`}</span>} onClick={e.sessions ? () => setHistory(!history) : undefined} />
      </List>
      {history && (
        <List>
          {e.history.map((x, i) => (
            <ListRow key={i} title={x.summary} detail={`${x.when} · ${x.name}`} />
          ))}
        </List>
      )}

      <EditExerciseSheet
        open={sheet === 'edit'}
        exercise={e}
        onClose={() => setSheet(null)}
        onSave={(patch) => void act(call('updateExercise', e.id, patch))}
        onArchive={async () => {
          try {
            await call('archiveExercise', e.id);
            navigate('/sport/exercices', { replace: true });
          } catch (err) {
            setFailed(errorText(err));
            setSheet(null);
          }
        }}
      />
      <ReferenceSheet open={sheet === 'reference'} exercise={e} onClose={() => setSheet(null)} onSave={(value) => void act(call('setReference', e.id, value, date))} />
      <VariantSheet
        open={sheet === 'variant'}
        exercise={e}
        onClose={() => setSheet(null)}
        onCreate={async (name) => {
          try {
            const vid = await call('createVariant', e.id, name);
            setSheet(null);
            navigate(`/sport/exercices/${vid}`);
          } catch (err) {
            setFailed(errorText(err));
          }
        }}
      />
    </div>
  );
}

function ReferenceSheet({ open, exercise, onClose, onSave }: { open: boolean; exercise: ExerciseDetail; onClose: () => void; onSave: (v: number | null) => void }) {
  const [text, setText] = useState('');
  useEffect(() => setText(exercise.reference?.source === 'saisi' ? String(exercise.reference.value).replace('.', ',') : ''), [open, exercise]);
  const value = Number(text.replace(',', '.').replace('+', '').trim());
  return (
    <Sheet open={open} title="1RM de référence" onClose={onClose}>
      <div className="stack">
        <Field id="pf-ex-ref" label={exercise.weighted ? 'Lest (kg), sans le poids du corps' : 'Charge (kg)'}>
          <input id="pf-ex-ref" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </Field>
        {exercise.estimate && <span className="t-small muted">{`Estimé sur tes séries : ${exercise.estimate.text}`}</span>}
        <Button variant="action" block disabled={!text.trim() || !Number.isFinite(value)} onClick={() => onSave(value)}>
          Enregistrer
        </Button>
        {exercise.reference?.source === 'saisi' && (
          <Button block onClick={() => onSave(null)}>
            Revenir à l’estimation
          </Button>
        )}
      </div>
    </Sheet>
  );
}

function VariantSheet({ open, exercise, onClose, onCreate }: { open: boolean; exercise: ExerciseDetail; onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('');
  useEffect(() => setName(open ? `${exercise.name} ` : ''), [open, exercise.name]);
  return (
    <Sheet open={open} title="Variantes" onClose={onClose}>
      <div className="stack">
        {exercise.variants.length > 0 && (
          <List>
            {exercise.variants.map((x) => (
              <ListRow key={x.id} title={x.name} href={`/sport/exercices/${x.id}`} />
            ))}
          </List>
        )}
        <Field id="pf-variant" label="Nouvelle variante">
          <input id="pf-variant" value={name} maxLength={80} placeholder={`${exercise.name} pause 2 s`} onChange={(e) => setName(e.target.value)} />
        </Field>
        <span className="t-small muted">Mêmes muscles et même charge ; son propre 1RM et sa propre progression.</span>
        <Button variant="action" block disabled={!name.trim() || name.trim() === exercise.name} onClick={() => onCreate(name)}>
          Créer la variante
        </Button>
      </div>
    </Sheet>
  );
}

const EQUIPMENTS: readonly [string, string][] = [
  ['barbell', 'Barre'],
  ['dumbbell', 'Haltères'],
  ['machine', 'Machine'],
  ['cable', 'Poulie'],
  ['bodyweight', 'Poids du corps'],
  ['kettlebell', 'Kettlebell'],
  ['band', 'Élastique'],
  ['other', 'Autre'],
];

function EditExerciseSheet({ open, exercise, onClose, onSave, onArchive }: { open: boolean; exercise: ExerciseDetail; onClose: () => void; onSave: (patch: Parameters<typeof call<'updateExercise'>>[2]) => void; onArchive: () => void }) {
  const [name, setName] = useState(exercise.name);
  const [load, setLoad] = useState(exercise.loadType as 'external' | 'bodyweight');
  const [category, setCategory] = useState(exercise.category as 'main' | 'compound' | 'isolation');
  const [equipment, setEquipment] = useState(exercise.equipment);
  const [primary, setPrimary] = useState(exercise.primary[0] ?? 'chest');
  const [secondary, setSecondary] = useState<string[]>(exercise.secondary);
  const [variantOf, setVariantOf] = useState(exercise.variantOf?.id ?? '');
  const [notes, setNotes] = useState(exercise.notes);
  const [choices, setChoices] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!open) return;
    setName(exercise.name);
    setLoad(exercise.loadType as 'external' | 'bodyweight');
    setCategory(exercise.category as 'main' | 'compound' | 'isolation');
    setEquipment(exercise.equipment);
    setPrimary(exercise.primary[0] ?? 'chest');
    setSecondary(exercise.secondary);
    setVariantOf(exercise.variantOf?.id ?? '');
    setNotes(exercise.notes);
    void call('exerciseChoices', exercise.id).then(setChoices);
  }, [open, exercise]);
  return (
    <Sheet open={open} title="Modifier l’exercice" onClose={onClose}>
      <div className="stack" style={{ gap: 14 }}>
        <Field id="pf-edit-name" label="Nom">
          <input id="pf-edit-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Segmented
          label="Charge"
          value={load}
          options={[
            { id: 'external', label: 'Charge' },
            { id: 'bodyweight', label: 'Poids du corps / lest' },
          ]}
          onChange={setLoad}
        />
        <Segmented
          label="Type"
          value={category}
          options={[
            { id: 'main', label: 'Force (au %)' },
            { id: 'compound', label: 'Polyarticulaire' },
            { id: 'isolation', label: 'Isolation' },
          ]}
          onChange={setCategory}
        />
        <Field id="pf-edit-eq" label="Matériel">
          <select id="pf-edit-eq" value={equipment} onChange={(e) => setEquipment(e.target.value)}>
            {EQUIPMENTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field id="pf-edit-muscle" label="Muscle principal">
          <select id="pf-edit-muscle" value={primary} onChange={(e) => setPrimary(e.target.value)}>
            {MUSCLES.map(([m, l]) => (
              <option key={m} value={m}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <div className="stack" style={{ gap: 8 }}>
          <span className="pf-sec" style={{ margin: 0, padding: 0 }}>
            Muscles secondaires
          </span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {MUSCLES.filter(([m]) => m !== primary).map(([m, l]) => {
              const on = secondary.includes(m);
              return (
                <button key={m} type="button" className={`pf-chip${on ? '' : ' is-neutral'}`} aria-pressed={on} onClick={() => setSecondary(on ? secondary.filter((x) => x !== m) : [...secondary, m])}>
                  {l}
                </button>
              );
            })}
          </div>
        </div>
        <Field id="pf-edit-variant" label="Variante de">
          <select id="pf-edit-variant" value={variantOf} onChange={(e) => setVariantOf(e.target.value)}>
            <option value="">Aucun (exercice à part entière)</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="pf-edit-notes" label="Consignes">
          <textarea id="pf-edit-notes" className="input pf-note" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Button
          variant="action"
          block
          disabled={!name.trim()}
          onClick={() => onSave({ name, loadType: load, category, equipment, primary: [primary, ...(exercise.primary.slice(1).filter((m) => m !== primary))], secondary: secondary.filter((m) => m !== primary), variantOf: variantOf || null, notes })}
        >
          Enregistrer
        </Button>
        <Button variant="danger" block onClick={onArchive}>
          Archiver l’exercice
        </Button>
        {exercise.inTemplates.length > 0 && <span className="t-small muted">{`Dans : ${exercise.inTemplates.join(', ')}`}</span>}
      </div>
    </Sheet>
  );
}
