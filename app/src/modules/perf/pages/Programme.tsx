import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Field, Glass, IconButton, List, ListRow, Notice, Sheet } from '@mylife/kit';
import type { ParamSpec, StrategyId } from '@mylife/training';
import { call } from '../data/client';
import type { FormatBase, FormatChoice, ProgramView, SlotDetail, SlotPatch, TemplateDetail, TemplateSummary } from '../data/program';
import { Head, NumberRow } from './common';
import { DAYS, longDay, today, useData } from './util';
import { NewExerciseSheet } from './Reglages';
import '../perf.css';

/**
 * Le Programme (maquettes V3-Prog-blocs, V3-Prog-routine, V3-Creneau, validées le 22/11). L'écran s'adapte à la
 * structure : des blocs (frise, semaine type, tableau semaine par semaine « Auto » du moteur) ou une routine (prochaine
 * séance, ce qui monte la prochaine fois). Les séances types et leurs créneaux se règlent d'un toucher.
 */
const BLOCK_TONE: Record<string, string> = { accumulation: 'var(--tone-grad)', transmutation: 'color-mix(in srgb, var(--focus) 85%, white)', realization: 'var(--warn)', transition: 'var(--ok)', custom: 'var(--ink-2)' };

// ---------------------------------------------------------------- la page Programme

export function ProgrammePage() {
  const date = today();
  const { data: v, error } = useData<ProgramView>(() => call('programView', date), [date]);
  if (error) return <Notice tone="bad">Le programme n’a pas pu être lu : {error}</Notice>;
  if (!v) return <span className="t-small muted">Lecture du programme…</span>;
  const hero = v.hero;
  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 110 }}>
      <div className="pf-amb" aria-hidden="true" />
      <Head back="/" kicker={v.subtitle || undefined} title="Programme" />

      {!v.hasProgram && (
        <div className="card-module pf-hero">
          <span className="pf-kick">Pas encore de programme</span>
          <span className="pf-big" style={{ fontSize: 26 }}>
            Crée ta première séance
          </span>
          <Button variant="action" block href="/sport/programme/seances">
            Séances types
          </Button>
          <Button block href="/sport/programme/importer">
            Importer un programme
          </Button>
          <Button variant="quiet" block href="/sport/programme/bloc/nouveau">
            Ou commence par un bloc
          </Button>
        </div>
      )}

      {hero && (
        <div className="card-module pf-hero">
          <div className="row" style={{ gap: 8 }}>
            <span className="grow pf-kick">{`${hero.week ? 'Bloc en cours' : 'Prochain bloc'} · ${hero.index} sur ${hero.total} · ${hero.kindLabel}`}</span>
            {hero.week && <span className="pf-chip">{hero.weeks.find((w) => w.state === 'current')?.label ?? `S${hero.week}`}</span>}
          </div>
          <span className="pf-big" style={{ fontSize: 28 }}>
            {hero.name}
          </span>
          <span className="t-small muted" style={{ marginTop: -6 }}>
            {`${hero.dates}${hero.deloadFrom ? ` · décharge en S${hero.deloadFrom}` : ''}`}
          </span>
          <div className="pf-weeks">
            {hero.weeks.map((w) => (
              <span key={w.label} className={`pf-wk is-${w.state}${w.deload ? ' is-deload' : ''}`}>
                {w.label}
                <small>{w.pct}</small>
              </span>
            ))}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div className="grow">
              <Button variant="action" block href={`/sport/programme/bloc/${hero.id}`}>
                Régler le bloc
              </Button>
            </div>
            <Button href="/sport/programme/reglages">Tous les réglages</Button>
          </div>
        </div>
      )}

      {v.kind !== 'periodized' && v.next && (
        <div className="card-module pf-hero">
          <span className="pf-kick">{`Prochaine séance · ${v.next.date === date ? 'aujourd’hui' : longDay(v.next.date)} · ${v.next.session.minutes} min`}</span>
          <span className="pf-big" style={{ fontSize: 28 }}>
            {v.next.session.name}
          </span>
          <div className="pf-lines">
            {v.next.session.lines.map((l, i) => (
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

      {v.blocks.length > 0 && (
        <>
          <span className="pf-sec">
            <span>Les blocs</span>
            <span>{v.blocks.length}</span>
          </span>
          <Glass className="pf-blocks">
            {v.blocks.map((b) => (
              <a key={b.id} href={`/sport/programme/bloc/${b.id}`} className={`pf-bl is-${b.state}`}>
                <span className="pf-bl-bar" style={{ background: BLOCK_TONE[b.kind] ?? BLOCK_TONE.custom }} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t-strong">{b.name}</span>
                  <br />
                  <span className="t-small muted">{`${b.dates} · ${b.state === 'future' && b.kind !== 'accumulation' ? b.kindLabel : b.weeks}`}</span>
                </span>
                {b.state === 'current' ? <span className="pf-chip">en cours</span> : b.state === 'past' ? <span className="t-small muted">fait</span> : <span className="t-small muted">›</span>}
              </a>
            ))}
          </Glass>
          <a href="/sport/programme/bloc/nouveau" className="pf-link" style={{ alignSelf: 'flex-start', marginTop: -8 }}>
            + Ajouter un bloc
          </a>
        </>
      )}

      {v.week.length > 0 && (
        <>
          <span className="pf-sec">
            <span>Semaine type</span>
            <a href="/sport/programme/seances" className="c-tone">
              Modifier
            </a>
          </span>
          <List>
            {v.week.flatMap((w) =>
              w.sessions.map((s, k) => (
                <ListRow
                  key={`${w.weekday}-${s.id}-${k}`}
                  href={`/sport/programme/seance/${s.id}`}
                  lead={<span className="t-small muted" style={{ width: 30 }}>{DAYS[w.weekday]}</span>}
                  title={<span className="t-strong">{s.name}</span>}
                  detail={s.exercises.length > 3 ? `${s.exercises.slice(0, 2).join(' · ')} · ${s.exercises.length - 2} autres` : s.exercises.join(' · ')}
                  value={s.tag ? <span className={`pf-chip${s.tag === 'force' ? '' : ' is-neutral'}`}>{s.tag}</span> : undefined}
                />
              )),
            )}
          </List>
        </>
      )}

      {v.ups.length > 0 && (
        <>
          <span className="pf-sec">
            <span>Monte la prochaine fois</span>
            <span />
          </span>
          <List>
            {v.ups.map((u) => (
              <ListRow key={u.name} title={<span className="t-strong">{u.name}</span>} value={<span className="pf-chip">{`${u.from.replace(' kg', '')} → ${u.to}`}</span>} />
            ))}
          </List>
        </>
      )}

      {v.hasProgram && (
        <List>
          <ListRow title="Réglages d’entraînement" value={`${v.lifts} exercice${v.lifts > 1 ? 's' : ''}`} href="/sport/programme/reglages" />
          <ListRow title="Séances types" value={String(v.templates)} href="/sport/programme/seances" />
          <ListRow title="Importer ou partager" href="/sport/programme/importer" />
        </List>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- séances types

export function TemplatesPage() {
  const navigate = useNavigate();
  const { data: list, error } = useData<TemplateSummary[]>(() => call('templatesView'), []);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  if (error) return <Notice tone="bad">{error}</Notice>;
  const create = async () => {
    try {
      const id = await call('createTemplate', name);
      navigate(`/sport/programme/seance/${id}`);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 110 }}>
      <div className="pf-amb" aria-hidden="true" />
      <Head back="/sport/programme" kicker="Programme" title="Séances types" right={<Button variant="action" onClick={() => { setName(''); setFailed(null); setCreating(true); }}>+ Nouvelle</Button>} />
      {!list && <span className="t-small muted">Lecture…</span>}
      {list && list.length === 0 && <Notice>Aucune séance type pour l’instant.</Notice>}
      {list && list.length > 0 && (
        <List>
          {list.map((t) => (
            <ListRow
              key={t.id}
              href={`/sport/programme/seance/${t.id}`}
              title={<span className="t-strong">{t.name}</span>}
              detail={[t.days.length ? t.days.map((x) => DAYS[x]).join(' · ') : 'hors semaine type', `${t.exercises.length} exercice${t.exercises.length > 1 ? 's' : ''}`].join(' · ')}
              value={t.tag ? <span className={`pf-chip${t.tag === 'force' ? '' : ' is-neutral'}`}>{t.tag}</span> : undefined}
            />
          ))}
        </List>
      )}
      <Sheet open={creating} title="Nouvelle séance type" onClose={() => setCreating(false)}>
        <div className="stack">
          {failed && <Notice tone="bad">{failed}</Notice>}
          <Field id="pf-tpl-name" label="Nom">
            <input id="pf-tpl-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Button variant="action" block disabled={!name.trim()} onClick={() => void create()}>
            Créer
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------- une séance type

export function TemplatePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const date = today();
  const { data: t, error, reload } = useData<TemplateDetail | null>(() => call('templateDetail', id, date), [id, date]);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const act = async (p: Promise<unknown>) => {
    try {
      await p;
      setFailed(null);
      reload();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
  };
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (t === null) return <Notice>Cette séance type n’existe plus.</Notice>;
  if (!t) return <span className="t-small muted">Lecture…</span>;
  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 110 }}>
      <div className="pf-amb" aria-hidden="true" />
      <Head back="/sport/programme/seances" kicker="Séance type" title={t.name} right={<IconButton icon="settings" label="Renommer ou archiver" onClick={() => setRenaming(true)} />} />
      {failed && <Notice tone="bad">{failed}</Notice>}
      <span className="pf-sec">
        <span>Jours de la semaine type</span>
        <span />
      </span>
      <div className="pf-days" role="group" aria-label="Jours de la semaine type">
        {DAYS.map((label, day) => {
          const on = t.days.includes(day);
          return (
            <button key={label} type="button" className={`pf-chip${on ? '' : ' is-neutral'}`} aria-pressed={on} onClick={() => void act(call('setTemplateDays', id, on ? t.days.filter((x) => x !== day) : [...t.days, day]))}>
              {label}
            </button>
          );
        })}
      </div>
      <span className="pf-sec">
        <span>Exercices</span>
        <span>{t.slots.length}</span>
      </span>
      {t.slots.length > 0 && (
        <Glass className="pf-slots">
          {t.slots.map((s, i) => (
            <div key={s.id} className="pf-slot">
              <a className="grow pf-slot-main" href={`/sport/programme/creneau/${s.id}`}>
                <span className="t-strong">{s.name}</span>
                <span className="t-small muted">{[s.prescription, s.format === 'Séries (reps)' ? 'reps seules' : ''].filter(Boolean).join(' · ')}</span>
                {s.group && <span className="t-small c-tone">{s.group}</span>}
              </a>
              <button type="button" className="pf-more" aria-label={`Monter ${s.name}`} disabled={i === 0} onClick={() => void act(call('moveSlot', s.id, -1))}>
                ↑
              </button>
              <button type="button" className="pf-more" aria-label={`Descendre ${s.name}`} disabled={i === t.slots.length - 1} onClick={() => void act(call('moveSlot', s.id, 1))}>
                ↓
              </button>
            </div>
          ))}
        </Glass>
      )}
      <Button variant={t.slots.length ? 'secondary' : 'action'} block onClick={() => setAdding(true)}>
        + Ajouter un exercice
      </Button>

      <ExercisePicker
        open={adding}
        templateId={id}
        onClose={() => setAdding(false)}
        onPick={async (exerciseId) => {
          setAdding(false);
          await act(call('addSlot', id, exerciseId));
        }}
        onCreated={() => {
          setAdding(false);
          reload();
        }}
      />
      <RenameSheet
        open={renaming}
        name={t.name}
        onClose={() => setRenaming(false)}
        onRename={async (name) => {
          setRenaming(false);
          await act(call('renameTemplate', id, name));
        }}
        onArchive={async () => {
          await call('archiveTemplate', id);
          navigate('/sport/programme/seances', { replace: true });
        }}
      />
    </div>
  );
}

function ExercisePicker({ open, templateId, onClose, onPick, onCreated }: { open: boolean; templateId: string; onClose: () => void; onPick: (id: string) => void; onCreated: () => void }) {
  const [choices, setChoices] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (!open) return;
    setQ('');
    void call('exerciseChoices', null).then(setChoices);
  }, [open]);
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const shown = (q ? choices.filter((c) => norm(c.name).includes(norm(q))) : choices).slice(0, 30);
  const exact = choices.some((c) => norm(c.name) === norm(q.trim()));
  return (
    <>
      <Sheet open={open && !creating} title="Ajouter un exercice" onClose={onClose}>
        <div className="stack">
          <input className="input" aria-label="Chercher un exercice" placeholder="Chercher ou créer un exercice" value={q} onChange={(e) => setQ(e.target.value)} />
          {q.trim() && !exact && (
            <button type="button" className="pf-pick pf-create" onClick={() => setCreating(true)}>
              <span className="grow">{`Créer « ${q.trim()} »`}</span>
              <span className="pf-chip">nouveau</span>
            </button>
          )}
          <div className="stack-0">
            {shown.map((c) => (
              <button key={c.id} type="button" className="pf-pick" onClick={() => onPick(c.id)}>
                <span className="grow">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      </Sheet>
      <NewExerciseSheet
        open={open && creating}
        name={q.trim()}
        templateId={templateId}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          onCreated();
        }}
      />
    </>
  );
}

function RenameSheet({ open, name, onClose, onRename, onArchive }: { open: boolean; name: string; onClose: () => void; onRename: (n: string) => void; onArchive: () => void }) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name, open]);
  return (
    <Sheet open={open} title="Séance type" onClose={onClose}>
      <div className="stack">
        <Field id="pf-tpl-rename" label="Nom">
          <input id="pf-tpl-rename" value={value} maxLength={60} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Button variant="action" block disabled={!value.trim() || value.trim() === name} onClick={() => onRename(value)}>
          Renommer
        </Button>
        <Button variant="danger" block onClick={onArchive}>
          Archiver la séance type
        </Button>
        <span className="t-small muted">Archivée : elle quitte la semaine type ; tes séances passées la gardent.</span>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- un créneau

const FORMAT_TILES: readonly { base: FormatBase; label: string; hint: string }[] = [
  { base: 'sets', label: 'Séries', hint: 'séries × reps' },
  { base: 'emom', label: 'EMOM', hint: 'chaque minute' },
  { base: 'amrap', label: 'AMRAP', hint: 'tours en temps limité' },
  { base: 'hold', label: 'Au temps', hint: 'gainage, statique' },
  { base: 'for_time', label: 'Pour le temps', hint: 'chrono' },
];
const REST_PRESETS = [60, 90, 120, 150, 180, 240, 300];
const clock = (s: number) => (s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s / 60} min`);

export function SlotPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const date = today();
  const { data: s, error, reload } = useData<SlotDetail | null>(() => call('slotDetail', id, date), [id, date]);
  const [sheet, setSheet] = useState<'format' | 'progression' | 'group' | 'rest' | 'note' | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const save = async (patch: SlotPatch) => {
    try {
      await call('updateSlot', id, patch);
      setFailed(null);
      setSheet(null);
      reload();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
  };
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (s === null) return <Notice>Ce créneau n’existe plus.</Notice>;
  if (!s) return <span className="t-small muted">Lecture…</span>;
  const strategy = s.strategies.find((x) => x.id === s.strategy.id);
  const groupLabel = s.group ? `${s.group.kind === 'superset' ? 'superset' : 'circuit'} · ${s.group.rounds} tours` : 'non';
  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 110 }}>
      <div className="pf-amb" aria-hidden="true" />
      <Head back={`/sport/programme/seance/${s.templateId}`} kicker={s.templateName} title={s.exercise.name} />
      {failed && <Notice tone="bad">{failed}</Notice>}
      <List>
        <ListRow title="Format" value={<span className="pf-chip">{s.format.name}</span>} onClick={() => setSheet('format')} />
        <ListRow title="Progression" value={<span className="t-small muted">{strategy?.label ?? s.strategy.id}</span>} onClick={() => setSheet('progression')} />
        <ListRow title="Grouper avec le suivant" value={<span className="t-small muted">{s.canGroup || s.group ? groupLabel : 'dernier exercice'}</span>} onClick={s.canGroup || s.group ? () => setSheet('group') : undefined} />
        <ListRow title="Repos" value={<span className="t-small muted">{s.restSec ? clock(s.restSec) : `auto · ${clock(s.defaultRest)}`}</span>} onClick={() => setSheet('rest')} />
        <ListRow title="Consigne" value={<span className="t-small muted pf-nowrap" style={{ maxWidth: 170, display: 'inline-block' }}>{s.notes || 'aucune'}</span>} onClick={() => setSheet('note')} />
      </List>
      {s.preview && <span className="t-small muted" style={{ padding: '0 4px' }}>{`Prescrit aujourd’hui : ${s.preview}`}</span>}
      <Button
        variant="danger"
        block
        onClick={async () => {
          await call('removeSlot', id);
          navigate(`/sport/programme/seance/${s.templateId}`, { replace: true });
        }}
      >
        Retirer de la séance
      </Button>

      <FormatSheet open={sheet === 'format'} slot={s} onClose={() => setSheet(null)} onSave={(patch) => void save(patch)} />
      <ProgressionSheet open={sheet === 'progression'} slot={s} onClose={() => setSheet(null)} onSave={(strategy) => void save({ strategy })} />
      <GroupSheet open={sheet === 'group'} slot={s} onClose={() => setSheet(null)} onSave={(group) => void save({ group })} />
      <RestSheet open={sheet === 'rest'} slot={s} onClose={() => setSheet(null)} onSave={(restSec) => void save({ restSec })} />
      <NoteSheet open={sheet === 'note'} slot={s} onClose={() => setSheet(null)} onSave={(notes) => void save({ notes })} />
    </div>
  );
}

function FormatSheet({ open, slot, onClose, onSave }: { open: boolean; slot: SlotDetail; onClose: () => void; onSave: (patch: { format: FormatChoice; strategy?: SlotDetail['strategy'] }) => void }) {
  const [f, setF] = useState<FormatChoice>(slot.format);
  const reps = Number((slot.strategy.params as { reps?: number }).reps ?? 5);
  const [perMinute, setPerMinute] = useState(reps);
  useEffect(() => {
    if (!open) return;
    setF(slot.format);
    setPerMinute(reps);
  }, [open, slot, reps]);
  const pick = (base: FormatBase) => setF(base === slot.format.base ? slot.format : { base, load: base === 'sets' ? slot.exercise.loadType !== 'bodyweight' || slot.format.load !== false : false, everySec: 60, totalSec: 600, capSec: 480, workSec: 45 });
  const ok = () => {
    // EMOM : les reps par minute sont la progression (linéaire, la minute monte d'une rep quand tout est fait).
    if (f.base === 'emom') {
      const params = slot.strategy.id === 'linear' ? { ...slot.strategy.params, reps: perMinute, sets: 1 } : { sets: 1, reps: perMinute, step: 1, metric: 'reps' };
      return onSave({ format: f, strategy: { id: 'linear', params } });
    }
    onSave({ format: f });
  };
  return (
    <Sheet open={open} title="Format" onClose={onClose}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="pf-tiles">
          {FORMAT_TILES.map((t) => (
            <button key={t.base} type="button" className={`pf-tile${f.base === t.base ? ' is-on' : ''}`} aria-pressed={f.base === t.base} onClick={() => pick(t.base)}>
              {t.label}
              <span>{t.hint}</span>
            </button>
          ))}
        </div>
        {f.base === 'sets' && (
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className={`pf-chip${f.load !== false ? '' : ' is-neutral'}`} aria-pressed={f.load !== false} onClick={() => setF({ ...f, load: true })}>
              Charge × reps
            </button>
            <button type="button" className={`pf-chip${f.load === false ? '' : ' is-neutral'}`} aria-pressed={f.load === false} onClick={() => setF({ ...f, load: false })}>
              Reps seules
            </button>
          </div>
        )}
        {f.base === 'emom' && (
          <Glass className="pf-numlist">
            <NumberRow label="Toutes les" value={f.everySec ?? 60} unit="s" step={15} min={15} max={600} onChange={(v) => setF({ ...f, everySec: v, totalSec: Math.max(v, f.totalSec ?? 600) })} />
            <NumberRow label="Pendant" value={Math.round((f.totalSec ?? 600) / 60)} unit="min" min={1} max={120} onChange={(v) => setF({ ...f, totalSec: Math.max(f.everySec ?? 60, v * 60) })} />
            <NumberRow label="Reps par minute" value={perMinute} unit="reps" min={1} max={50} onChange={setPerMinute} />
          </Glass>
        )}
        {f.base === 'amrap' && (
          <Glass className="pf-numlist">
            <NumberRow label="Durée" value={Math.round((f.capSec ?? 480) / 60)} unit="min" min={1} max={120} onChange={(v) => setF({ ...f, capSec: v * 60 })} />
          </Glass>
        )}
        {f.base === 'hold' && (
          <Glass className="pf-numlist">
            <NumberRow label="Tenir" value={f.workSec ?? 45} unit="s" step={5} min={5} max={600} onChange={(v) => setF({ ...f, workSec: v })} />
          </Glass>
        )}
        <Button variant="action" block onClick={ok}>
          OK
        </Button>
      </div>
    </Sheet>
  );
}

function ParamInput({ spec, value, onChange }: { spec: ParamSpec; value: unknown; onChange: (v: unknown) => void }) {
  const id = `pf-param-${spec.key}`;
  if (spec.kind === 'metric')
    return (
      <Field id={id} label={spec.label}>
        <select id={id} value={String(value ?? spec.fallback ?? 'load')} onChange={(e) => onChange(e.target.value)}>
          <option value="load">Charge</option>
          <option value="reps">Reps</option>
          <option value="time">Temps</option>
        </select>
      </Field>
    );
  if (spec.kind === 'boolean')
    return (
      <label className="row" style={{ gap: 10 }}>
        <input type="checkbox" checked={Boolean(value ?? spec.fallback)} onChange={(e) => onChange(e.target.checked)} />
        {spec.label}
      </label>
    );
  const percent = spec.kind === 'percent';
  const shown = value === null || value === undefined || value === '' ? '' : String(percent ? Math.round(Number(value) * 1000) / 10 : value).replace('.', ',');
  return (
    <Field id={id} label={`${spec.label}${percent ? ' (%)' : ''}`}>
      <input
        id={id}
        inputMode="decimal"
        placeholder={spec.fallback === null ? 'auto' : String(spec.fallback)}
        value={shown}
        onChange={(e) => {
          const raw = e.target.value.replace(',', '.').trim();
          if (raw === '') return onChange(null);
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(percent ? n / 100 : n);
        }}
      />
    </Field>
  );
}

function ProgressionSheet({ open, slot, onClose, onSave }: { open: boolean; slot: SlotDetail; onClose: () => void; onSave: (s: SlotDetail['strategy']) => void }) {
  const [sid, setSid] = useState<StrategyId>(slot.strategy.id);
  const [params, setParams] = useState<Record<string, unknown>>(slot.strategy.params);
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSid(slot.strategy.id);
    setParams(slot.strategy.params);
    setAdvanced(false);
  }, [open, slot]);
  const spec = slot.strategies.find((x) => x.id === sid);
  const basic = spec?.params.filter((p) => !p.advanced) ?? [];
  const extra = spec?.params.filter((p) => p.advanced) ?? [];
  return (
    <Sheet open={open} title="Progression" onClose={onClose}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {slot.strategies.map((x) => (
            <button
              key={x.id}
              type="button"
              className={`pf-chip${x.id === sid ? '' : ' is-neutral'}`}
              aria-pressed={x.id === sid}
              onClick={() => {
                setSid(x.id);
                setParams(x.id === slot.strategy.id ? slot.strategy.params : {});
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
        {basic.map((p) => (
          <ParamInput key={p.key} spec={p} value={params[p.key]} onChange={(v) => setParams({ ...params, [p.key]: v })} />
        ))}
        {extra.length > 0 && (
          <>
            <button type="button" className="pf-link is-muted" style={{ alignSelf: 'flex-start' }} aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
              {advanced ? 'Moins de réglages' : 'Plus de réglages'}
            </button>
            {advanced && extra.map((p) => <ParamInput key={p.key} spec={p} value={params[p.key]} onChange={(v) => setParams({ ...params, [p.key]: v })} />)}
          </>
        )}
        {sid === 'percent_reference' && <span className="t-small muted">Séries, reps et % viennent du bloc en cours, semaine par semaine.</span>}
        <Button variant="action" block onClick={() => onSave({ id: sid, params })}>
          OK
        </Button>
      </div>
    </Sheet>
  );
}

function GroupSheet({ open, slot, onClose, onSave }: { open: boolean; slot: SlotDetail; onClose: () => void; onSave: (g: { kind: 'superset' | 'circuit'; rounds: number } | null) => void }) {
  const [kind, setKind] = useState<'none' | 'superset' | 'circuit'>(slot.group ? slot.group.kind : 'none');
  const [rounds, setRounds] = useState(slot.group?.rounds ?? 3);
  useEffect(() => {
    if (!open) return;
    setKind(slot.group ? slot.group.kind : 'none');
    setRounds(slot.group?.rounds ?? 3);
  }, [open, slot]);
  return (
    <Sheet open={open} title="Grouper avec le suivant" onClose={onClose}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 6 }}>
          {(['none', 'superset', 'circuit'] as const).map((k) => (
            <button key={k} type="button" className={`pf-chip${kind === k ? '' : ' is-neutral'}`} aria-pressed={kind === k} disabled={k !== 'none' && !slot.canGroup} onClick={() => setKind(k)}>
              {k === 'none' ? 'Non' : k === 'superset' ? 'Superset' : 'Circuit'}
            </button>
          ))}
        </div>
        {kind !== 'none' && (
          <Glass className="pf-numlist">
            <NumberRow label="Tours" value={rounds} unit="" min={1} max={20} onChange={setRounds} />
          </Glass>
        )}
        <span className="t-small muted">{kind === 'none' ? 'Chaque exercice à son tour, repos après chaque série.' : 'Les exercices s’enchaînent, le repos tombe à la fin du tour.'}</span>
        <Button variant="action" block onClick={() => onSave(kind === 'none' ? null : { kind, rounds })}>
          OK
        </Button>
      </div>
    </Sheet>
  );
}

function RestSheet({ open, slot, onClose, onSave }: { open: boolean; slot: SlotDetail; onClose: () => void; onSave: (s: number | null) => void }) {
  return (
    <Sheet open={open} title="Repos" onClose={onClose}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className={`pf-chip${slot.restSec === null ? '' : ' is-neutral'}`} aria-pressed={slot.restSec === null} onClick={() => onSave(null)}>
            {`Auto · ${clock(slot.defaultRest)}`}
          </button>
          {REST_PRESETS.map((sec) => (
            <button key={sec} type="button" className={`pf-chip${slot.restSec === sec ? '' : ' is-neutral'}`} aria-pressed={slot.restSec === sec} onClick={() => onSave(sec)}>
              {clock(sec)}
            </button>
          ))}
        </div>
        <span className="t-small muted">Auto : selon l’exercice et l’intention, réglable dans tes réglages de repos.</span>
      </div>
    </Sheet>
  );
}

function NoteSheet({ open, slot, onClose, onSave }: { open: boolean; slot: SlotDetail; onClose: () => void; onSave: (n: string) => void }) {
  const [text, setText] = useState(slot.notes);
  useEffect(() => setText(slot.notes), [open, slot.notes]);
  return (
    <Sheet open={open} title="Consigne" onClose={onClose}>
      <div className="stack">
        <textarea className="input pf-note" rows={3} maxLength={1000} aria-label="Consigne" placeholder="Prise, tempo, amplitude… (affichée en séance)" value={text} onChange={(e) => setText(e.target.value)} />
        <Button variant="action" block disabled={text.trim() === slot.notes.trim()} onClick={() => onSave(text)}>
          Enregistrer
        </Button>
      </div>
    </Sheet>
  );
}
