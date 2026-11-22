import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Glass, Icon, IconButton, List, ListRow, Notice, Segmented, Sheet } from '@mylife/kit';
import { barbellPlates, describePlates, restSeconds } from '@mylife/training';
import { call } from '../data/client';
import { syncCloud, syncSoon } from '../data/cloud';
import type { Backend } from '../data/backend';
import type { SessionDoc, SessionItem, SessionSet } from '../data/session';

type SetPatch = NonNullable<Parameters<Backend['completeSet']>[1]>;
import { adjustRest, signal, skipRest, startRest, useClock, useRest, useWakeLock } from '../session/timers';
import '../perf.css';

/**
 * La séance en salle (étape P2). Une seule chose domine : la série en cours. Le repos reste en bandeau, la séance
 * toujours lisible ; le clavier ne s'ouvre qu'en touchant une case. Chaque série est écrite dans la base avant que
 * l'écran avance ; fermer l'app en plein milieu ne perd rien (la séance se relit depuis la base).
 */
const kg = (v: number | null, weighted: boolean) => (v === null ? '—' : `${weighted && v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`);
const pct = (v: number) => `${Math.round(v * 1000) / 10} %`.replace('.', ',');
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;
const isDone = (i: SessionItem) => i.sets.length > 0 && i.sets.every((s) => s.completed);

type Field = 'weight' | 'reps' | 'bw';
interface Editing {
  setId: string;
  field: Field;
}

export function SessionPage() {
  const navigate = useNavigate();
  const [id, setId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SessionDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [replacing, setReplacing] = useState<SessionItem | null>(null);
  const [ending, setEnding] = useState(false);
  const awake = useWakeLock(doc?.status === 'active');

  const reload = useCallback(async (sid: string) => {
    const next = await call('sessionDoc', sid);
    setDoc(next);
    return next;
  }, []);

  useEffect(() => {
    call('activeSession').then(
      (sid) => {
        if (!sid) return navigate('/sport', { replace: true });
        setId(sid);
        void reload(sid);
      },
      (e: Error) => setError(e.message),
    );
  }, [navigate, reload]);

  /** Une écriture, puis la séance relue ; la synchro part quelques secondes après. */
  const act = useCallback(
    async <T,>(p: Promise<T>): Promise<T | undefined> => {
      try {
        const r = await p;
        if (id) await reload(id);
        syncSoon();
        return r;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return undefined;
      }
    },
    [id, reload],
  );

  const current = useMemo(() => doc?.items.find((i) => i.weId === open) ?? doc?.items.find((i) => !isDone(i)) ?? null, [doc, open]);

  if (error) return <Notice tone="bad">La séance n’a pas pu être lue : {error}</Notice>;
  if (!doc || !id) return <span className="t-small muted">Chargement de la séance…</span>;

  const all = doc.items.flatMap((i) => i.sets);
  const doneSets = all.filter((s) => s.completed);
  const tonnage = doc.items.reduce((t, i) => t + i.sets.reduce((u, s) => u + (s.completed && s.weight !== null && s.reps !== null ? (s.weight + (i.loadType === 'bodyweight' ? (doc.bodyweight ?? 0) : 0)) * s.reps : 0), 0), 0);
  const minutes = Math.floor((Date.now() - doc.startedAt) / 60_000);

  /** Après une série validée : le repos de la catégorie (ou du créneau), sauf au milieu d'un superset. */
  const afterComplete = (item: SessionItem, set: SessionSet) => {
    if (item.format.timer.kind !== 'rest') return;
    const index = doc.items.indexOf(item);
    const nextInGroup = item.group && doc.items[index + 1]?.group?.id === item.group.id;
    if (nextInGroup) return;
    const nextSet = item.sets.find((s) => !s.completed && s.id !== set.id);
    const nextItem = doc.items.slice(index + 1).find((i) => !isDone(i));
    const seconds = item.restSec ?? restSeconds(doc.rest, item.category, item.intention, set.setType);
    startRest(seconds, nextSet ? `série ${item.sets.indexOf(nextSet) + 1}` : (nextItem?.name ?? 'fin de séance'));
  };

  const complete = async (item: SessionItem, set: SessionSet, patch: SetPatch = {}) => {
    const r = await act(call('completeSet', set.id, patch));
    if (r === 'need-weight' || r === 'need-reps') return setEditing({ setId: set.id, field: r === 'need-weight' ? 'weight' : 'reps' });
    if (r === 'ok') {
      setEditing(null);
      afterComplete(item, set);
    }
  };

  const finish = async () => {
    await act(call('finishSession', id));
    skipRest();
    // La synchro part tout de suite à la fin d'une séance.
    void syncCloud();
    navigate('/sport', { replace: true });
  };

  const editItem = editing ? doc.items.find((i) => i.sets.some((s) => s.id === editing.setId)) : null;
  const editSet = editItem?.sets.find((s) => s.id === editing?.setId) ?? null;

  return (
    <div className="pf-screen tone-perf">
      <header style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="pf-head">
          <IconButton icon="back" label="Réduire la séance" href="/sport" />
          <div className="grow" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {doc.block && <span className="module-label">{`${doc.block.name} · S${doc.block.week}${doc.block.deload ? ' · décharge' : ''}`}</span>}
            <span className="t-card">{doc.name}</span>
          </div>
          <Button onClick={() => setEnding(true)}>Terminer</Button>
        </div>
        <div className="progress">
          <span style={{ width: `${all.length ? Math.round((doneSets.length / all.length) * 100) : 0}%` }} />
        </div>
        <div className="pf-stats">
          <span>{`${doc.items.filter(isDone).length} / ${doc.items.length} exercices`}</span>
          <span>{`${doneSets.length} / ${all.length} séries`}</span>
          {tonnage > 0 && <span>{`${Math.round(tonnage).toLocaleString('fr-FR')} kg`}</span>}
          <span className="grow" style={{ textAlign: 'right' }} title={awake ? 'Écran allumé' : undefined}>{`${minutes} min`}</span>
        </div>
      </header>

      {doc.items.filter((i) => isDone(i) && i !== current).length > 0 && (
        <List>
          {doc.items
            .filter((i) => isDone(i) && i !== current)
            .map((i) => (
              <ListRow key={i.weId} lead={<Icon name="check" size={18} />} title={i.name} value={i.sets.length === 1 ? '1 série' : `${i.sets.length} séries`} onClick={() => setOpen(i.weId)} />
            ))}
        </List>
      )}

      {current && (
        <ExerciseCard
          key={current.weId}
          doc={doc}
          item={current}
          editing={editing}
          onEdit={setEditing}
          onComplete={(set, patch) => void complete(current, set, patch)}
          onUncomplete={(set) => void act(call('uncompleteSet', set.id))}
          onAddSet={() => void act(call('addSet', current.weId))}
          onReplace={() => setReplacing(current)}
        />
      )}
      {doc.items.length === 0 && <Notice>Séance libre : ajoute un exercice.</Notice>}

      {doc.items.filter((i) => !isDone(i) && i !== current).length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="t-label muted" style={{ padding: '0 4px' }}>Ensuite</span>
          <List>
            {doc.items
              .filter((i) => !isDone(i) && i !== current)
              .map((i) => (
                <ListRow key={i.weId} title={i.name} detail={i.group ? `${i.group.kind === 'superset' ? 'superset' : 'circuit'} · ${i.group.rounds} tours` : undefined} value={summary(i)} onClick={() => setOpen(i.weId)} />
              ))}
          </List>
        </div>
      )}

      <Button variant={doc.items.length === 0 ? 'action' : 'quiet'} onClick={() => setReplacing({ ...(doc.items[0] ?? ({} as SessionItem)), weId: '' })}>
        Ajouter un exercice
      </Button>

      {editing && editItem && editSet ? (
        <Keypad
          doc={doc}
          item={editItem}
          set={editSet}
          field={editing.field}
          onField={(field) => setEditing({ setId: editSet.id, field })}
          onSave={(patch) => act(call('updateSet', editSet.id, patch))}
          onBodyweight={(v) => act(call('setBodyweight', id, v))}
          onComplete={(patch) => void complete(editItem, editSet, patch)}
          onClose={() => setEditing(null)}
        />
      ) : (
        <RestDock />
      )}

      <ReplaceSheet
        item={replacing}
        onClose={() => setReplacing(null)}
        onPick={async (exerciseId, scope) => {
          if (!replacing) return;
          if (replacing.weId) await act(call('replaceExercise', replacing.weId, exerciseId, scope));
          else await act(call('addExercise', id, exerciseId));
          setReplacing(null);
        }}
      />

      <Sheet open={ending} title="Terminer la séance" onClose={() => setEnding(false)}>
        <div className="stack">
          <span className="t-small muted">{`${doneSets.length} séries faites sur ${all.length}. Les séries saisies sans ✓ comptent ; celles pas touchées partent.`}</span>
          <Button variant="action" block onClick={() => void finish()}>
            Terminer
          </Button>
          <Button
            variant="danger"
            block
            onClick={async () => {
              await act(call('discardSession', id));
              skipRest();
              navigate('/sport', { replace: true });
            }}
          >
            Abandonner la séance
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function summary(i: SessionItem): string {
  const work = i.sets.filter((s) => s.setType !== 'warmup');
  if (!work.length) return '';
  if (i.format.timer.kind === 'countdown') return `${work.length} × ${i.format.timer.workSec} s`;
  if (i.format.timer.kind === 'interval') return `${Math.round(i.format.timer.totalSec / 60)} min`;
  if (i.format.timer.kind === 'cap') return `${Math.round(i.format.timer.capSec / 60)} min`;
  const reps = work[0]!.targetReps;
  const w = work[0]!.targetWeight;
  return `${work.length} × ${reps ?? '?'}${w !== null ? ` · ${kg(w, i.loadType === 'bodyweight')}` : ''}`;
}

// ---------------------------------------------------------------- carte d'exercice

interface CardProps {
  doc: SessionDoc;
  item: SessionItem;
  editing: Editing | null;
  onEdit: (e: Editing) => void;
  onComplete: (set: SessionSet, patch?: SetPatch) => void;
  onUncomplete: (set: SessionSet) => void;
  onAddSet: () => void;
  onReplace: () => void;
}

function ExerciseCard(p: CardProps) {
  const { item } = p;
  const [note, setNote] = useState(false);
  const weighted = item.loadType === 'bodyweight';
  const head = (
    <div className="pf-card-head">
      <div className="row">
        <h2 className="panel-title grow" style={{ fontSize: 21, lineHeight: '27px' }}>
          {item.name}
        </h2>
        {item.reference !== null && <Badge>{`1RM ${kg(item.reference, weighted)} kg`}</Badge>}
        {item.group && <Badge>{item.group.kind === 'superset' ? 'superset' : 'circuit'}</Badge>}
      </div>
      {item.replaces && <span className="t-small muted">{`à la place de ${item.replaces}`}</span>}
      {item.lastTime && <span className="t-small muted">{`Dernière fois : ${item.lastTime}`}</span>}
      {item.note && (
        <button type="button" className="pf-fold" aria-expanded={note} onClick={() => setNote(!note)}>
          <span className="grow" style={{ whiteSpace: note ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{`Note : ${item.note}`}</span>
        </button>
      )}
    </div>
  );
  const foot = (
    <div className="row" style={{ justifyContent: 'center', gap: 4, padding: '4px 8px 6px' }}>
      <Button variant="quiet" onClick={p.onAddSet}>
        + Série
      </Button>
      <Button variant="quiet" onClick={p.onReplace}>
        Remplacer
      </Button>
    </div>
  );
  if (item.format.scheme === 'interval') return <Glass className="pf-card">{head}<IntervalBlock {...p} />{foot}</Glass>;
  if (item.format.scheme === 'hold' || item.format.scheme === 'for_time') return <Glass className="pf-card">{head}<TimedBlock {...p} />{foot}</Glass>;
  if (item.format.scheme === 'amrap') return <Glass className="pf-card">{head}<AmrapBlock {...p} />{foot}</Glass>;

  const now = item.sets.find((s) => !s.completed) ?? null;
  let n = 0;
  return (
    <Glass className="pf-card">
      {head}
      {item.sets.map((s) => {
        const label = s.setType === 'top_set' ? 'T' : s.setType === 'warmup' ? 'É' : String(++n);
        const percent = item.percents ? (s.setType === 'top_set' ? item.percents.top : s.setType === 'backoff' ? item.percents.backoff : null) : null;
        const isNow = s === now;
        const focus = p.editing?.setId === s.id ? p.editing.field : null;
        const plates =
          isNow && item.equipment === 'barbell' && (s.weight ?? s.targetWeight) !== null
            ? (() => {
                const target = (s.weight ?? s.targetWeight)!;
                const load = barbellPlates(target, p.doc.barWeight, p.doc.plates);
                return load.plates.length ? `par côté : ${describePlates(load.plates)}` : null;
              })()
            : null;
        return (
          <div key={s.id}>
            <div className={`pf-cols pf-set${s.completed ? ' is-done' : ''}${isNow ? ' is-now' : ''}`}>
              <span className="pf-idx" style={isNow ? { color: 'var(--ink)' } : undefined}>
                {label}
              </span>
              <span className="pf-pc">{percent !== null ? pct(percent) : ''}</span>
              <button type="button" className={`pf-cell${focus === 'weight' ? ' is-focus' : ''}`} aria-label={`Charge${weighted ? ' (lest)' : ''}, série ${label}`} onClick={() => p.onEdit({ setId: s.id, field: 'weight' })}>
                {s.weight !== null ? kg(s.weight, weighted) : <span className="pf-ph">{kg(s.targetWeight, weighted)}</span>}
              </button>
              <button type="button" className={`pf-cell${focus === 'reps' ? ' is-focus' : ''}`} aria-label={`Répétitions, série ${label}`} onClick={() => p.onEdit({ setId: s.id, field: 'reps' })}>
                {s.reps !== null ? s.reps : <span className="pf-ph">{s.targetReps ?? '—'}</span>}
              </button>
              <button
                type="button"
                className={`pf-ck${s.completed ? ' is-done' : isNow ? ' is-go' : ''}`}
                aria-label={s.completed ? `Série ${label} faite : annuler` : `Valider la série ${label}`}
                onClick={() => (s.completed ? p.onUncomplete(s) : p.onComplete(s))}
              >
                {(s.completed || isNow) && <Icon name="check" size={isNow ? 24 : 18} strong />}
              </button>
            </div>
            {plates && <div className="pf-plates">{plates}</div>}
          </div>
        );
      })}
      {foot}
    </Glass>
  );
}

/** EMOM : un top au début de chaque minute ; chaque minute est une série (reps à corriger d'un toucher). */
function IntervalBlock(p: CardProps) {
  const { item } = p;
  const t = item.format.timer.kind === 'interval' ? item.format.timer : { everySec: 60, totalSec: 600 };
  const { startedAt, now, start, stop } = useClock(item.weId);
  const elapsed = startedAt ? Math.floor((now - startedAt) / 1000) : 0;
  const minute = Math.min(item.sets.length - 1, Math.floor(elapsed / t.everySec));
  const left = t.everySec - (elapsed % t.everySec);
  const finished = startedAt !== null && elapsed >= t.everySec * item.sets.length;
  // Les minutes écoulées sont validées comme prévues (sauf correction) ; un bip à chaque nouvelle minute.
  useEffect(() => {
    if (!startedAt) return;
    const passed = item.sets.slice(0, finished ? item.sets.length : minute).filter((s) => !s.completed);
    if (passed.length) {
      signal();
      for (const s of passed) p.onComplete(s, {});
    }
    if (finished) stop();
  }, [minute, finished]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = 43;
  const dash = 2 * Math.PI * r;
  return (
    <div className="stack" style={{ alignItems: 'center', padding: '4px 16px 8px', gap: 16 }}>
      <svg viewBox="0 0 100 100" width="170" height="170" role="img" aria-label={startedAt ? `Minute ${minute + 1} sur ${item.sets.length}, ${left} secondes` : 'EMOM pas commencé'}>
        <defs>
          <linearGradient id={`ac-${item.weId}`} x1="0" x2="1">
            <stop offset="0" stopColor="#7b5cff" />
            <stop offset="1" stopColor="#38c6f4" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={`url(#ac-${item.weId})`} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${startedAt ? (dash * left) / t.everySec : dash} ${dash}`} transform="rotate(-90 50 50)" />
        <text x="50" y="54" textAnchor="middle" fontFamily="var(--font-display)" fontWeight="800" fontSize="25" fill="var(--ink)">
          {startedAt ? clock(left) : clock(t.everySec)}
        </text>
        <text x="50" y="69" textAnchor="middle" fontSize="8.5" fill="var(--ink-2)">
          {`minute ${startedAt ? minute + 1 : 1} / ${item.sets.length}`}
        </text>
      </svg>
      <div className="pf-minutes">
        {item.sets.map((s, i) => (
          <button key={s.id} type="button" className={`pf-minute${s.completed ? ' is-done' : startedAt && i === minute ? ' is-now' : ''}`} aria-label={`Minute ${i + 1}, ${s.reps ?? s.targetReps ?? 0} reps`} onClick={() => p.onEdit({ setId: s.id, field: 'reps' })}>
            {s.completed || (startedAt && i <= minute) ? (s.reps ?? s.targetReps ?? '·') : '·'}
          </button>
        ))}
      </div>
      {startedAt ? (
        <Button onClick={stop}>Arrêter</Button>
      ) : (
        <Button variant="action" onClick={start}>
          Démarrer
        </Button>
      )}
    </div>
  );
}

/** Au temps (gainage : décompte) ou pour le temps (chrono) : le temps tenu est noté tel quel. */
function TimedBlock(p: CardProps) {
  const { item } = p;
  const now = item.sets.find((s) => !s.completed) ?? null;
  const target = item.format.timer.kind === 'countdown' ? item.format.timer.workSec : null;
  const { startedAt, now: tick, start, stop } = useClock(now ? `${item.weId}:${now.id}` : null);
  const elapsed = startedAt ? Math.floor((tick - startedAt) / 1000) : 0;
  useEffect(() => {
    if (target !== null && startedAt && elapsed === target) signal();
  }, [elapsed, target, startedAt]);
  const done = () => {
    if (!now) return;
    p.onComplete(now, { durationS: elapsed });
    stop();
  };
  return (
    <div className="stack" style={{ padding: '0 16px 8px', gap: 14 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {item.sets.map((s, i) => (
          <Badge key={s.id} tone={s.completed ? 'ok' : 'neutral'}>
            {s.completed ? `${i + 1} · ${s.durationS ?? 0} s` : `${i + 1} · ${target !== null ? `${target} s` : 'à faire'}`}
          </Badge>
        ))}
      </div>
      {now && (
        <div className="row">
          <span className="grow pf-big" style={{ fontSize: 44 }}>
            {clock(target !== null ? (startedAt ? Math.max(0, target - elapsed) : target) : elapsed)}
          </span>
          {startedAt ? (
            <Button variant="action" onClick={done}>
              {target !== null && elapsed < target ? 'Arrêter' : 'Noter'}
            </Button>
          ) : (
            <Button variant="action" onClick={start}>
              Démarrer
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** AMRAP : un temps limite, on compte les tours. */
function AmrapBlock(p: CardProps) {
  const { item } = p;
  const set = item.sets.find((s) => !s.completed) ?? item.sets[0] ?? null;
  const cap = item.format.timer.kind === 'cap' ? item.format.timer.capSec : 480;
  const { startedAt, now, start, stop } = useClock(item.weId);
  const [rounds, setRounds] = useState(set?.rounds ?? 0);
  const left = startedAt ? Math.max(0, cap - Math.floor((now - startedAt) / 1000)) : cap;
  useEffect(() => {
    if (startedAt && left === 0 && set && !set.completed) {
      signal();
      p.onComplete(set, { rounds });
      stop();
    }
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!set) return null;
  return (
    <div className="stack" style={{ padding: '0 16px 8px', gap: 14 }}>
      <div className="row">
        <span className="grow pf-big" style={{ fontSize: 44 }}>
          {clock(left)}
        </span>
        <span className="pf-big" style={{ fontSize: 30 }}>{`${set.completed ? (set.rounds ?? 0) : rounds} tours`}</span>
      </div>
      {!set.completed && (
        <div className="row">
          {startedAt ? (
            <Button variant="action" block onClick={() => setRounds(rounds + 1)}>
              + 1 tour
            </Button>
          ) : (
            <Button variant="action" block onClick={start}>
              Démarrer
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- repos et clavier

function RestDock() {
  const { rest, left } = useRest();
  if (!rest) return null;
  return (
    <Glass className="pf-dock">
      <div className="row" style={{ gap: 6 }}>
        <span className="grow" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span className="t-label muted pf-nowrap">{`Repos · puis ${rest.next}`}</span>
          <span className="pf-nowrap">
            <span className="pf-big" style={{ fontSize: 28 }}>
              {clock(left)}
            </span>
            <span className="t-small muted">{` / ${clock(rest.total)}`}</span>
          </span>
        </span>
        <Button onClick={() => adjustRest(-15)}>−15</Button>
        <Button onClick={() => adjustRest(30)}>+30</Button>
        <Button onClick={skipRest}>Passer</Button>
      </div>
      <div className="progress">
        <span style={{ width: `${Math.round(((rest.total - left) / rest.total) * 100)}%` }} />
      </div>
    </Glass>
  );
}

interface KeypadProps {
  doc: SessionDoc;
  item: SessionItem;
  set: SessionSet;
  field: Field;
  onField: (f: Field) => void;
  onSave: (patch: SetPatch) => Promise<unknown>;
  onBodyweight: (v: number | null) => Promise<unknown>;
  onComplete: (patch: SetPatch) => void;
  onClose: () => void;
}

const parse = (s: string): number | null => {
  const n = Number(s.replace(',', '.'));
  return s.trim() === '' || !Number.isFinite(n) ? null : n;
};
const show = (v: number | null) => (v === null ? '' : String(v).replace('.', ','));

function Keypad({ doc, item, set, field, onField, onSave, onBodyweight, onComplete, onClose }: KeypadProps) {
  const weighted = item.loadType === 'bodyweight';
  const initial = field === 'weight' ? (set.weight ?? set.targetWeight) : field === 'reps' ? (set.reps ?? set.targetReps) : doc.bodyweight;
  const [buffer, setBuffer] = useState(show(initial));
  const [fresh, setFresh] = useState(true);
  const { rest, left } = useRest();
  useEffect(() => {
    setBuffer(show(field === 'weight' ? (set.weight ?? set.targetWeight) : field === 'reps' ? (set.reps ?? set.targetReps) : doc.bodyweight));
    setFresh(true);
  }, [field, set.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = async () => {
    const v = parse(buffer);
    if (field === 'bw') return onBodyweight(v);
    return onSave(field === 'weight' ? { weight: v } : { reps: v === null ? null : Math.round(v) });
  };
  const type = (k: string) => {
    if (k === '⌫') return setBuffer(buffer.slice(0, -1));
    if (k === ',' && (buffer.includes(',') || field === 'reps')) return;
    setBuffer(fresh ? (k === ',' ? '0,' : k) : buffer + k);
    setFresh(false);
  };
  const step = (delta: number) => {
    const v = parse(buffer) ?? 0;
    const unit = field === 'reps' ? Math.sign(delta) : delta;
    setBuffer(show(Math.max(0, Math.round((v + unit) * 100) / 100)));
    setFresh(false);
  };
  const switchTo = async (f: Field) => {
    await commit();
    onField(f);
  };
  const validate = () => {
    const v = parse(buffer);
    if (field === 'bw') return void commit().then(() => onField('weight'));
    onComplete(field === 'weight' ? { weight: v } : { reps: v === null ? null : Math.round(v) });
  };
  const label = field === 'weight' ? (weighted ? 'Lest' : 'Charge') : field === 'reps' ? 'Reps' : 'Poids du corps';

  return (
    <div className="sheet pf-keypad" role="dialog" aria-label="Saisie de la série">
      {rest && (
        <div className="row t-small" style={{ gap: 4 }}>
          <span className="grow muted">
            Repos <b className="display" style={{ fontSize: 17, color: 'var(--ink)' }}>{clock(left)}</b>
          </span>
          <Button variant="quiet" onClick={skipRest}>
            Passer
          </Button>
        </div>
      )}
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <span className="grow">
          <span className="t-label muted">{label}</span>
          <br />
          <span className="pf-big" style={{ fontSize: 36 }}>
            {field === 'weight' && weighted && parse(buffer) !== null && (parse(buffer) ?? 0) > 0 ? '+' : ''}
            {buffer || '0'}
            {field !== 'reps' && <span style={{ fontSize: 18 }}> kg</span>}
          </span>
        </span>
        {weighted && field !== 'bw' && (
          <Button onClick={() => void switchTo('bw')}>{`PDC ${show(doc.bodyweight) || '—'} kg`}</Button>
        )}
        <button type="button" className="tile icon-btn" aria-label="Fermer le clavier" onClick={() => void commit().then(onClose)}>
          <Icon name="close" size={18} />
        </button>
      </div>
      {field !== 'bw' && item.format.metrics.includes('load') && (
        <div className="row" style={{ gap: 10 }}>
          <span className="t-small muted">Vitesse</span>
          <div className="grow">
            <Segmented
              label="Vitesse de barre, de 1 à 5 (facultatif)"
              value={set.speed === null ? '' : String(set.speed)}
              options={['1', '2', '3', '4', '5'].map((v) => ({ id: v, label: v }))}
              onChange={(v) => void onSave({ speed: set.speed === Number(v) ? null : Number(v) })}
            />
          </div>
        </div>
      )}
      <div className="pf-keys">
        {['1', '2', '3'].map((k) => (
          <button key={k} type="button" className="btn btn-secondary pf-key" onClick={() => type(k)}>
            {k}
          </button>
        ))}
        <button type="button" className="btn btn-secondary pf-key is-alt" onClick={() => step(-(field === 'weight' ? item.increment : 1))}>
          {field === 'weight' ? `−${show(item.increment)}` : '−1'}
        </button>
        {['4', '5', '6'].map((k) => (
          <button key={k} type="button" className="btn btn-secondary pf-key" onClick={() => type(k)}>
            {k}
          </button>
        ))}
        <button type="button" className="btn btn-secondary pf-key is-alt" onClick={() => step(field === 'weight' ? item.increment : 1)}>
          {field === 'weight' ? `+${show(item.increment)}` : '+1'}
        </button>
        {['7', '8', '9'].map((k) => (
          <button key={k} type="button" className="btn btn-secondary pf-key" onClick={() => type(k)}>
            {k}
          </button>
        ))}
        <button type="button" className="btn btn-secondary pf-key is-alt" onClick={() => void switchTo(field === 'weight' ? 'reps' : 'weight')}>
          {field === 'weight' ? 'Reps →' : '← Charge'}
        </button>
        <button type="button" className="btn btn-secondary pf-key" onClick={() => type(',')}>
          ,
        </button>
        <button type="button" className="btn btn-secondary pf-key" onClick={() => type('0')}>
          0
        </button>
        <button type="button" className="btn btn-secondary pf-key is-alt" aria-label="Effacer" onClick={() => type('⌫')}>
          ⌫
        </button>
        <button type="button" className="btn btn-action pf-key" aria-label={field === 'bw' ? 'Enregistrer le poids du corps' : 'Valider la série'} onClick={validate}>
          <Icon name="check" size={24} strong />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- remplacer ou ajouter

function ReplaceSheet({ item, onClose, onPick }: { item: SessionItem | null; onClose: () => void; onPick: (exerciseId: string, scope: 'today' | 'program') => Promise<void> }) {
  const [choices, setChoices] = useState<{ id: string; name: string; detail: string }[]>([]);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [scope, setScope] = useState<'today' | 'program'>('today');
  const adding = item !== null && !item.weId;
  useEffect(() => {
    if (!item) return;
    setQ('');
    setPicked(null);
    setScope('today');
    void call('exerciseChoices', adding ? null : item.exerciseId).then(setChoices);
  }, [item, adding]);
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const shown = (q ? choices.filter((c) => norm(c.name).includes(norm(q))) : choices).slice(0, 8);
  return (
    <Sheet open={item !== null} title={adding ? 'Ajouter un exercice' : `Remplacer ${item?.name.toLowerCase() ?? ''}`} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <input className="input" aria-label="Chercher un exercice" placeholder="Chercher un exercice" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="stack-0">
          {shown.map((c) => (
            <button key={c.id} type="button" className="pf-pick" aria-pressed={picked === c.id} onClick={() => setPicked(c.id)}>
              <span className="grow">
                {c.name}
                {c.detail && (
                  <>
                    <br />
                    <span className="t-small muted">{c.detail}</span>
                  </>
                )}
              </span>
              {picked === c.id && <Icon name="check" size={20} />}
            </button>
          ))}
        </div>
        {!adding && (
          <div className="stack" style={{ gap: 8 }}>
            <span className="t-label muted">Pour quand ?</span>
            <Segmented
              label="Pour quand"
              value={scope}
              options={[
                { id: 'today', label: 'Uniquement aujourd’hui' },
                { id: 'program', label: 'Le programme' },
              ]}
              onChange={setScope}
            />
            <span className="t-small muted">{scope === 'today' ? 'Le programme ne change pas ; chaque exercice garde sa progression.' : 'La séance type prend cet exercice dès la prochaine fois.'}</span>
          </div>
        )}
        <Button variant="action" block disabled={!picked} onClick={() => picked && void onPick(picked, scope)}>
          {adding ? 'Ajouter' : 'Remplacer'}
        </Button>
      </div>
    </Sheet>
  );
}
