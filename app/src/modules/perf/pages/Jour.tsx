import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Field, Glass, IconButton, List, ListRow, Notice, Segmented, Sheet } from '@mylife/kit';
import { readAgenda, eventsOn } from '@mylife/lumen';
import type { DayView, PlannedSession } from '../data/day';
import { call } from '../data/client';
import { cloudBoot, dropForeign, useCloud } from '../data/cloud';
import '../perf.css';

/**
 * Jour : « qu'est-ce que je fais aujourd'hui, avec quelles charges ? ». La séance du jour telle qu'elle sera prescrite
 * (même moteur que le démarrage), « Démarrer » toujours en haut ; la semaine ; la dernière séance et ses records.
 * Les sorties de l'agenda commun (MyRave) sont signalées. Le « + » ouvre toujours le même petit menu.
 */
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const DAYS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
const longDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long' });
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const initials = (name: string) =>
  name
    .split(/[\s–-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export function JourPage() {
  const navigate = useNavigate();
  const cloud = useCloud();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<DayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clean, setClean] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const date = today();

  useEffect(() => {
    dropForeign().then(
      () => setClean(true),
      (e: Error) => setError(e.message),
    );
    cloudBoot();
  }, []);
  const reload = useCallback(() => call('dayView', date).then(setView, (e: Error) => setError(e.message)), [date]);
  useEffect(() => {
    if (clean) void reload();
  }, [clean, reload, cloud.lastSyncAt, cloud.synced]);

  const begin = async (templateId: string | null) => {
    await call('startSession', templateId, date);
    navigate('/sport/seance');
  };

  // Les sorties de la semaine (agenda commun) : un jour de séance prévue qui tombe un jour de sortie est signalé.
  const sorties = view ? readAgenda(view.week[0]!.date, view.week[6]!.date, date).events.filter((e) => e.kind === 'sortie') : [];
  const conflict = view?.week.find((d) => d.date >= date && d.planned.length > 0 && eventsOn(sorties, d.date).length > 0);

  if (error) return <Notice tone="bad">MyPerf n’a pas pu lire ses données : {error}</Notice>;

  const main: { kicker: string; session: PlannedSession; start: string } | null = view
    ? view.today[0]
      ? { kicker: `Prévu aujourd’hui · ${view.today[0].minutes} min environ`, session: view.today[0], start: 'Démarrer' }
      : view.next
        ? { kicker: `Repos aujourd’hui · prochaine séance ${longDay(view.next.date)}`, session: view.next.session, start: 'La faire maintenant' }
        : null
    : null;

  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 110 }}>
      <header className="row" style={{ alignItems: 'flex-end' }}>
        <IconButton icon="back" label="Retour à MyLife" href="/" />
        <div className="grow" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {view?.block ? <span className="module-label">{`${view.block.name} · semaine ${view.block.week} / ${view.block.of}${view.block.deload ? ' · décharge' : ''}`}</span> : <span className="t-small muted">MyPerf</span>}
          <h1 className="t-screen">Aujourd’hui</h1>
        </div>
      </header>

      {!view && <span className="t-small muted">Lecture de tes séances…</span>}

      {view?.active && (
        <Glass className="pad stack" style={{ gap: 10 }}>
          <span className="t-small muted">{`Séance en cours · ${view.active.done} / ${view.active.total} séries`}</span>
          <span className="pf-big" style={{ fontSize: 28 }}>
            {view.active.name}
          </span>
          <Button variant="action" block href="/sport/seance">
            Reprendre la séance
          </Button>
        </Glass>
      )}

      {view && !view.active && main && (
        <Glass className="pad stack" style={{ gap: 12 }}>
          <span className="t-small muted">{main.kicker}</span>
          <span className="pf-big" style={{ fontSize: 28 }}>
            {main.session.name}
          </span>
          <div className="row" style={{ gap: 8 }}>
            <div className="grow">
              <Button variant="action" block onClick={() => void begin(main.session.id)}>
                {main.start}
              </Button>
            </div>
            <Button onClick={() => setChoosing(true)}>Autre séance</Button>
          </div>
          <div className="stack-0" style={{ borderTop: '1px solid var(--line)', marginTop: 4 }}>
            {main.session.lines.map((l, i) => (
              <div key={i} className="list-row" style={{ minHeight: 44 }}>
                <span className="grow">
                  <span className="t-strong">{l.name}</span>
                  <br />
                  <span className="t-small muted">{l.detail}</span>
                </span>
                {l.load && <span className="t-strong">{l.load}</span>}
              </div>
            ))}
          </div>
        </Glass>
      )}

      {view && !view.active && !main && (
        <Glass className="pad stack" style={{ gap: 10 }}>
          <span className="t-small muted">{view.hasProgram ? 'Rien de prévu cette semaine' : 'Pas encore de programme'}</span>
          <Button variant="action" block onClick={() => void begin(null)}>
            Séance libre
          </Button>
          {view.others.length > 0 && <Button block onClick={() => setChoosing(true)}>Une de mes séances</Button>}
        </Glass>
      )}

      {conflict && <Notice tone="warn">{`Sortie ${longDay(conflict.date)} : ${conflict.planned.join(', ')} prévue ce jour-là`}</Notice>}

      {view && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }} aria-label="La semaine">
          {view.week.map((d, i) => {
            const isToday = d.date === date;
            const done = d.done.length > 0;
            const sortie = eventsOn(sorties, d.date).length > 0;
            const label = done ? '✓' : d.planned.length ? initials(d.planned[0]!) : '·';
            return (
              <span key={d.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-2)' }} title={[...d.done, ...d.planned].join(', ') || undefined}>
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 99,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    color: isToday ? '#fff' : done || d.planned.length ? 'var(--ink)' : 'var(--ink-2)',
                    background: isToday ? 'var(--action)' : done ? 'var(--ok-bg)' : 'transparent',
                    border: `1px solid ${isToday ? 'var(--action-border)' : sortie ? 'var(--warn-border)' : done ? 'var(--ok-border)' : d.planned.length ? 'var(--tile-border)' : 'transparent'}`,
                  }}
                >
                  {label}
                </span>
                {DAYS[i]}
              </span>
            );
          })}
        </div>
      )}

      {view?.last && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="t-label muted" style={{ padding: '0 4px' }}>
            Dernière séance
          </span>
          <List>
            <ListRow title={view.last.name} detail={`${shortDate(view.last.date)} · ${view.last.sets} séries · ${view.last.tonnage.toLocaleString('fr-FR')} kg${view.last.minutes ? ` · ${view.last.minutes} min` : ''}`} />
            {view.last.records.map((r) => (
              <ListRow key={r.name} title={<span className="c-ok">{`Record · ${r.name}`}</span>} value={r.text} />
            ))}
          </List>
        </div>
      )}

      {view && (
        <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button variant="quiet" href="/sport/donnees">
            Tes données
          </Button>
          <a className="btn btn-quiet" href="/perf/">
            Programme et progrès : app d’avant
          </a>
        </div>
      )}

      <Sheet open={choosing} title="Une autre séance" onClose={() => setChoosing(false)}>
        <div className="stack">
          {view && view.others.length > 0 && (
            <List>
              {[...view.today.slice(1), ...view.others].map((s) => (
                <ListRow key={s.id} title={s.name} onClick={() => void begin(s.id)} />
              ))}
            </List>
          )}
          <Button block onClick={() => void begin(null)}>
            Séance libre
          </Button>
        </div>
      </Sheet>

      <AddSheet
        open={params.get('ajouter') === '1'}
        date={date}
        onStartFree={() => void begin(null)}
        onClose={() => {
          params.delete('ajouter');
          setParams(params, { replace: true });
          void reload();
        }}
      />
    </div>
  );
}

const MUSCLES: readonly [string, string][] = [
  ['chest', 'Pectoraux'],
  ['back', 'Dos'],
  ['lats', 'Grand dorsal'],
  ['shoulders', 'Épaules'],
  ['rear_delts', 'Arrière d’épaule'],
  ['biceps', 'Biceps'],
  ['triceps', 'Triceps'],
  ['forearms', 'Avant-bras'],
  ['abs', 'Abdos'],
  ['lower_back', 'Lombaires'],
  ['glutes', 'Fessiers'],
  ['quads', 'Quadriceps'],
  ['hamstrings', 'Ischios'],
  ['adductors', 'Adducteurs'],
  ['calves', 'Mollets'],
  ['traps', 'Trapèzes'],
];

/** Le « + » de MyPerf : toujours le même petit menu (séance libre, poids du jour, nouvel exercice). */
function AddSheet({ open, date, onStartFree, onClose }: { open: boolean; date: string; onStartFree: () => void; onClose: () => void }) {
  const [mode, setMode] = useState<'menu' | 'weight' | 'exercise'>('menu');
  const [weight, setWeight] = useState('');
  const [name, setName] = useState('');
  const [load, setLoad] = useState<'external' | 'bodyweight'>('external');
  const [category, setCategory] = useState<'main' | 'compound' | 'isolation'>('compound');
  const [muscle, setMuscle] = useState('chest');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setMode('menu');
    setWeight('');
    setName('');
    setError(null);
    setDone(null);
  }, [open]);
  const saveWeight = async () => {
    const v = Number(weight.replace(',', '.'));
    try {
      await call('addBodyweight', date, v);
      setDone(`Poids du jour noté : ${String(v).replace('.', ',')} kg`);
      setMode('menu');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const saveExercise = async () => {
    try {
      await call('createExercise', { name, loadType: load, category, equipment: load === 'bodyweight' ? 'bodyweight' : 'other', primary: [muscle] });
      setDone(`Exercice créé : ${name.trim()}`);
      setMode('menu');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Sheet open={open} title={mode === 'weight' ? 'Poids du jour' : mode === 'exercise' ? 'Nouvel exercice' : 'Ajouter'} onClose={onClose}>
      <div className="stack">
        {done && <Notice tone="ok">{done}</Notice>}
        {error && <Notice tone="bad">{error}</Notice>}
        {mode === 'menu' && (
          <List>
            <ListRow title="Séance libre" detail="sans programme, exercices au fil de l’eau" onClick={onStartFree} />
            <ListRow title="Poids du jour" detail="sert aussi aux charges des lestés" onClick={() => setMode('weight')} />
            <ListRow title="Nouvel exercice" detail="à toi, réglable ensuite" onClick={() => setMode('exercise')} />
          </List>
        )}
        {mode === 'weight' && (
          <>
            <Field id="pf-bw" label="Poids (kg)">
              <input id="pf-bw" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} autoFocus />
            </Field>
            <Button variant="action" block disabled={!weight.trim()} onClick={() => void saveWeight()}>
              Noter
            </Button>
          </>
        )}
        {mode === 'exercise' && (
          <>
            <Field id="pf-ex-name" label="Nom">
              <input id="pf-ex-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
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
              label="Catégorie"
              value={category}
              options={[
                { id: 'main', label: 'Principal' },
                { id: 'compound', label: 'Polyarticulaire' },
                { id: 'isolation', label: 'Isolation' },
              ]}
              onChange={setCategory}
            />
            <Field id="pf-ex-muscle" label="Muscle principal">
              <select id="pf-ex-muscle" value={muscle} onChange={(e) => setMuscle(e.target.value)}>
                {MUSCLES.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Button variant="action" block disabled={!name.trim()} onClick={() => void saveExercise()}>
              Créer
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
