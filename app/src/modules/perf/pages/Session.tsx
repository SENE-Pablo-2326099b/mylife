import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Glass, Icon, IconButton, List, ListRow, Notice, Segmented, Sheet } from '@mylife/kit';
import { barbellPlates, describePlates, restSeconds } from '@mylife/training';
import { call } from '../data/client';
import { syncCloud, syncSoon } from '../data/cloud';
import type { Backend } from '../data/backend';
import type { SessionDoc, SessionItem, SessionSet } from '../data/session';

type SetPatch = NonNullable<Parameters<Backend['completeSet']>[1]>;
import { adjustRest, signal, skipRest, startRest, useClock, useRest, useWakeLock } from '../session/timers';
import { StorageWarning } from './common';
import '../perf.css';

/**
 * La séance en salle (maquettes V3-Seance, V3-Clavier, V3-Formats, V3-Remplacer, validées le 22/11). Une seule chose
 * domine : l'exercice en cours, la série en cours teintée. En bas, toujours à portée de pouce : le repos en bandeau,
 * « Remplacer » et « Valider 115 × 5 ». Le clavier ne s'ouvre qu'en touchant une case. Chaque série est écrite dans la
 * base avant que l'écran avance ; fermer l'app en plein milieu ne perd rien (la séance se relit depuis la base).
 */
const kg = (v: number | null, weighted: boolean) => (v === null ? '—' : `${weighted && v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`);
const pct = (v: number) => `${Math.round(v * 1000) / 10} %`.replace('.', ',');
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;
const elapsedClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  return h ? `${h}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : clock(s);
};
const isDone = (i: SessionItem) => i.sets.length > 0 && i.sets.every((s) => s.completed);
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

type Field = 'weight' | 'reps' | 'bw';
interface Editing {
  setId: string;
  field: Field;
}

/** Ordinateur (au moins 1000 px) : le panneau de repos à droite remplace le bandeau du bas. */
function useWide(): boolean {
  const query = '(min-width: 1000px)';
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/** L'heure qui avance, à la seconde (le chrono de la séance). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Les exercices d'un même superset ou circuit, et leurs séries tour par tour (A1, A2, A1, A2…). */
function groupOf(doc: SessionDoc, item: SessionItem): SessionItem[] {
  return item.group ? doc.items.filter((i) => i.group?.id === item.group!.id) : [item];
}
function rounds(items: readonly SessionItem[]): { item: SessionItem; set: SessionSet; tag: string; round: number }[] {
  const max = Math.max(0, ...items.map((i) => i.sets.length));
  const out: { item: SessionItem; set: SessionSet; tag: string; round: number }[] = [];
  for (let r = 0; r < max; r++) items.forEach((item, k) => item.sets[r] && out.push({ item, set: item.sets[r]!, tag: `A${k + 1}`, round: r }));
  return out;
}

export function SessionPage() {
  const navigate = useNavigate();
  const [id, setId] = useState<string | null>(null);
  const [doc, setDoc] = useState<SessionDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [replacing, setReplacing] = useState<SessionItem | null>(null);
  const [more, setMore] = useState<SessionItem | null>(null);
  const [setMenu, setSetMenu] = useState<{ item: SessionItem; set: SessionSet; label: string } | null>(null);
  const [ending, setEnding] = useState(false);
  const awake = useWakeLock(doc?.status === 'active');
  const now = useNow();
  const wide = useWide();

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
  // Un exercice ouvert depuis la liste : une fois toutes ses séries faites, on revient au suivant à faire.
  const openWasDone = useRef<boolean | null>(null);
  useEffect(() => {
    const item = doc?.items.find((i) => i.weId === open);
    if (!item) return void (openWasDone.current = null);
    const done = isDone(item);
    if (openWasDone.current === false && done) setOpen(null);
    else openWasDone.current = done;
  }, [doc, open]);
  // Au clavier (ordinateur), clavier de saisie fermé : un chiffre ouvre la saisie de la série en cours, Entrée la valide.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  const [seed, setSeed] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Le clavier couvre le bas de l'écran : la série qu'on saisit remonte au-dessus.
  const editingId = editing?.setId ?? null;
  useEffect(() => {
    if (!editingId) return;
    const row = document.querySelector<HTMLElement>(`[data-set="${editingId}"]`);
    if (!row) return;
    const top = row.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, top - 140), behavior: 'smooth' });
  }, [editingId]);

  if (error) return <Notice tone="bad">La séance n’a pas pu être lue : {error}</Notice>;
  if (!doc || !id) return <span className="t-small muted">Chargement de la séance…</span>;

  const all = doc.items.flatMap((i) => i.sets);
  const doneSets = all.filter((s) => s.completed);
  const tonnage = doc.items.reduce((t, i) => t + i.sets.reduce((u, s) => u + (s.completed && s.weight !== null && s.reps !== null ? (s.weight + (i.loadType === 'bodyweight' ? (doc.bodyweight ?? 0) : 0)) * s.reps : 0), 0), 0);
  const group = current ? groupOf(doc, current) : [];
  const others = doc.items.filter((i) => !group.includes(i));

  /** Après une série validée : le repos de la catégorie (ou du créneau), sauf au milieu d'un tour de superset. */
  const afterComplete = (item: SessionItem, set: SessionSet) => {
    if (item.format.timer.kind !== 'rest') return;
    const members = groupOf(doc, item);
    if (item.group && members.indexOf(item) < members.length - 1) return;
    const order = item.group ? rounds(members) : item.sets.map((s) => ({ item, set: s, tag: '', round: 0 }));
    const nextRow = order.find((r) => !r.set.completed && r.set.id !== set.id);
    const nextItem = doc.items.slice(doc.items.indexOf(item) + 1).find((i) => !isDone(i) && !members.includes(i));
    // Plus rien après : pas de repos « avant la fin ».
    if (!nextRow && !nextItem) return skipRest();
    const seconds = item.restSec ?? restSeconds(doc.rest, item.category, item.intention, set.setType);
    const numbered = item.sets.filter((s) => s.setType !== 'warmup' && s.setType !== 'top_set');
    const k = nextRow ? numbered.indexOf(nextRow.set) : -1;
    const label = nextRow
      ? item.group
        ? `le tour ${nextRow.round + 1}`
        : k >= 0
          ? `la série ${k + 1}`
          : nextRow.set.setType === 'top_set'
            ? 'le top set'
            : 'la série suivante'
      : nextItem
        ? nextItem.name
        : 'la fin de séance';
    startRest(seconds, label);
  };

  const complete = async (item: SessionItem, set: SessionSet, patch: SetPatch = {}) => {
    // Une série déjà faite qu'on corrige : on enregistre, sans relancer le repos.
    if (set.completed) {
      if (Object.keys(patch).length) await act(call('updateSet', set.id, patch));
      return setEditing(null);
    }
    const r = await act(call('completeSet', set.id, patch));
    if (r === 'need-weight' || r === 'need-reps') return setEditing({ setId: set.id, field: r === 'need-weight' ? 'weight' : 'reps' });
    if (r === 'ok') {
      setEditing(null);
      try {
        navigator.vibrate?.(12);
      } catch {
        /* pas de vibreur */
      }
      afterComplete(item, set);
    }
  };

  const finish = async () => {
    await act(call('finishSession', id));
    skipRest();
    // La synchro part tout de suite à la fin d'une séance.
    void syncCloud();
    navigate(`/sport/bilan/${id}`, { replace: true });
  };

  const editItem = editing ? doc.items.find((i) => i.sets.some((s) => s.id === editing.setId)) : null;
  const editSet = editItem?.sets.find((s) => s.id === editing?.setId) ?? null;

  // La prochaine série à valider d'un toucher (exercices en séries seulement ; un tour de superset dans l'ordre).
  const setsScheme = current?.format.scheme === 'sets';
  const nextRow = current && setsScheme ? (current.group ? rounds(group) : current.sets.map((set) => ({ item: current, set, tag: '', round: 0 }))).find((r) => !r.set.completed) : undefined;
  const validateLabel = nextRow
    ? (() => {
        const w = nextRow.set.weight ?? nextRow.set.targetWeight;
        const reps = nextRow.set.reps ?? nextRow.set.targetReps;
        if (w === null && nextRow.item.format.metrics.includes('load')) return 'Valider la série';
        return `Valider ${w !== null ? `${kg(w, nextRow.item.loadType === 'bodyweight')} × ` : ''}${reps ?? '?'}`;
      })()
    : null;
  const allDone = doc.items.length > 0 && doc.items.every(isDone);
  keys.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (editing || e.metaKey || e.ctrlKey || e.altKey || (t && (t.closest('input, textarea, select, [role="dialog"]') || t.isContentEditable))) return;
    if (/^[0-9]$/.test(e.key) && nextRow) {
      e.preventDefault();
      setSeed(e.key);
      setEditing({ setId: nextRow.set.id, field: nextRow.item.format.metrics.includes('load') ? 'weight' : 'reps' });
    } else if (e.key === 'Enter' && nextRow && !(t && t.closest('button, a'))) {
      e.preventDefault();
      void complete(nextRow.item, nextRow.set);
    }
  };
  const blockLabel = doc.block ? ` · ${doc.block.name} S${doc.block.week}${doc.block.deload ? ' · décharge' : ''}` : '';

  const keypad =
    editing && editItem && editSet ? (
        <Keypad
          doc={doc}
          item={editItem}
          set={editSet}
          field={editing.field}
          onField={(field) => setEditing({ setId: editSet.id, field })}
          onSave={(patch) => act(call('updateSet', editSet.id, patch))}
          onBodyweight={(v) => act(call('setBodyweight', id, v))}
          onComplete={(patch) => void complete(editItem, editSet, patch)}
          onClose={() => {
            setEditing(null);
            setSeed(null);
          }}
          docked={wide}
          seed={seed}
          onSeeded={() => setSeed(null)}
        />
    ) : null;

  return (
    <div className="pf-screen tone-perf pf-session" style={editing && !wide ? { paddingBottom: 560 } : undefined}>
      <div className="pf-amb" aria-hidden="true" />
      <StorageWarning />
      <div className="pf-sgrid">
      <div className="pf-smain">
      <header style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="pf-head">
          <IconButton icon="back" label="Réduire la séance" href="/sport" />
          <div className="grow" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span className="pf-kick pf-nowrap">{`${doc.name}${blockLabel}`}</span>
            <span className="pf-big" style={{ fontSize: 30 }} aria-label="Durée de la séance">
              {elapsedClock(now - doc.startedAt)}
            </span>
          </div>
          {wide && (
          <div className="pf-desk">
            {current && !allDone && <Button onClick={() => setReplacing(current)}>Remplacer</Button>}
            {allDone ? (
              <Button variant="action" onClick={() => setEnding(true)}>
                Terminer la séance
              </Button>
            ) : (
              nextRow &&
              validateLabel && (
                <Button variant="action" onClick={() => void complete(nextRow.item, nextRow.set)}>
                  {validateLabel}
                </Button>
              )
            )}
          </div>
          )}
          <Button onClick={() => setEnding(true)}>Terminer</Button>
        </div>
        <div className="progress">
          <span style={{ width: `${all.length ? Math.round((doneSets.length / all.length) * 100) : 0}%`, background: 'var(--tone-grad)' }} />
        </div>
        <div className="row" style={{ gap: 8 }}>
        <span className="t-small muted grow">
          {[`${doc.items.filter(isDone).length} exercice${doc.items.filter(isDone).length > 1 ? 's' : ''} sur ${doc.items.length}`, `${doneSets.length} série${doneSets.length > 1 ? 's' : ''} sur ${all.length}`, tonnage > 0 ? `${Math.round(tonnage).toLocaleString('fr-FR')} kg` : ''].filter(Boolean).join(' · ')}
        </span>
          {awake && <span className="pf-chip">Écran allumé</span>}
        </div>
      </header>

      {current && current.group && group.length > 1 ? (
        <GroupCard
          key={current.group.id}
          doc={doc}
          items={group}
          editing={editing}
          onEdit={setEditing}
          onComplete={(item, set, patch) => void complete(item, set, patch)}
          onUncomplete={(set) => void act(call('uncompleteSet', set.id))}
          onMore={() => setMore(current)}
          onAddRound={() => void Promise.all(group.map((i) => call('addSet', i.weId))).then(() => act(Promise.resolve()))}
          onSetMenu={(item, set, label) => setSetMenu({ item, set, label })}
        />
      ) : (
        current && (
          <ExerciseCard
            key={current.weId}
            doc={doc}
            item={current}
            editing={editing}
            onEdit={setEditing}
            onComplete={(set, patch) => void complete(current, set, patch)}
            onUncomplete={(set) => void act(call('uncompleteSet', set.id))}
            onAddSet={() => void act(call('addSet', current.weId))}
            onMore={() => setMore(current)}
            onSetMenu={(set, label) => setSetMenu({ item: current, set, label })}
          />
        )
      )}
      {doc.items.length === 0 && <Notice>Séance libre : ajoute un exercice.</Notice>}

      {others.length > 0 && (
        <List>
          {others.map((i) => (
            <ListRow
              key={i.weId}
              lead={isDone(i) ? <span className="pf-chip is-ok">fait</span> : <span className="pf-chip is-neutral">à venir</span>}
              title={<span className="t-strong">{i.name}</span>}
              detail={i.group ? `${i.group.kind === 'superset' ? 'superset' : 'circuit'} · ${plural(i.group.rounds, 'tour')}` : undefined}
              value={isDone(i) ? plural(i.sets.length, 'série') : summary(i)}
              onClick={() => setOpen(i.weId)}
            />
          ))}
        </List>
      )}

      <Button variant={doc.items.length === 0 ? 'action' : 'quiet'} onClick={() => setReplacing({ ...(doc.items[0] ?? ({} as SessionItem)), weId: '' })}>
        Ajouter un exercice
      </Button>
      </div>
      {wide && (
      <aside className="pf-saside" aria-label="Repos et repères">
        {keypad ?? <RestBanner big />}
        {current && (current.lastTime || current.lastComment) && (
          <Glass className="pf-sidecard">
            <span className="t-label muted">Dernière fois</span>
            {current.lastTime && <span className="t-small">{current.lastTime}</span>}
            {current.lastComment && <span className="t-small muted">{`« ${current.lastComment} »`}</span>}
          </Glass>
        )}
        {current && (current.note || current.comment) && (
          <Glass className="pf-sidecard">
            <span className="t-label muted">Notes</span>
            {current.note && <span className="t-small">{current.note}</span>}
            {current.comment && <span className="t-small c-tone">{current.comment}</span>}
          </Glass>
        )}
        <span className="t-small muted" style={{ padding: '0 4px' }}>
          Clavier : chiffres pour saisir, Entrée pour valider, flèches pour changer de case, Échap pour fermer.
        </span>
      </aside>
      )}
      </div>

      {keypad && !wide ? (
        keypad
      ) : wide ? null : (
        <div className="pf-dock">
          <RestBanner />
          {(validateLabel || allDone || current) && (
            <div className="row" style={{ gap: 8 }}>
              {current && !allDone && <Button onClick={() => setReplacing(current)}>Remplacer</Button>}
              <div className="grow">
                {allDone ? (
                  <Button variant="action" block onClick={() => setEnding(true)}>
                    Terminer la séance
                  </Button>
                ) : (
                  nextRow &&
                  validateLabel && (
                    <Button variant="action" block onClick={() => void complete(nextRow.item, nextRow.set)}>
                      {validateLabel}
                    </Button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <ExerciseSheet
        item={more}
        onClose={() => setMore(null)}
        onComment={async (text) => {
          if (more) await act(call('exerciseComment', more.weId, text));
          setMore(null);
        }}
        onReplace={() => {
          setReplacing(more);
          setMore(null);
        }}
        onAddSet={() => {
          if (more) void act(call('addSet', more.weId));
          setMore(null);
        }}
      />

      <SetSheet
        menu={setMenu}
        onClose={() => setSetMenu(null)}
        onType={async (type) => {
          if (setMenu) await act(call('setSetType', setMenu.set.id, type));
          setSetMenu(null);
        }}
        onNote={async (note) => {
          if (setMenu) await act(call('updateSet', setMenu.set.id, { note }));
          setSetMenu(null);
        }}
        onRemove={async () => {
          if (setMenu) await act(call('removeSet', setMenu.set.id));
          setSetMenu(null);
        }}
      />

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
  if (i.format.timer.kind === 'interval') return `EMOM ${Math.round(i.format.timer.totalSec / 60)} min`;
  if (i.format.timer.kind === 'cap') return `${Math.round(i.format.timer.capSec / 60)} min`;
  const reps = work[0]!.targetReps;
  const w = work[0]!.targetWeight;
  return `${w !== null ? `${kg(w, i.loadType === 'bodyweight')} × ` : `${work.length} × `}${reps ?? '?'}`;
}

/** Les disques par côté de la série en cours (barre seulement). */
function platesOf(doc: SessionDoc, item: SessionItem, set: SessionSet | null): string | null {
  if (!set || item.equipment !== 'barbell') return null;
  const target = set.weight ?? set.targetWeight;
  if (target === null) return null;
  const load = barbellPlates(target, doc.barWeight, doc.plates);
  return load.plates.length ? `Disques par côté : ${describePlates(load.plates)} · barre ${kg(doc.barWeight, false)} kg` : null;
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
  onMore: () => void;
  onSetMenu: (set: SessionSet, label: string) => void;
}

function CardHead({ item, doc, chip, onMore }: { item: SessionItem; doc: SessionDoc; chip?: string; onMore: () => void }) {
  const weighted = item.loadType === 'bodyweight';
  const firstWork = item.sets.find((s) => !s.completed) ?? item.sets[0];
  const rest = item.format.timer.kind === 'rest' ? (item.restSec ?? restSeconds(doc.rest, item.category, item.intention, firstWork?.setType ?? 'working')) : null;
  const facts = [item.reference !== null ? `1RM de référence ${kg(item.reference, weighted)} kg` : '', rest ? `repos ${rest % 60 ? clock(rest) : `${rest / 60} min`}` : ''].filter(Boolean).join(' · ');
  const last = [item.lastTime ? `Dernière fois : ${item.lastTime}` : '', item.lastComment ? `« ${item.lastComment} »` : ''].filter(Boolean).join(' · ');
  return (
    <div className="pf-card-head">
      <div className="row">
        <h2 className="grow pf-big" style={{ fontSize: 22, margin: 0 }}>
          {item.name}
        </h2>
        {chip && <span className="pf-chip">{chip}</span>}
        <button type="button" className="pf-more" aria-label={`Plus d’actions : ${item.name}`} onClick={onMore}>
          ···
        </button>
      </div>
      {item.replaces && <span className="t-small muted">{`à la place de ${item.replaces}`}</span>}
      {facts && <span className="t-small muted">{facts}</span>}
      {last && <span className="t-small muted">{last}</span>}
      {item.note && <span className="t-small muted">{`Consigne : ${item.note}`}</span>}
      {item.comment && (
        <button type="button" className="pf-comment" onClick={onMore}>
          {`Ton commentaire : ${item.comment}`}
        </button>
      )}
    </div>
  );
}

function ExerciseCard(p: CardProps) {
  const { item } = p;
  const weighted = item.loadType === 'bodyweight';
  const interval = item.format.timer.kind === 'interval' ? item.format.timer : null;
  if (item.format.scheme === 'interval')
    return (
      <div className="card-module pf-card">
        <CardHead item={item} doc={p.doc} chip={`${item.sets[0]?.targetReps ?? '?'} reps / min`} onMore={p.onMore} />
        <IntervalBlock {...p} label={interval ? `EMOM ${Math.round(interval.totalSec / 60)} min` : 'EMOM'} />
      </div>
    );
  if (item.format.scheme === 'hold' || item.format.scheme === 'for_time')
    return (
      <div className="card-module pf-card">
        <CardHead item={item} doc={p.doc} chip={item.format.scheme === 'hold' ? 'au temps' : 'pour le temps'} onMore={p.onMore} />
        <TimedBlock {...p} />
      </div>
    );
  if (item.format.scheme === 'amrap')
    return (
      <div className="card-module pf-card">
        <CardHead item={item} doc={p.doc} chip="AMRAP" onMore={p.onMore} />
        <AmrapBlock {...p} />
      </div>
    );

  const now = item.sets.find((s) => !s.completed) ?? null;
  const plates = platesOf(p.doc, item, now);
  let n = 0;
  return (
    <div className="card-module pf-card">
      <CardHead item={item} doc={p.doc} onMore={p.onMore} />
      <div className="pf-cols pf-colhead" aria-hidden="true">
        <span>série</span>
        <span>{item.percents ? 'plan' : ''}</span>
        <span>{weighted ? 'lest' : 'kg'}</span>
        <span>reps</span>
        <span />
      </div>
      {item.sets.map((s) => {
        const label = s.setType === 'top_set' ? 'T' : s.setType === 'warmup' ? 'É' : s.setType === 'drop' ? 'D' : String(++n);
        const percent = item.percents ? (s.setType === 'top_set' ? item.percents.top : s.setType === 'backoff' ? item.percents.backoff : null) : null;
        const isNow = s === now;
        const focus = p.editing?.setId === s.id ? p.editing.field : null;
        return (
          <div key={s.id} data-set={s.id} className={`pf-setwrap${s.completed ? ' is-done' : ''}${isNow ? ' is-now' : ''}`}>
          <div className="pf-cols pf-set">
            <button type="button" className="pf-idx" aria-label={`Série ${label} : type, commentaire, retirer`} onClick={() => p.onSetMenu(s, label)}>
              {s.setType === 'top_set' || s.setType === 'warmup' || s.setType === 'drop' ? <span className="pf-tag">{label}</span> : label}
            </button>
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
              {(s.completed || isNow) && <Icon name="check" size={isNow ? 22 : 18} strong />}
            </button>
          </div>
          <SetExtra set={s} />
          </div>
        );
      })}
      <div className="row pf-card-foot">
        <span className="grow t-small muted">{plates ?? ''}</span>
        <button type="button" className="pf-link" onClick={p.onAddSet}>
          + Série
        </button>
      </div>
    </div>
  );
}

/** Superset ou circuit : une seule carte, les séries tour par tour (A1, A2…), repos à la fin du tour. */
function GroupCard({ doc, items, editing, onEdit, onComplete, onUncomplete, onMore, onAddRound, onSetMenu }: { doc: SessionDoc; items: SessionItem[]; editing: Editing | null; onEdit: (e: Editing) => void; onComplete: (item: SessionItem, set: SessionSet, patch?: SetPatch) => void; onUncomplete: (set: SessionSet) => void; onMore: () => void; onAddRound: () => void; onSetMenu: (item: SessionItem, set: SessionSet, label: string) => void }) {
  const rows = rounds(items);
  const now = rows.find((r) => !r.set.completed) ?? null;
  const total = Math.max(0, ...items.map((i) => i.sets.length));
  const last = items[items.length - 1]!;
  const rest = last.restSec ?? restSeconds(doc.rest, last.category, last.intention, 'working');
  const kind = items[0]!.group?.kind === 'circuit' ? 'Circuit' : 'Superset';
  const anyLoad = items.some((i) => i.format.metrics.includes('load'));
  return (
    <div className="card-module pf-card">
      <div className="pf-card-head">
        <div className="row">
          <h2 className="grow pf-big" style={{ fontSize: 22, margin: 0 }}>
            {kind}
          </h2>
          <span className="pf-chip">{`tour ${now ? now.round + 1 : total} / ${total}`}</span>
          <button type="button" className="pf-more" aria-label="Plus d’actions" onClick={onMore}>
            ···
          </button>
        </div>
        <span className="t-small muted">{items.map((i, k) => `A${k + 1} ${i.name}`).join(' · ')}</span>
      </div>
      {rows.map((r) => {
        const weighted = r.item.loadType === 'bodyweight';
        const isNow = r === now;
        const focus = editing?.setId === r.set.id ? editing.field : null;
        const load = r.item.format.metrics.includes('load');
        return (
          <div key={r.set.id} data-set={r.set.id} className={`pf-setwrap${r.set.completed ? ' is-done' : ''}${isNow ? ' is-now' : ''}`}>
          <div className={`pf-gcols${anyLoad ? '' : ' is-noload'} pf-set`}>
            <button type="button" className="pf-idx" aria-label={`${r.item.name}, tour ${r.round + 1} : type, commentaire, retirer`} onClick={() => onSetMenu(r.item, r.set, `${r.tag} · tour ${r.round + 1}`)}>
              <span className="pf-tag">{r.tag}</span>
            </button>
            <span className="t-small pf-nowrap">{isNow ? <b>{r.item.name}</b> : r.item.name}</span>
            {!anyLoad ? null : load ? (
              <button type="button" className={`pf-cell${focus === 'weight' ? ' is-focus' : ''}`} aria-label={`Charge, ${r.item.name}, tour ${r.round + 1}`} onClick={() => onEdit({ setId: r.set.id, field: 'weight' })}>
                {r.set.weight !== null ? kg(r.set.weight, weighted) : <span className="pf-ph">{kg(r.set.targetWeight, weighted)}</span>}
              </button>
            ) : (
              <span />
            )}
            <button type="button" className={`pf-cell${focus === 'reps' ? ' is-focus' : ''}`} aria-label={`Répétitions, ${r.item.name}, tour ${r.round + 1}`} onClick={() => onEdit({ setId: r.set.id, field: 'reps' })}>
              {r.set.reps !== null ? r.set.reps : <span className="pf-ph">{r.set.targetReps ?? '—'}</span>}
            </button>
            <button
              type="button"
              className={`pf-ck${r.set.completed ? ' is-done' : isNow ? ' is-go' : ''}`}
              aria-label={r.set.completed ? `${r.item.name}, tour ${r.round + 1} fait : annuler` : `Valider ${r.item.name}, tour ${r.round + 1}`}
              onClick={() => (r.set.completed ? onUncomplete(r.set) : onComplete(r.item, r.set))}
            >
              {(r.set.completed || isNow) && <Icon name="check" size={isNow ? 22 : 18} strong />}
            </button>
          </div>
          <SetExtra set={r.set} />
          </div>
        );
      })}
      <div className="row pf-card-foot">
        <span className="grow t-small muted">{`Repos ${clock(rest)} à la fin du tour`}</span>
        <button type="button" className="pf-link" onClick={onAddRound}>
          + Tour
        </button>
      </div>
    </div>
  );
}

/** EMOM : un top au début de chaque minute ; chaque minute est une série (reps à corriger d'un toucher). */
function IntervalBlock(p: CardProps & { label: string }) {
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
            <stop offset="0" stopColor="var(--tone)" />
            <stop offset="1" stopColor="var(--tone-solid)" />
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
          <button key={s.id} type="button" className={`pf-dot${s.completed ? ' is-done' : startedAt && i === minute ? ' is-today' : ' is-off'}`} aria-label={`Minute ${i + 1}, ${s.reps ?? s.targetReps ?? 0} reps`} onClick={() => p.onEdit({ setId: s.id, field: 'reps' })}>
            {s.completed || (startedAt && i <= minute) ? (s.reps ?? s.targetReps ?? '·') : '·'}
          </button>
        ))}
      </div>
      <span className="t-small muted">{`${p.label} · ${item.sets.reduce((n, s) => n + (s.completed ? (s.reps ?? s.targetReps ?? 0) : 0), 0)} reps sur ${item.sets.reduce((n, s) => n + (s.targetReps ?? 0), 0)} · bip et vibration chaque minute`}</span>
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
          <span key={s.id} className={`pf-chip${s.completed ? ' is-ok' : ' is-neutral'}`}>
            {s.completed ? `${i + 1} · ${s.durationS ?? 0} s` : `${i + 1} · ${target !== null ? `${target} s` : 'à faire'}`}
          </span>
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

/** Le repos en bandeau, au-dessus de « Valider » : heure de fin absolue (il survit à l'app fermée). */
function RestBanner({ big }: { big?: boolean }) {
  const { rest, left } = useRest();
  if (!rest) return null;
  return (
    <Glass className={`pf-rest${big ? ' is-big' : ''}`}>
      <div className="row" style={{ gap: 6 }}>
        <span className="grow" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span className="t-label muted pf-nowrap">{`Repos avant ${rest.next}`}</span>
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
      <div className="progress" role="progressbar" aria-label="Repos restant" aria-valuemin={0} aria-valuemax={rest.total} aria-valuenow={left}>
        <span className="pf-restbar" style={{ width: `${Math.max(0, Math.min(100, ((rest.endAt - Date.now()) / (rest.total * 1000)) * 100))}%` }} />
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
  /** Un chiffre tapé au clavier qui a ouvert la saisie : il commence la valeur. */
  seed?: string | null;
  onSeeded?: () => void;
  /** Ordinateur : dans le panneau de droite, pas en feuille par-dessus la séance. */
  docked?: boolean;
}

const parse = (s: string): number | null => {
  const n = Number(s.replace(',', '.'));
  return s.trim() === '' || !Number.isFinite(n) ? null : n;
};
const show = (v: number | null) => (v === null ? '' : String(v).replace('.', ','));

function Keypad({ doc, item, set, field, onField, onSave, onBodyweight, onComplete, onClose, seed, onSeeded, docked }: KeypadProps) {
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
  // Au clavier (ordinateur) : chiffres, virgule, effacer, Entrée pour valider, Échap pour fermer, flèches pour changer
  // de case (gauche, droite) ou ajuster (haut, bas).
  const live = useRef({ type, validate, step, switchTo, commit, onClose, field });
  live.current = { type, validate, step, switchTo, commit, onClose, field };
  useEffect(() => {
    if (seed) {
      setBuffer(seed);
      setFresh(false);
      onSeeded?.();
    }
  }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = live.current;
      if (/^[0-9]$/.test(e.key)) k.type(e.key);
      else if (e.key === ',' || e.key === '.') k.type(',');
      else if (e.key === 'Backspace') k.type('⌫');
      else if (e.key === 'Enter') k.validate();
      else if (e.key === 'Escape') void k.commit().then(k.onClose);
      else if (e.key === 'ArrowRight' && k.field === 'weight') void k.switchTo('reps');
      else if (e.key === 'ArrowLeft' && k.field === 'reps') void k.switchTo('weight');
      else if (e.key === 'ArrowUp') k.step(k.field === 'weight' ? item.increment : 1);
      else if (e.key === 'ArrowDown') k.step(-(k.field === 'weight' ? item.increment : 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item.increment]);
  const hasLoad = item.format.metrics.includes('load');
  const value = (f: Field) => {
    if (f === field) return buffer || '0';
    const v = f === 'weight' ? (set.weight ?? set.targetWeight) : f === 'reps' ? (set.reps ?? set.targetReps) : doc.bodyweight;
    return show(v) || '—';
  };
  const signed = (f: Field, text: string) => (f === 'weight' && weighted && text !== '—' && Number(text.replace(',', '.')) > 0 ? `+${text}` : text);
  const keys: [string, string | null][] = [
    ['1', null], ['2', null], ['3', null], ['minus', null],
    ['4', null], ['5', null], ['6', null], ['plus', null],
    ['7', null], ['8', null], ['9', null], ['switch', null],
    [',', null], ['0', null], ['⌫', 'Effacer'], ['ok', null],
  ];
  const stepBy = field === 'weight' ? item.increment : field === 'bw' ? 0.5 : 1;

  return (
    <div className={docked ? 'card-module pf-keypad is-docked' : 'sheet card-module pf-keypad'} role="dialog" aria-label="Saisie de la série">
      <div className="row t-small" style={{ gap: 2 }}>
        {rest ? (
          <>
            <span className="grow muted">
              Repos <b className="pf-big" style={{ fontSize: 17, color: 'var(--ink)' }}>{clock(left)}</b>
              {` / ${clock(rest.total)}`}
            </span>
            <button type="button" className="pf-link is-muted" onClick={() => adjustRest(-15)}>
              −15
            </button>
            <button type="button" className="pf-link is-muted" onClick={() => adjustRest(30)}>
              +30
            </button>
            <button type="button" className="pf-link" onClick={skipRest}>
              Passer
            </button>
          </>
        ) : (
          <span className="grow muted">{item.name}</span>
        )}
        <button type="button" className="pf-more" aria-label="Fermer le clavier" onClick={() => void commit().then(onClose)}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {field === 'bw' ? (
        <div className="pf-kcells" style={{ gridTemplateColumns: '1fr' }}>
          <span className="pf-cell pf-kcell is-focus">
            {value('bw')}
            <span className="pf-kunit">kg · poids du corps</span>
          </span>
        </div>
      ) : (
        <div className="pf-kcells" style={hasLoad ? undefined : { gridTemplateColumns: '1fr' }}>
          {hasLoad && (
            <button type="button" className={`pf-cell pf-kcell${field === 'weight' ? ' is-focus' : ''}`} aria-label={weighted ? 'Lest' : 'Charge'} onClick={() => field !== 'weight' && void switchTo('weight')}>
              {signed('weight', value('weight'))}
              <span className="pf-kunit">{weighted ? 'kg de lest' : 'kg'}</span>
            </button>
          )}
          <button type="button" className={`pf-cell pf-kcell${field === 'reps' ? ' is-focus' : ''}`} aria-label="Reps" onClick={() => field !== 'reps' && void switchTo('reps')}>
            {value('reps')}
            <span className="pf-kunit">reps</span>
          </button>
        </div>
      )}
      {weighted && field !== 'bw' && (
        <div className="row t-small">
          <span className="grow muted">Poids du corps</span>
          <button type="button" className="pf-chip is-neutral" onClick={() => void switchTo('bw')}>{`${show(doc.bodyweight) || '—'} kg · modifier`}</button>
        </div>
      )}
      {field !== 'bw' && hasLoad && (
        <div className="row" role="group" aria-label="Vitesse de barre, de 1 à 5 (facultatif)" style={{ gap: 6 }}>
          <span className="t-small muted" style={{ width: 56 }}>
            Vitesse
          </span>
          {['1', '2', '3', '4', '5'].map((v) => (
            <button key={v} type="button" className={`pf-chip pf-speed${set.speed === Number(v) ? '' : ' is-neutral'}`} aria-pressed={set.speed === Number(v)} onClick={() => void onSave({ speed: set.speed === Number(v) ? null : Number(v) })}>
              {v}
            </button>
          ))}
        </div>
      )}
      <div className="pf-keys">
        {keys.map(([k, aria]) => {
          if (k === 'minus' || k === 'plus')
            return (
              <button key={k} type="button" className="btn btn-secondary pf-key is-alt" onClick={() => step(k === 'minus' ? -stepBy : stepBy)}>
                {`${k === 'minus' ? '−' : '+'}${show(stepBy)}`}
              </button>
            );
          if (k === 'switch')
            return field === 'bw' || !hasLoad ? (
              <span key={k} />
            ) : (
              <button key={k} type="button" className="btn btn-secondary pf-key is-alt" onClick={() => void switchTo(field === 'weight' ? 'reps' : 'weight')}>
                {field === 'weight' ? 'Reps →' : '← Charge'}
              </button>
            );
          if (k === 'ok')
            return (
              <button key={k} type="button" className="btn btn-action pf-key" aria-label={field === 'bw' ? 'Enregistrer le poids du corps' : set.completed ? 'Enregistrer la correction' : 'Valider la série'} onClick={validate}>
                <Icon name="check" size={24} strong />
              </button>
            );
          return (
            <button key={k} type="button" className={`btn btn-secondary pf-key${k === '⌫' ? ' is-alt' : ''}`} aria-label={aria ?? undefined} onClick={() => type(k)}>
              {k}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- série et exercice : type, commentaires

const TYPES: readonly { id: SessionSet['setType']; label: string }[] = [
  { id: 'warmup', label: 'Échauffement' },
  { id: 'top_set', label: 'Top set' },
  { id: 'backoff', label: 'Backoff' },
  { id: 'working', label: 'Série' },
  { id: 'drop', label: 'Drop set' },
];

/** Sous une série : sa vitesse et ton commentaire, s'il y en a. */
function SetExtra({ set }: { set: SessionSet }) {
  const bits = [set.speed !== null ? `vitesse ${set.speed}` : '', set.note ? `« ${set.note} »` : ''].filter(Boolean);
  return bits.length ? <div className="pf-setextra">{bits.join(' · ')}</div> : null;
}

/** Une série : sa catégorie, ton commentaire, la retirer (même faite : une erreur de saisie se corrige). */
function SetSheet({ menu, onClose, onType, onNote, onRemove }: { menu: { item: SessionItem; set: SessionSet; label: string } | null; onClose: () => void; onType: (t: SessionSet['setType']) => Promise<void>; onNote: (note: string) => Promise<void>; onRemove: () => Promise<void> }) {
  const [note, setNote] = useState('');
  useEffect(() => setNote(menu?.set.note ?? ''), [menu]);
  const title = menu ? `${/^\d/.test(menu.label) ? `Série ${menu.label}` : menu.label} · ${menu.item.name}` : '';
  return (
    <Sheet open={menu !== null} title={title} onClose={onClose}>
      {menu && (
        <div className="stack" style={{ gap: 16 }}>
          {menu.item.format.scheme === 'sets' && (
            <div className="stack" style={{ gap: 8 }}>
              <span className="pf-sec" style={{ margin: 0, padding: 0 }}>
                Type de série
              </span>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {TYPES.map((t) => (
                  <button key={t.id} type="button" className={`pf-chip${menu.set.setType === t.id ? '' : ' is-neutral'}`} aria-pressed={menu.set.setType === t.id} onClick={() => void onType(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="stack" style={{ gap: 8 }}>
            <label className="pf-sec" htmlFor="pf-set-note" style={{ margin: 0, padding: 0 }}>
              Commentaire
            </label>
            <textarea id="pf-set-note" className="input pf-note" rows={2} maxLength={2000} placeholder="Sensations, technique, douleur…" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button variant="action" block disabled={note.trim() === menu.set.note.trim()} onClick={() => void onNote(note)}>
              Enregistrer le commentaire
            </Button>
          </div>
          <Button variant="danger" block onClick={() => void onRemove()}>
            Retirer cette série
          </Button>
        </div>
      )}
    </Sheet>
  );
}

/** « ··· » d'un exercice : ton commentaire du jour, remplacer, ajouter une série. */
function ExerciseSheet({ item, onClose, onComment, onReplace, onAddSet }: { item: SessionItem | null; onClose: () => void; onComment: (text: string) => Promise<void>; onReplace: () => void; onAddSet: () => void }) {
  const [text, setText] = useState('');
  useEffect(() => setText(item?.comment ?? ''), [item]);
  return (
    <Sheet open={item !== null} title={item?.name ?? ''} onClose={onClose}>
      {item && (
        <div className="stack" style={{ gap: 16 }}>
          {item.note && <span className="t-small muted">{`Consigne : ${item.note}`}</span>}
          {item.lastComment && <span className="t-small muted">{`La dernière fois : « ${item.lastComment} »`}</span>}
          <div className="stack" style={{ gap: 8 }}>
            <label className="pf-sec" htmlFor="pf-ex-note" style={{ margin: 0, padding: 0 }}>
              Ton commentaire sur l’exercice
            </label>
            <textarea id="pf-ex-note" className="input pf-note" rows={3} maxLength={2000} placeholder="Ressenti, réglages, à retenir pour la prochaine fois" value={text} onChange={(e) => setText(e.target.value)} />
            <Button variant="action" block disabled={text.trim() === item.comment.trim()} onClick={() => void onComment(text)}>
              Enregistrer le commentaire
            </Button>
          </div>
          <List>
            <ListRow title="Remplacer l’exercice" onClick={onReplace} />
            <ListRow title="Ajouter une série" onClick={onAddSet} />
          </List>
          <span className="t-small muted">Pour changer le type d’une série, la commenter ou la retirer : touche son numéro.</span>
        </div>
      )}
    </Sheet>
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
        {[
          { title: 'Déjà fait à la place', list: shown.filter((c) => c.detail.endsWith('à la place')) },
          { title: q ? 'Résultats' : 'Autres exercices', list: shown.filter((c) => !c.detail.endsWith('à la place')) },
        ]
          .filter((g) => g.list.length > 0)
          .map((g) => (
            <div key={g.title} className="stack-0">
              <span className="pf-sec" style={{ margin: '0 0 4px', padding: 0 }}>
                {g.title}
              </span>
              {g.list.map((c) => (
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
                  {picked === c.id && <span className="pf-chip">choisi</span>}
                </button>
              ))}
            </div>
          ))}
        {!adding && (
          <div className="stack" style={{ gap: 8 }}>
            <span className="pf-sec" style={{ margin: 0, padding: 0 }}>Pour quand ?</span>
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
