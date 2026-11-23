import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Field, Glass, List, ListRow, Notice, Segmented, Sheet, Switch } from '@mylife/kit';
import { disableRestPush, enableRestPush, restPushOn, restPushSupported } from '../session/restPush';
import type { StrengthWeek } from '@mylife/training';
import { call } from '../data/client';
import type { BlockDetail, LiftCell, LiftView, SettingsView, WeekScheme } from '../data/plan';
import type { TemplateSummary } from '../data/program';
import { Head, NumberRow } from './common';
import { errorText, MUSCLES, today, useData } from './util';
import '../perf.css';

/**
 * Les réglages d'entraînement (maquettes E2, E3, E4, validées le 22/11) : un seul endroit pour toutes les métriques.
 * Le bloc (sa structure semaine par semaine pour tous les lifts au %), chaque lift (son 1RM de référence en lest net,
 * ses semaines ajustées, « Auto » pour revenir au bloc), les autres progressions, les valeurs de base.
 */
const pctText = (v: number) => `${(Math.round(v * 1000) / 10).toLocaleString('fr-FR')} %`;
const kgText = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 2 });

function BlockChips({ blocks, value, onPick }: { blocks: { id: string; name: string; current: boolean }[]; value: string | undefined; onPick: (id: string) => void }) {
  if (blocks.length < 2) return null;
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {blocks.map((b) => (
        <button key={b.id} type="button" className={`pf-chip${b.id === value ? '' : ' is-neutral'}`} aria-pressed={b.id === value} onClick={() => onPick(b.id)}>
          {b.current ? `${b.name} · en cours` : b.name}
        </button>
      ))}
    </div>
  );
}

/** Le tableau d'un bloc ou d'un lift : chaque case se touche pour régler la semaine. */
function WeeksTable({ weeks, onPick }: { weeks: { index: number; label: string; current?: boolean; adjusted?: boolean; top: string | null; topPct: string | null; back: string | null; backPct: string | null }[]; onPick: (index: number) => void }) {
  return (
    <div className="pf-tablewrap">
      <table className="pf-table is-edit">
        <thead>
          <tr>
            <th />
            {weeks.map((w) => (
              <th key={w.index} className={w.current ? 'is-current' : undefined}>
                {w.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(['top', 'back'] as const).map((row) => (
            <tr key={row}>
              <td className="pf-tl">{row === 'top' ? 'top set' : 'backoffs'}</td>
              {weeks.map((w) => (
                <td key={w.index} className={[w.current ? 'is-current' : '', w.adjusted ? 'is-adjusted' : ''].filter(Boolean).join(' ') || undefined}>
                  <button type="button" className="pf-cellbtn" aria-label={`${w.label}, ${row === 'top' ? 'top set' : 'backoffs'} : régler`} onClick={() => onPick(w.index)}>
                    {(row === 'top' ? w.top : w.back) ?? '—'}
                    {(row === 'top' ? w.topPct : w.backPct) && <small>{row === 'top' ? w.topPct : w.backPct}</small>}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- E2 · réglages d'entraînement

export function ReglagesPage() {
  const date = today();
  const [params, setParams] = useSearchParams();
  const blockId = params.get('bloc');
  const { data: v, error, reload } = useData<SettingsView>(() => call('settingsView', date, blockId), [date, blockId]);
  const [week, setWeek] = useState<WeekScheme | null>(null);
  const [all, setAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const [base, setBase] = useState<'increment' | 'bar' | 'rest' | 'bodyweight' | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!v) return <span className="t-small muted">Lecture des réglages…</span>;
  const others = all ? v.others : v.others.slice(0, 6);
  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 110 }}>
      <div className="pf-amb" aria-hidden="true" />
      <Head back="/sport/programme" kicker="Programme" title="Réglages d’entraînement" />
      {failed && <Notice tone="bad">{failed}</Notice>}
      <BlockChips blocks={v.blocks} value={v.block?.id} onPick={(id) => setParams({ bloc: id }, { replace: true })} />

      {v.block ? (
        <>
          <span className="pf-sec">
            <span>Le bloc · tous les lifts au %</span>
            <a className="c-tone" href={`/sport/programme/bloc/${v.block.id}`}>
              Régler le bloc
            </a>
          </span>
          <div className="card-module" style={{ padding: '10px 10px 12px' }}>
            <WeeksTable weeks={v.block.weeks.map((w) => ({ ...w, current: v.block!.currentWeek === w.index }))} onPick={(i) => setWeek(v.block!.weeks.find((w) => w.index === i) ?? null)} />
          </div>
        </>
      ) : (
        <div className="card-module pf-hero">
          <span className="pf-kick">Pas de bloc</span>
          <span className="t-small muted">Sans bloc, chaque exercice suit sa propre progression.</span>
          <Button href="/sport/programme/bloc/nouveau">+ Créer un bloc</Button>
        </div>
      )}

      {v.lifts.length > 0 && (
        <>
          <span className="pf-sec">
            <span>Au % du 1RM</span>
            <span>1RM de référence</span>
          </span>
          <List>
            {v.lifts.map((l) => (
              <ListRow
                key={l.exerciseId}
                href={`/sport/programme/lift/${l.exerciseId}${v.block ? `?bloc=${v.block.id}` : ''}`}
                title={<span className="t-strong">{l.name}</span>}
                detail={l.adjusted.length ? <span className="c-tone">{`${l.adjusted.join(', ')} ajustée${l.adjusted.length > 1 ? 's' : ''}`}</span> : v.block ? 'suit le bloc' : undefined}
                value={l.reference ? <b>{l.reference}</b> : <span className="t-small muted">à saisir</span>}
              />
            ))}
          </List>
        </>
      )}

      <span className="pf-sec">
        <span>Autres progressions</span>
        <button type="button" className="pf-link" style={{ padding: 0, fontSize: 12 }} onClick={() => setCreating(true)}>
          + Nouvel exercice
        </button>
      </span>
      {v.others.length > 0 ? (
        <List>
          {others.map((o) => (
            <ListRow key={o.slotId} href={`/sport/programme/creneau/${o.slotId}`} title={<span className="t-strong">{o.name}</span>} detail={o.detail} />
          ))}
        </List>
      ) : (
        <span className="t-small muted" style={{ padding: '0 4px' }}>
          Aucun autre exercice dans tes séances.
        </span>
      )}
      {v.others.length > 6 && (
        <button type="button" className="pf-link is-muted" style={{ alignSelf: 'center', marginTop: -8 }} onClick={() => setAll(!all)}>
          {all ? 'Moins' : `+ ${v.others.length - 6} exercices · tout voir`}
        </button>
      )}

      <span className="pf-sec">
        <span>Valeurs de base</span>
        <span />
      </span>
      <List>
        <ListRow title="Incrément de charge" value={v.base.increment} onClick={() => setBase('increment')} />
        <ListRow title="Barre et disques" value={<span className="t-small muted">{v.base.bar}</span>} onClick={() => setBase('bar')} />
        <ListRow title="Repos par défaut" value={<span className="t-small muted">{v.base.rest}</span>} onClick={() => setBase('rest')} />
        <ListRow title="Poids du corps" value={v.base.bodyweight ?? 'à noter'} onClick={() => setBase('bodyweight')} />
      </List>
      <RestPushRow />

      {v.block && (
        <WeekSheet
          open={week !== null}
          title={week ? `${week.deload ? 'Décharge' : `Semaine ${week.index}`} · tous les lifts` : ''}
          values={week?.week ?? null}
          onClose={() => setWeek(null)}
          onSave={async (values) => {
            try {
              await call('setBlockWeek', v.block!.id, week!.index, values);
              setWeek(null);
              reload();
            } catch (e) {
              setFailed(errorText(e));
            }
          }}
        />
      )}
      <NewExerciseSheet open={creating} name="" onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />
      <BaseSheet which={base} onClose={() => setBase(null)} onSaved={() => { setBase(null); reload(); }} />
    </div>
  );
}

// ---------------------------------------------------------------- une semaine (bloc ou lift)

function Mini({ label, value, text, onChange, step, min, max }: { label: string; value: number; text: string; onChange: (v: number) => void; step: number; min: number; max: number }) {
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return (
    <div className="pf-mini">
      <span className="pf-mini-val">{text}</span>
      <span className="pf-mini-label">{label}</span>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="pf-more" aria-label={`${label} : moins`} onClick={() => onChange(Math.max(min, round(value - step)))}>
          −
        </button>
        <button type="button" className="pf-more" aria-label={`${label} : plus`} onClick={() => onChange(Math.min(max, round(value + step)))}>
          +
        </button>
      </div>
    </div>
  );
}

/** Régler une semaine : top set (séries, reps, %) et backoffs ; « Auto » revient au bloc (pour un lift). */
function WeekSheet({ open, title, values, adjusted, preview, onClose, onSave, onAuto }: { open: boolean; title: string; values: StrengthWeek | null; adjusted?: boolean; preview?: (w: StrengthWeek) => string | null; onClose: () => void; onSave: (w: StrengthWeek) => void; onAuto?: () => void }) {
  const [w, setW] = useState<StrengthWeek | null>(values);
  useEffect(() => setW(values), [values, open]);
  if (!w) return null;
  const set = (patch: Partial<StrengthWeek>) => setW({ ...w, ...patch });
  const line = preview?.(w);
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <div className="stack" style={{ gap: 12 }}>
        {adjusted && <span className="pf-chip" style={{ alignSelf: 'flex-start' }}>ajustée</span>}
        <span className="pf-sec" style={{ margin: 0, padding: 0 }}>
          Top set
        </span>
        <div className="pf-trio">
          <Mini label="séries" value={w.topSets} text={String(w.topSets)} step={1} min={0} max={5} onChange={(x) => set({ topSets: x })} />
          <Mini label="reps" value={w.topRepsMin} text={String(w.topRepsMin)} step={1} min={1} max={10} onChange={(x) => set({ topRepsMin: x, topRepsMax: x })} />
          <Mini label="du 1RM" value={w.topPercent} text={pctText(w.topPercent)} step={0.025} min={0.3} max={1.1} onChange={(x) => set({ topPercent: x })} />
        </div>
        <span className="pf-sec" style={{ margin: 0, padding: 0 }}>
          Backoffs
        </span>
        <div className="pf-trio">
          <Mini label="séries" value={w.backoffSets} text={String(w.backoffSets)} step={1} min={0} max={8} onChange={(x) => set({ backoffSets: x })} />
          <Mini label="reps" value={w.backoffReps} text={String(w.backoffReps)} step={1} min={1} max={12} onChange={(x) => set({ backoffReps: x })} />
          <Mini label="du 1RM" value={w.backoffPercent} text={pctText(w.backoffPercent)} step={0.025} min={0.3} max={1.1} onChange={(x) => set({ backoffPercent: x })} />
        </div>
        {line && <span className="t-small muted">{line}</span>}
        <div className="row" style={{ gap: 8 }}>
          {onAuto && adjusted && <Button onClick={onAuto}>Auto (bloc)</Button>}
          <div className="grow">
            <Button variant="action" block onClick={() => onSave(w)}>
              Enregistrer
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- E3 · un lift semaine par semaine

export function LiftPage() {
  const { id = '' } = useParams();
  const date = today();
  const [params, setParams] = useSearchParams();
  const blockId = params.get('bloc');
  const { data: v, error, reload } = useData<LiftView | null>(() => call('liftView', id, blockId, date), [id, blockId, date]);
  const [cell, setCell] = useState<LiftCell | null>(null);
  const [refOpen, setRefOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (v === null) return <Notice>Cet exercice n’existe plus.</Notice>;
  if (!v) return <span className="t-small muted">Lecture…</span>;
  const act = async (p: Promise<unknown>) => {
    try {
      await p;
      setFailed(null);
      setCell(null);
      setRefOpen(false);
      reload();
    } catch (e) {
      setFailed(errorText(e));
    }
  };
  // Aperçu de la charge (comme le moteur : % de la masse totale pour un lesté, arrondi à l'incrément).
  const preview = (w: StrengthWeek) => {
    if (!v.reference) return 'Pas encore de 1RM : la charge viendra de ton top set ou de ton historique.';
    const bw = v.weighted ? (v.bodyweight ?? 0) : 0;
    const load = (p: number) => {
      const raw = (v.reference!.value + bw) * p - bw;
      const r = Math.round(raw / 2.5) * 2.5;
      return `${v.weighted && r > 0 ? '+' : ''}${kgText(r)} kg`;
    };
    return `Soit environ ${load(w.topPercent)} au top set${w.backoffSets > 0 ? ` et ${load(w.backoffPercent)} aux backoffs` : ''}${v.weighted && v.bodyweight ? ` (poids du corps ${kgText(v.bodyweight)} kg)` : ''}.`;
  };
  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 110 }}>
      <div className="pf-amb" aria-hidden="true" />
      <Head back={`/sport/programme/reglages${v.block ? `?bloc=${v.block.id}` : ''}`} kicker={v.block ? `${v.block.name} · au % du 1RM` : 'Au % du 1RM'} title={v.name} />
      {failed && <Notice tone="bad">{failed}</Notice>}
      <BlockChips blocks={v.blocks} value={v.block?.id} onPick={(b) => setParams({ bloc: b }, { replace: true })} />
      <List>
        <ListRow
          title="1RM de référence"
          detail={v.reference?.source === 'estimé' ? 'estimé sur tes séries' : v.estimate ? `estimé : ${v.estimate}` : undefined}
          value={v.reference ? <b>{v.reference.text}</b> : <span className="t-small muted">à saisir</span>}
          onClick={() => setRefOpen(true)}
        />
      </List>
      {v.weeks.length > 0 ? (
        <>
          <Glass className="pf-tablewrap" style={{ padding: '10px 10px 12px' }}>
            <WeeksTable weeks={v.weeks} onPick={(i) => setCell(v.weeks.find((w) => w.index === i) ?? null)} />
          </Glass>
          <span className="t-small muted" style={{ padding: '0 4px', marginTop: -6 }}>
            Cerclé : ajusté pour cet exercice. Le reste suit le bloc.
          </span>
        </>
      ) : (
        <Notice>Pas de bloc : cet exercice suit le top set que tu tapes en séance.</Notice>
      )}
      {v.block && (
        <WeekSheet
          open={cell !== null}
          title={cell ? (cell.deload ? 'Décharge' : `Semaine ${cell.index}`) : ''}
          values={cell?.values ?? null}
          adjusted={cell?.adjusted}
          preview={preview}
          onClose={() => setCell(null)}
          onSave={(w) => void act(call('setLiftWeek', v.block!.id, v.exerciseId, cell!.index, w))}
          onAuto={() => void act(call('setLiftWeek', v.block!.id, v.exerciseId, cell!.index, null))}
        />
      )}
      <ReferenceSheet open={refOpen} view={v} onClose={() => setRefOpen(false)} onSave={(value) => void act(call('setReference', v.exerciseId, value, date))} />
    </div>
  );
}

function ReferenceSheet({ open, view, onClose, onSave }: { open: boolean; view: LiftView; onClose: () => void; onSave: (v: number | null) => void }) {
  const [text, setText] = useState('');
  useEffect(() => setText(view.reference?.source === 'saisi' ? String(view.reference.value).replace('.', ',') : ''), [open, view]);
  const value = Number(text.replace(',', '.').replace('+', '').trim());
  const valid = text.trim() !== '' && Number.isFinite(value);
  return (
    <Sheet open={open} title="1RM de référence" onClose={onClose}>
      <div className="stack">
        <Field id="pf-ref" label={view.weighted ? 'Lest (kg), sans le poids du corps' : 'Charge (kg)'}>
          <input id="pf-ref" inputMode="decimal" placeholder={view.weighted ? '+42,5' : '160'} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </Field>
        {(view.estimate || view.reference?.source === 'estimé') && <span className="t-small muted">{`Estimé sur tes séries : ${view.estimate ?? view.reference!.text}`}</span>}
        <Button variant="action" block disabled={!valid} onClick={() => onSave(value)}>
          Enregistrer
        </Button>
        {view.reference?.source === 'saisi' && (
          <Button block onClick={() => onSave(null)}>
            Revenir à l’estimation
          </Button>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- E4 · un bloc

export function BlocPage() {
  const { id = '' } = useParams();
  const isNew = id === 'nouveau';
  const navigate = useNavigate();
  const date = today();
  const { data: b, error, reload } = useData<BlockDetail | null>(() => call('blockDetail', isNew ? null : id, date), [id, date]);
  const [draft, setDraft] = useState<{ name?: string; kind?: string; startDate?: string; workWeeks?: number; deloadWeeks?: number }>({});
  const [sheet, setSheet] = useState<'name' | 'start' | null>(null);
  const [week, setWeek] = useState<WeekScheme | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => setDraft({}), [id]);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (b === null) return <Notice>Ce bloc n’existe plus.</Notice>;
  if (!b) return <span className="t-small muted">Lecture…</span>;
  const shown = { ...b, ...draft };
  // Un bloc existant s'enregistre à chaque changement ; un nouveau, d'un coup, à « Créer le bloc ».
  const change = async (patch: typeof draft) => {
    if (isNew) return setDraft({ ...draft, ...patch });
    try {
      await call('saveBlock', id, patch, date);
      setFailed(null);
      setSheet(null);
      reload();
    } catch (e) {
      setFailed(errorText(e));
    }
  };
  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 110 }}>
      <div className="pf-amb" aria-hidden="true" />
      <Head back="/sport/programme" kicker={isNew ? 'Nouveau bloc' : `Bloc ${b.index} sur ${b.total}`} title={shown.name} />
      {failed && <Notice tone="bad">{failed}</Notice>}
      <List>
        <ListRow title="Nom" value={<span className="t-small muted">{shown.name}</span>} onClick={() => setSheet('name')} />
        <ListRow title="Début" value={<span className="t-small muted">{new Date(`${shown.startDate}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>} onClick={() => setSheet('start')} />
      </List>
      <span className="pf-sec">
        <span>Type</span>
        <span>pré-remplit les semaines</span>
      </span>
      <div className="pf-tiles">
        {b.kinds.map((k) => (
          <button key={k.id} type="button" className={`pf-tile${shown.kind === k.id ? ' is-on' : ''}`} aria-pressed={shown.kind === k.id} onClick={() => void change({ kind: k.id })}>
            {k.label}
            <span>{k.hint}</span>
          </button>
        ))}
      </div>
      <Glass className="pf-numlist">
        <NumberRow label="Semaines de travail" value={shown.workWeeks} unit="" min={1} max={12} onChange={(x) => void change({ workWeeks: x })} />
        <NumberRow label="Décharge" value={shown.deloadWeeks} unit="sem." min={0} max={2} onChange={(x) => void change({ deloadWeeks: x })} />
      </Glass>
      {!isNew && (
        <span className="t-small muted" style={{ padding: '0 4px', marginTop: -6 }}>
          {`${b.dates} · les blocs suivants se décalent d’autant.`}
        </span>
      )}
      {!isNew && (
        <>
          <span className="pf-sec">
            <span>Semaine par semaine</span>
            <span>tous les lifts au %</span>
          </span>
          <List>
            {b.weeks.map((w) => (
              <ListRow key={w.index} lead={<span className="pf-chip is-neutral" style={{ minHeight: 24 }}>{w.label}</span>} title={<span className="t-small">{`${w.top} @ ${w.topPct}${w.back ? ` · ${w.back} @ ${w.backPct}` : ''}`}</span>} onClick={() => setWeek(w)} />
            ))}
          </List>
        </>
      )}
      {isNew ? (
        <Button
          variant="action"
          block
          onClick={async () => {
            try {
              const created = await call('saveBlock', null, draft, date);
              navigate(`/sport/programme/bloc/${created}`, { replace: true });
            } catch (e) {
              setFailed(errorText(e));
            }
          }}
        >
          Créer le bloc
        </Button>
      ) : (
        <Button
          variant="danger"
          block
          onClick={async () => {
            await call('deleteBlock', id);
            navigate('/sport/programme', { replace: true });
          }}
        >
          Supprimer le bloc
        </Button>
      )}

      <TextSheet open={sheet === 'name'} title="Nom du bloc" label="Nom" value={shown.name} onClose={() => setSheet(null)} onSave={(name) => { setSheet(null); void change({ name }); }} />
      <TextSheet open={sheet === 'start'} title="Début du bloc" label="Date" type="date" value={shown.startDate} onClose={() => setSheet(null)} onSave={(startDate) => { setSheet(null); void change({ startDate }); }} />
      <WeekSheet
        open={week !== null}
        title={week ? (week.deload ? 'Décharge · tous les lifts' : `Semaine ${week.index} · tous les lifts`) : ''}
        values={week?.week ?? null}
        onClose={() => setWeek(null)}
        onSave={async (values) => {
          try {
            await call('setBlockWeek', id, week!.index, values);
            setWeek(null);
            reload();
          } catch (e) {
            setFailed(errorText(e));
          }
        }}
      />
    </div>
  );
}

function TextSheet({ open, title, label, value, type = 'text', onClose, onSave }: { open: boolean; title: string; label: string; value: string; type?: 'text' | 'date'; onClose: () => void; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value, open]);
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <div className="stack">
        <Field id="pf-text" label={label}>
          <input id="pf-text" type={type} value={text} maxLength={60} onChange={(e) => setText(e.target.value)} autoFocus />
        </Field>
        <Button variant="action" block disabled={!text.trim() || text === value} onClick={() => onSave(text)}>
          Enregistrer
        </Button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- valeurs de base

const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5];

function BaseSheet({ which, onClose, onSaved }: { which: 'increment' | 'bar' | 'rest' | 'bodyweight' | null; onClose: () => void; onSaved: () => void }) {
  const [base, setBaseState] = useState<{ increment: number; barWeight: number; plates: number[]; restFloors: Record<'main' | 'compound' | 'isolation', number> } | null>(null);
  const [bw, setBw] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!which) return;
    setFailed(null);
    setBw('');
    void call('baseValues').then(setBaseState);
  }, [which]);
  const save = async (p: Promise<unknown>) => {
    try {
      await p;
      onSaved();
    } catch (e) {
      setFailed(errorText(e));
    }
  };
  const title = which === 'increment' ? 'Incrément de charge' : which === 'bar' ? 'Barre et disques' : which === 'rest' ? 'Repos par défaut' : 'Poids du corps';
  const clock = (s: number) => (s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s / 60} min`);
  return (
    <Sheet open={which !== null} title={title} onClose={onClose}>
      <div className="stack" style={{ gap: 14 }}>
        {failed && <Notice tone="bad">{failed}</Notice>}
        {which === 'bodyweight' ? (
          <>
            <Field id="pf-bw2" label="Poids (kg)">
              <input id="pf-bw2" inputMode="decimal" value={bw} onChange={(e) => setBw(e.target.value)} autoFocus />
            </Field>
            <Button variant="action" block disabled={!bw.trim()} onClick={() => void save(call('addBodyweight', today(), Number(bw.replace(',', '.'))))}>
              Noter
            </Button>
          </>
        ) : !base ? (
          <span className="t-small muted">Lecture…</span>
        ) : (
          <>
            {which === 'increment' && (
              <Glass className="pf-numlist">
                <NumberRow label="Plus petite hausse" value={base.increment} unit="kg" step={0.25} min={0.25} max={20} format={kgText} onChange={(x) => setBaseState({ ...base, increment: x })} />
              </Glass>
            )}
            {which === 'bar' && (
              <>
                <Glass className="pf-numlist">
                  <NumberRow label="Barre" value={base.barWeight} unit="kg" step={2.5} min={0} max={50} format={kgText} onChange={(x) => setBaseState({ ...base, barWeight: x })} />
                </Glass>
                <span className="pf-sec" style={{ margin: 0, padding: 0 }}>
                  Disques de ta salle
                </span>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {PLATES.map((p) => {
                    const on = base.plates.includes(p);
                    return (
                      <button key={p} type="button" className={`pf-chip${on ? '' : ' is-neutral'}`} aria-pressed={on} onClick={() => setBaseState({ ...base, plates: on ? base.plates.filter((x) => x !== p) : [...base.plates, p] })}>
                        {kgText(p)}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {which === 'rest' && (
              <Glass className="pf-numlist">
                {(['main', 'compound', 'isolation'] as const).map((c) => (
                  <NumberRow key={c} label={c === 'main' ? 'Principaux' : c === 'compound' ? 'Polyarticulaires' : 'Isolations'} value={base.restFloors[c]} unit="" step={15} min={15} max={900} format={clock} onChange={(x) => setBaseState({ ...base, restFloors: { ...base.restFloors, [c]: x } })} />
                ))}
              </Glass>
            )}
            <Button
              variant="action"
              block
              onClick={() =>
                void save(
                  call(
                    'setBase',
                    which === 'increment' ? { increment: base.increment } : which === 'bar' ? { barWeight: base.barWeight, plates: base.plates } : { restFloors: base.restFloors },
                  ),
                )
              }
            >
              Enregistrer
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- un nouvel exercice

/** Créer un exercice (et, au choix, l'ajouter à une séance type) : un mouvement principal suit les blocs. */
export function NewExerciseSheet({ open, name, templateId, onClose, onCreated }: { open: boolean; name: string; templateId?: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [value, setValue] = useState(name);
  const [load, setLoad] = useState<'external' | 'bodyweight'>('external');
  const [category, setCategory] = useState<'main' | 'compound' | 'isolation'>('compound');
  const [primary, setPrimary] = useState('chest');
  const [secondary, setSecondary] = useState<string[]>([]);
  const [target, setTarget] = useState<string>(templateId ?? '');
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setValue(name);
    setSecondary([]);
    setFailed(null);
    setTarget(templateId ?? '');
    if (templateId === undefined) void call('templatesView').then(setTemplates);
  }, [open, name, templateId]);
  const create = async () => {
    try {
      const id = await call('createExerciseIn', target || null, { name: value, loadType: load, category, equipment: load === 'bodyweight' ? 'bodyweight' : 'other', primary: [primary], secondary });
      onCreated(id);
    } catch (e) {
      setFailed(errorText(e));
    }
  };
  return (
    <Sheet open={open} title="Nouvel exercice" onClose={onClose}>
      <div className="stack" style={{ gap: 14 }}>
        {failed && <Notice tone="bad">{failed}</Notice>}
        <Field id="pf-new-name" label="Nom">
          <input id="pf-new-name" value={value} maxLength={80} onChange={(e) => setValue(e.target.value)} autoFocus={!name} />
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
        <Field id="pf-new-muscle" label="Muscle principal">
          <select id="pf-new-muscle" value={primary} onChange={(e) => setPrimary(e.target.value)}>
            {MUSCLES.map(([mid, label]) => (
              <option key={mid} value={mid}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <div className="stack" style={{ gap: 8 }}>
          <span className="pf-sec" style={{ margin: 0, padding: 0 }}>
            Muscles secondaires
          </span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {MUSCLES.filter(([mid]) => mid !== primary).map(([mid, label]) => {
              const on = secondary.includes(mid);
              return (
                <button key={mid} type="button" className={`pf-chip${on ? '' : ' is-neutral'}`} aria-pressed={on} onClick={() => setSecondary(on ? secondary.filter((x) => x !== mid) : [...secondary, mid])}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        {templateId === undefined && templates.length > 0 && (
          <Field id="pf-new-target" label="Ajouter à une séance type">
            <select id="pf-new-target" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Non, plus tard</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {category === 'main' && <span className="t-small muted">Il suivra tes blocs, au % de son 1RM (à saisir dans Réglages d’entraînement).</span>}
        <Button variant="action" block disabled={!value.trim()} onClick={() => void create()}>
          {target ? 'Créer et ajouter' : 'Créer'}
        </Button>
      </div>
    </Sheet>
  );
}

/** Sur cet appareil : la notification de fin de repos, écran en veille. */
function RestPushRow() {
  const [on, setOn] = useState(() => restPushOn());
  const [failed, setFailed] = useState<string | null>(null);
  if (!restPushSupported()) return null;
  return (
    <>
      {failed && <Notice tone="bad">{failed}</Notice>}
      <List>
        <ListRow
          title="Fin du repos"
          detail="notification, écran en veille"
          value={
            <Switch
              checked={on}
              label="Notification à la fin du repos"
              onChange={async (next) => {
                setFailed(null);
                if (!next) {
                  disableRestPush();
                  return setOn(false);
                }
                try {
                  await enableRestPush();
                  setOn(true);
                } catch (e) {
                  setFailed(errorText(e));
                }
              }}
            />
          }
        />
      </List>
    </>
  );
}
