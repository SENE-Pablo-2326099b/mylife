import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Field, Glass, Icon, IconButton, List, ListRow, Notice, Segmented, Sheet } from '@mylife/kit';
import { readAgenda, eventsOn } from '@mylife/lumen';
import type { DayView, PlannedSession } from '../data/day';
import { call } from '../data/client';
import { cloudBoot, dropForeign, useCloud } from '../data/cloud';
import '../perf.css';

/**
 * Jour (maquette V3-Jour, validée le 22/11) : « qu'est-ce que je fais aujourd'hui, avec quelles charges ? ». La séance
 * du jour telle qu'elle sera prescrite (même moteur que le démarrage), « Démarrer » toujours en haut ; une sortie de
 * l'agenda commun (MyRave) un jour de séance : une ligne, et « Décaler » ; la semaine ; la dernière séance et ses
 * records. Le « + » ouvre toujours le même petit menu.
 */
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const DAYS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
const longDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long' });
const longDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000);
const tonnage = (kg: number) => (kg >= 1000 ? `${(kg / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} t` : `${kg.toLocaleString('fr-FR')} kg`);
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
  const [moving, setMoving] = useState(false);
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

  // Les sorties de la semaine (agenda commun) : une séance prévue un jour de sortie est signalée, et se décale.
  const sorties = view ? readAgenda(view.week[0]!.date, view.week[6]!.date, date).events.filter((e) => e.kind === 'sortie') : [];
  const conflict = view?.week.find((d) => d.date >= date && d.done.length === 0 && d.planned.length > 0 && eventsOn(sorties, d.date).length > 0);

  if (error) return <Notice tone="bad">MyPerf n’a pas pu lire ses données : {error}</Notice>;

  const main: { kicker: string; session: PlannedSession; start: string } | null = view
    ? view.today[0]
      ? {
          kicker: `${view.today[0].movedFrom ? `Décalée de ${longDay(view.today[0].movedFrom)}` : 'Séance du jour'} · ${count(view.today[0].lines.length)} · ${view.today[0].minutes} min`,
          session: view.today[0],
          start: 'Démarrer',
        }
      : view.next
        ? { kicker: `Repos aujourd’hui · prochaine ${longDay(view.next.date)} · ${view.next.session.minutes} min`, session: view.next.session, start: 'La faire maintenant' }
        : null
    : null;
  const block = view?.block;
  const plannedCount = view ? view.week.reduce((n, d) => n + Math.max(d.planned.length, d.done.length), 0) : 0;

  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 110 }}>
      <div className="pf-amb" aria-hidden="true" />
      <header className="row" style={{ alignItems: 'flex-end' }}>
        <IconButton icon="back" label="Retour à MyLife" href="/" />
        <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span className="pf-kick">{longDate(date)}</span>
          <h1 className="t-screen">Aujourd’hui</h1>
        </div>
        <IconButton icon="settings" label="Tes données" href="/sport/donnees" />
      </header>

      {block && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="pf-chip">{`${block.name ? `${block.name} · ` : ''}semaine ${block.week} sur ${block.of}${block.deload ? ' · décharge' : ''}`}</span>
          {block.index !== null && block.total !== null && block.total > 1 && <span className="pf-chip is-neutral">{`Bloc ${block.index} sur ${block.total}`}</span>}
        </div>
      )}

      {!view && <span className="t-small muted">Lecture de tes séances…</span>}

      {view?.active && (
        <div className="card-module pf-hero">
          <span className="pf-kick">{`Séance en cours · ${view.active.done} / ${view.active.total} séries`}</span>
          <span className="pf-big" style={{ fontSize: 30 }}>
            {view.active.name}
          </span>
          <Button variant="action" block href="/sport/seance">
            Reprendre la séance
          </Button>
        </div>
      )}

      {view && !view.active && main && (
        <div className="card-module pf-hero">
          <div className="row" style={{ gap: 8 }}>
            <span className="grow pf-kick">{main.kicker}</span>
            {block && <span className="pf-chip">{`S${block.week}`}</span>}
          </div>
          <span className="pf-big" style={{ fontSize: 30 }}>
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
          <div className="pf-lines">
            {main.session.lines.map((l, i) => (
              <div key={i} className="pf-line">
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t-strong">{l.name}</span>
                  <br />
                  <span className="t-small muted">{l.detail}</span>
                </span>
                {l.load && <span className="t-strong pf-nowrap">{l.load}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {view && !view.active && !main && (
        <div className="card-module pf-hero">
          <span className="pf-kick">{view.hasProgram ? 'Rien de prévu cette semaine' : 'Pas encore de programme'}</span>
          <span className="pf-big" style={{ fontSize: 30 }}>
            Séance libre
          </span>
          <Button variant="action" block onClick={() => void begin(null)}>
            Démarrer
          </Button>
          {view.others.length > 0 && <Button block onClick={() => setChoosing(true)}>Une de mes séances</Button>}
        </div>
      )}

      {conflict && (
        <Glass className="row pf-alert">
          <span className="pf-alert-ico" aria-hidden="true">
            <Icon name="navigate" size={19} />
          </span>
          <span className="grow t-small" style={{ minWidth: 0 }}>
            <b>{`Sortie ${longDay(conflict.date)}`}</b>
            <span className="muted">{` · ${conflict.planned.map((p) => p.name).join(', ')} prévue ce jour-là`}</span>
          </span>
          <Button onClick={() => setMoving(true)}>Décaler</Button>
        </Glass>
      )}

      {view && (
        <>
          <span className="pf-sec">
            <span>Ta semaine</span>
            <span>{plannedCount ? `${plannedCount} séance${plannedCount > 1 ? 's' : ''} prévue${plannedCount > 1 ? 's' : ''}` : ''}</span>
          </span>
          <Glass className="pf-week">
            {view.week.map((d, i) => {
              const isToday = d.date === date;
              const done = d.done.length > 0;
              const sortie = eventsOn(sorties, d.date).length > 0;
              const label = done ? '✓' : d.planned.length ? initials(d.planned[0]!.name) : '·';
              const kind = isToday ? 'is-today' : done ? 'is-done' : sortie ? 'is-sortie' : d.planned.length ? '' : 'is-off';
              const names = [...d.done, ...d.planned.map((p) => p.name)].join(', ');
              return (
                <span key={d.date} className="pf-day" title={names || undefined}>
                  {DAYS[i]}
                  <span className={`pf-dot ${kind}`} aria-label={`${longDay(d.date)} : ${done ? `fait, ${d.done.join(', ')}` : names || 'repos'}${sortie ? ', sortie' : ''}`}>
                    {label}
                  </span>
                </span>
              );
            })}
          </Glass>
        </>
      )}

      {view?.last && (
        <>
          <span className="pf-sec">
            <span>Dernière séance</span>
            <span>{daysBetween(view.last.date, date) < 7 ? longDay(view.last.date) : shortDate(view.last.date)}</span>
          </span>
          <List>
            <ListRow title={view.last.name} detail={`${view.last.sets} séries · ${tonnage(view.last.tonnage)}${view.last.minutes ? ` · ${view.last.minutes} min` : ''}`} />
            {view.last.records.map((r) => (
              <ListRow
                key={r.name}
                title={r.name}
                value={
                  <span className="row" style={{ gap: 10 }}>
                    <span className="t-small muted">{r.text}</span>
                    <span className="pf-chip">Record</span>
                  </span>
                }
              />
            ))}
          </List>
        </>
      )}

      {view && (
        <a className="btn btn-quiet" href="/perf/" style={{ alignSelf: 'center' }}>
          Programme et progrès : app d’avant
        </a>
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

      {view && conflict && (
        <MoveSheet
          open={moving}
          view={view}
          from={conflict.date}
          today={date}
          sorties={(d) => eventsOn(sorties, d).length > 0}
          onClose={() => setMoving(false)}
          onMoved={() => {
            setMoving(false);
            void reload();
          }}
        />
      )}

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

const count = (n: number) => `${n} exercice${n > 1 ? 's' : ''}`;

/** « Décaler » : la séance d'un jour de sortie va un autre jour de la semaine, cette fois-là. */
function MoveSheet({ open, view, from, today, sorties, onClose, onMoved }: { open: boolean; view: DayView; from: string; today: string; sorties: (date: string) => boolean; onClose: () => void; onMoved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const day = view.week.find((d) => d.date === from);
  const session = day?.planned[0];
  if (!session) return null;
  const choices = view.week.filter((d) => d.date >= today && d.date !== from);
  const move = async (to: string) => {
    try {
      await call('moveSession', session.id, from, to);
      onMoved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Sheet open={open} title={`Décaler ${session.name}`} onClose={onClose}>
      <div className="stack">
        {error && <Notice tone="bad">{error}</Notice>}
        {choices.length ? (
          <List>
            {choices.map((d) => (
              <ListRow
                key={d.date}
                title={longDay(d.date).replace(/^./, (c) => c.toUpperCase())}
                detail={[d.done.length ? `fait : ${d.done.join(', ')}` : d.planned.length ? `déjà : ${d.planned.map((p) => p.name).join(', ')}` : 'libre', sorties(d.date) ? 'sortie' : ''].filter(Boolean).join(' · ')}
                onClick={() => void move(d.date)}
              />
            ))}
          </List>
        ) : (
          <span className="t-small muted">Plus de jour libre cette semaine.</span>
        )}
      </div>
    </Sheet>
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
