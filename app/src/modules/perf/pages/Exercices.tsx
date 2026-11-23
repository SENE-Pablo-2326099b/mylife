import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Field, Glass, Icon, IconButton, List, ListRow, Notice, Segmented, Sheet } from '@mylife/kit';
import { call } from '../data/client';
import { Body } from '../body/Body';
import type { BodyVolume, ExerciseDetail, ExerciseLine, ExercisesView, Region, RegionDetail } from '../data/exercises';
import type { RegionId } from '@mylife/training';
import type { TemplateSummary } from '../data/program';
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
  { id: 'program', label: 'Au programme' },
  { id: 'weighted', label: 'Lestés' },
  { id: 'barbell', label: 'Barre' },
  { id: 'dumbbell', label: 'Haltères' },
  { id: 'bodyweight', label: 'Poids du corps' },
  { id: 'time', label: 'Au temps' },
  { id: 'mine', label: 'À toi' },
];
/** La teinte d'un groupe musculaire : celle d'un module du kit (poussée, tirage, jambes, abdos). */
const TONE: Record<Region, string> = { push: 'tone-perf', pull: 'tone-finances', legs: 'tone-rave', core: 'tone-chef' };
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Les séances repliées, gardées sur l'appareil (simple confort d'affichage). */
const FOLD_KEY = 'mylife:perf:exercices:replies';
const readFolded = (): string[] | null => {
  try {
    const v = JSON.parse(localStorage.getItem(FOLD_KEY) ?? 'null') as unknown;
    return Array.isArray(v) ? v.map(String) : null;
  } catch {
    return null;
  }
};
const writeFolded = (ids: string[]) => {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(ids));
  } catch {
    /* stockage indisponible : le choix vaut pour cette visite */
  }
};
const LEVEL = [0, 0.35, 0.7, 1];

/** Le volume par muscle (comme l'ancien MyPerf) : séries dures par semaine, sur 7 ou 28 jours ; toucher une zone. */
function VolumeCard({ date }: { date: string }) {
  const [days, setDays] = useState(28);
  const [selected, setSelected] = useState<RegionId | null>(null);
  const [detail, setDetail] = useState<RegionDetail | null>(null);
  const [more, setMore] = useState(false);
  const { data: v } = useData<BodyVolume>(() => call('bodyVolume', date, days), [date, days]);
  useEffect(() => {
    setMore(false);
    if (!selected) return setDetail(null);
    void call('regionDetail', selected, date, days).then(setDetail);
  }, [selected, date, days]);
  if (!v) return null;
  const values = Object.fromEntries(v.regions.map((r) => [r.id, LEVEL[r.level]!])) as Partial<Record<RegionId, number>>;
  const trained = [...v.regions].filter((r) => r.perWeek > 0).sort((a, b) => b.perWeek - a.perWeek);
  const pick = (id: RegionId) => setSelected(selected === id ? null : id);
  return (
    <div className="card-module pf-volume">
      <div className="row" style={{ gap: 6 }}>
        <span className="grow t-strong">Volume par muscle</span>
        {[7, 28].map((n) => (
          <button key={n} type="button" className={`pf-chip${days === n ? '' : ' is-neutral'}`} aria-pressed={days === n} onClick={() => setDays(n)}>
            {`${n} j`}
          </button>
        ))}
      </div>
      <Body values={values} selected={selected} onSelect={pick} label={`Séries dures par semaine sur ${days} jours : ${trained.map((r) => `${r.label} ${r.perWeek}`).join(', ') || 'aucune'}`} />
      <div className="row t-label muted pf-legend">
        <span>0</span>
        <span className="pf-legend-bar" />
        <span>10+ séries / sem.</span>
      </div>
      <div className="pf-scrollchips" role="group" aria-label="Choisir un muscle">
        {(trained.length ? trained : v.regions).map((r) => (
          <button key={r.id} type="button" className={`pf-chip${selected === r.id ? '' : ' is-neutral'}`} aria-pressed={selected === r.id} onClick={() => pick(r.id)}>
            {r.perWeek > 0 ? `${r.label} ${r.perWeek.toLocaleString('fr-FR')}` : r.label}
          </button>
        ))}
      </div>
      {detail && (
        <div className="pf-region">
          <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
            <span className="grow pf-big" style={{ fontSize: 19 }}>
              {detail.label}
            </span>
            {detail.target && <span className="t-small muted">{`cible ${detail.target}`}</span>}
          </div>
          <span className="t-small">
            <b className="pf-big" style={{ fontSize: 22 }}>
              {detail.perWeek.toLocaleString('fr-FR')}
            </b>{' '}
            <span className="muted">{`séries / sem. sur ${days} j`}</span>
            {detail.indirect > 0 && <span className="muted">{` · + ${detail.indirect.toLocaleString('fr-FR')} en indirect`}</span>}
          </span>
          {detail.target && (
            <div className="progress">
              <span style={{ width: `${Math.min(100, Math.round((detail.perWeek / detail.target) * 100))}%`, background: 'var(--tone-grad)' }} />
            </div>
          )}
          <div className="pf-grp is-flat">
            {(more ? detail.exercises : detail.exercises.slice(0, 5)).map((l) => (
              <ExRow key={l.id} l={{ ...l, detail: `${l.role} · ${l.detail}` }} />
            ))}
          </div>
          {detail.exercises.length > 5 && (
            <button type="button" className="pf-link is-muted" style={{ alignSelf: 'center' }} onClick={() => setMore(!more)}>
              {more ? 'Moins' : `+ ${detail.exercises.length - 5} exercices`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Tile({ label, region, small }: { label: string; region: Region; small?: boolean }) {
  return (
    <span className={`pf-mt ${TONE[region]}${small ? ' is-small' : ''}`} aria-hidden="true">
      {label}
    </span>
  );
}

function ExRow({ l }: { l: ExerciseLine }) {
  return (
    <a className="pf-ex" href={`/sport/exercices/${l.id}`}>
      <Tile label={l.tile} region={l.region} />
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="t-strong">{l.name}</span>
        {l.tag && <span className="pf-tag" style={{ marginLeft: 6 }}>{l.tag}</span>}
        <br />
        <span className="t-small muted">{l.detail}</span>
      </span>
      <span className="pf-val">
        {l.value && <b>{l.value}</b>}
        <small>{l.valueLabel}</small>
      </span>
    </a>
  );
}

export function ExercisesPage() {
  const date = today();
  const { data: v, error, reload } = useData<ExercisesView>(() => call('exercisesView', date), [date]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const [folded, setFolded] = useState<string[] | null>(() => readFolded());
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!v) return <span className="t-small muted">Lecture des exercices…</span>;
  const searching = q.trim() !== '' || filter !== null;
  const found = searching ? v.all.filter((l) => (!filter || l.kinds.includes(filter)) && (!q || norm(`${l.name} ${l.detail}`).includes(norm(q)))) : [];
  // Par défaut, la première séance ouverte, les autres repliées ; ensuite, ton choix.
  const closed = folded ?? v.sessions.slice(1).map((x) => x.id);
  const toggle = (sid: string) => {
    const next = closed.includes(sid) ? closed.filter((x) => x !== sid) : [...closed, sid];
    setFolded(next);
    writeFolded(next);
  };
  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 110 }}>
      <div className="pf-amb" aria-hidden="true" />
      <Head back="/" kicker={`${v.total} exercices · ${v.inProgram} au programme`} title="Exercices" right={<IconButton icon="plus" label="Nouvel exercice" onClick={() => setCreating(true)} />} />
      <label className="glass pf-search">
        <Icon name="search" size={18} />
        <input aria-label="Chercher un exercice" placeholder="Chercher un exercice, un muscle" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="pf-scrollchips" role="group" aria-label="Filtres">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`pf-chip${filter === f.id ? '' : ' is-neutral'}`} aria-pressed={filter === f.id} onClick={() => setFilter(filter === f.id ? null : f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {!searching && <VolumeCard date={date} />}

      {searching ? (
        found.length ? (
          <>
            <span className="pf-sec">
              <span>Résultats</span>
              <span>{found.length}</span>
            </span>
            <Glass className="pf-grp">
              {found.map((l) => (
                <ExRow key={l.id} l={l} />
              ))}
            </Glass>
          </>
        ) : (
          <span className="t-small muted" style={{ textAlign: 'center' }}>
            Aucun exercice ne correspond.
          </span>
        )
      ) : (
        <>
          {v.sessions.length > 0 && (
            <>
              <span className="pf-sec">
                <span>Au programme · par séance</span>
                <span>{v.inProgram}</span>
              </span>
              {v.sessions.map((s) => {
                const isOpen = !closed.includes(s.id);
                return (
                  <Glass key={s.id} className="pf-grp">
                    <button type="button" className="pf-gh" aria-expanded={isOpen} onClick={() => toggle(s.id)}>
                      {s.day && <span>{s.day}</span>}
                      <b className="grow">{s.name}</b>
                      <span className="pf-gh-count">{isOpen ? '' : `${s.lines.length} exercice${s.lines.length > 1 ? 's' : ''}`}</span>
                      <span className={`pf-chev${isOpen ? ' is-open' : ''}`} aria-hidden="true">
                        ›
                      </span>
                    </button>
                    {isOpen && s.lines.map((l) => <ExRow key={l.id} l={l} />)}
                  </Glass>
                );
              })}
            </>
          )}
          <span className="pf-sec">
            <span>Bibliothèque · par muscle</span>
            <span>{v.library.reduce((n, g) => n + g.lines.length, 0)}</span>
          </span>
          <Glass className="pf-grp">
            {v.library.map((g) => (
              <div key={g.id} className="pf-fold-wrap">
                <button type="button" className="pf-fold" aria-expanded={open === g.id} onClick={() => setOpen(open === g.id ? null : g.id)}>
                  <Tile label={g.tile} region={g.region} small />
                  <span className="grow t-strong">{g.label}</span>
                  <span className="t-small muted">{`${g.lines.length} ${open === g.id ? '⌃' : '›'}`}</span>
                </button>
                {open === g.id && g.lines.map((l) => <ExRow key={l.id} l={l} />)}
              </div>
            ))}
          </Glass>
        </>
      )}

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
const MUSCLE_NAME = Object.fromEntries(MUSCLES) as Record<string, string>;

function Curve({ points, reference }: { points: { date: string; value: number }[]; reference: number | null }) {
  const values = [...points.map((p) => p.value), ...(reference !== null ? [reference] : [])];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const y = (v: number) => 90 - ((v - min) / span) * 76;
  const x = (i: number) => (points.length < 2 ? 160 : (i / (points.length - 1)) * 320);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!;
  return (
    <svg viewBox="0 0 320 100" width="100%" height="100" role="img" aria-label={`1RM estimé, de ${points[0]!.value} à ${last.value} kg`}>
      <defs>
        <linearGradient id="pf-curve" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--tone-solid)" stopOpacity=".35" />
          <stop offset="1" stopColor="var(--tone-solid)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {reference !== null && <line x1="0" x2="320" y1={y(reference)} y2={y(reference)} stroke="var(--ink-2)" strokeOpacity=".5" strokeDasharray="4 5" />}
      <path d={`M${x(0)} ${y(points[0]!.value)} L${line.replace(/ /g, ' L')} L320 100 L0 100 Z`} fill="url(#pf-curve)" />
      <polyline points={line} fill="none" stroke="var(--tone-solid)" strokeWidth="2.5" />
      <circle cx={x(points.length - 1)} cy={y(last.value)} r="4" fill="var(--tone-solid)" />
    </svg>
  );
}

export function ExercisePage() {
  const { id = '' } = useParams();
  const date = today();
  const navigate = useNavigate();
  const { data: e, error, reload } = useData<ExerciseDetail | null>(() => call('exerciseDetail', id, date), [id, date]);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['id']>('3M');
  const [panel, setPanel] = useState<'loads' | 'records' | 'history'>('loads');
  const [sheet, setSheet] = useState<'edit' | 'reference' | 'variant' | 'add' | null>(null);
  const [kept, setKept] = useState(false);
  const [region, setRegion] = useState<RegionId | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    setKept(false);
    setRegion(null);
  }, [id]);
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
  // Le corps de la fiche : chaque zone selon le volume fait avec cet exercice (28 jours) ; sans séance, selon son rôle.
  const values = Object.fromEntries(e.regions.map((r) => [r.id, r.perWeek > 0 ? Math.min(1, 0.3 + r.perWeek / 10) : r.role === 'principal' ? 0.45 : 0.2])) as Partial<Record<RegionId, number>>;
  const zone = e.regions.find((r) => r.id === region) ?? null;
  const panels = [
    { id: 'loads' as const, label: 'Charges', show: e.loads.length > 0 },
    { id: 'records' as const, label: 'Records', show: e.records.length > 0 },
    { id: 'history' as const, label: 'Historique', show: e.history.length > 0 },
  ].filter((x) => x.show);
  const shown = panels.find((x) => x.id === panel) ? panel : panels[0]?.id;
  const best = e.records.find((r) => r.label === 'Meilleure série');
  const hasRef = e.reference?.source === 'saisi' || e.estimate !== null;
  const loadBased = e.loads.length > 0 || e.usesReference || e.category === 'main';
  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 110 }}>
      <div className="pf-amb" aria-hidden="true" />
      <Head back="/sport/exercices" kicker={e.context} title={e.name} right={<IconButton icon="settings" label="Modifier l’exercice" onClick={() => setSheet('edit')} />} />
      {failed && <Notice tone="bad">{failed}</Notice>}

      <div className="card-module pf-exhero">
        <Body values={values} selected={region} onSelect={(r) => setRegion(region === r ? null : r)} label={`Muscles : ${e.primary.map((m) => MUSCLE_NAME[m]).join(', ')}${e.secondary.length ? ` ; secondaires : ${e.secondary.map((m) => MUSCLE_NAME[m]).join(', ')}` : ''}`} />
        <div className="pf-facts">
          <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {e.chips.map((c, i) => (
              <span key={c} className={`pf-chip${i ? ' is-neutral' : ''}`}>
                {c}
              </span>
            ))}
          </span>
          <span className="t-small">
            <b>{e.primary.map((m) => MUSCLE_NAME[m]).join(', ')}</b>
            {e.secondary.length > 0 && <span className="muted">{` · ${e.secondary.map((m) => MUSCLE_NAME[m]?.toLowerCase()).join(', ')}`}</span>}
          </span>
          {e.variantOf && (
            <a className="t-small c-tone" href={`/sport/exercices/${e.variantOf.id}`}>
              {`variante de ${e.variantOf.name}`}
            </a>
          )}
          <span className="t-small muted">{e.inTemplates.length ? `Dans : ${e.inTemplates.join(', ')}` : e.createdOn ? `Créé le ${e.createdOn}` : 'Pas encore dans tes séances'}</span>
          {e.variants.length > 0 && <span className="t-small muted">{`Variantes : ${e.variants.map((v) => v.name).join(', ')}`}</span>}
        </div>
        {zone ? (
          <div className="pf-zoneinfo">
            <b>{zone.label}</b>
            <span className="muted">{` · ${zone.role}${zone.indirect ? ' (indirect)' : ''} · `}</span>
            {zone.perWeek > 0 ? `${zone.perWeek.toLocaleString('fr-FR')} séries / sem. avec cet exercice` : 'pas de série ces 28 jours'}
            <span className="muted">{` · ${zone.total.toLocaleString('fr-FR')} au total`}</span>
          </div>
        ) : (
          e.regions.length > 0 && (
            <div className="pf-scrollchips pf-zonechips" role="group" aria-label="Muscles travaillés">
              {e.regions.map((r) => (
                <button key={r.id} type="button" className={`pf-chip${r.role === 'principal' ? '' : ' is-neutral'}`} onClick={() => setRegion(r.id)}>
                  {r.perWeek > 0 ? `${r.label} ${r.perWeek.toLocaleString('fr-FR')}` : r.label}
                </button>
              ))}
            </div>
          )
        )}
      </div>

      {hasRef ? (
        <Glass className="pf-refcard">
          <div className="pf-two">
            <button type="button" className="pf-stat-big" onClick={() => setSheet('reference')}>
              <span className="t-label muted">1RM de référence</span>
              <span className="pf-big" style={{ fontSize: 30 }}>
                {e.reference?.source === 'saisi' ? e.reference.text.replace(' kg', '') : 'à saisir'}
              </span>
              <span className="t-small muted">{e.reference?.source === 'saisi' ? `${unit} · ${e.reference.when}` : 'toucher pour saisir'}</span>
            </button>
            <span className="pf-stat-big">
              <span className="t-label muted">Estimé</span>
              <span className="pf-big c-tone" style={{ fontSize: 30 }}>
                {e.estimate ? e.estimate.text.replace(' kg', '') : '…'}
              </span>
              <span className="t-small muted">{e.estimate ? `${unit}${e.estimate.delta ? ` · ${e.estimate.delta}` : ''}` : ''}</span>
            </span>
          </div>
          {e.proposal && !kept && (
            <div className="row pf-proposal">
              <span className="grow t-small">
                Passer à <b>{e.proposal.text}</b> ?
              </span>
              <Button onClick={() => setKept(true)}>Garder</Button>
              <Button variant="action" onClick={() => void act(call('setReference', e.id, e.proposal!.value, date))}>
                Appliquer
              </Button>
            </div>
          )}
        </Glass>
      ) : (
        <Glass className="pf-refcard" >
          <span className="t-strong">Pas encore de repère</span>
          <span className="t-small muted">{loadBased ? 'Saisis ton 1RM, ou fais une séance : il s’estimera tout seul.' : 'Il apparaîtra après ta première séance.'}</span>
          {loadBased && (
            <Button variant="action" block onClick={() => setSheet('reference')}>
              Saisir mon 1RM
            </Button>
          )}
        </Glass>
      )}

      {e.curve.length >= 2 && (
        <Glass className="pf-curvecard">
          <div className="row" style={{ gap: 4 }}>
            <span className="grow t-strong">Progression</span>
            {PERIODS.map((p) => (
              <button key={p.id} type="button" className={`pf-chip${period === p.id ? '' : ' is-neutral'}`} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>
                {p.id}
              </button>
            ))}
          </div>
          {points.length >= 2 ? <Curve points={points} reference={e.reference?.source === 'saisi' ? e.reference.value : null} /> : <span className="t-small muted">Pas de séance sur cette période.</span>}
          <span className="t-small muted">{`${points.length} séance${points.length > 1 ? 's' : ''}${period === 'Tout' ? '' : ` en ${period === '1M' ? '1 mois' : `${period[0]} mois`}`}${best ? ` · meilleure série ${best.value}${best.when ? ` (${best.when})` : ''}` : ''}`}</span>
        </Glass>
      )}

      {panels.length > 0 && shown && (
        <>
          <div className="glass segmented" role="group" aria-label="Détail">
            {panels.map((x) => (
              <button key={x.id} type="button" aria-pressed={shown === x.id} onClick={() => setPanel(x.id)}>
                {x.label}
              </button>
            ))}
          </div>
          {shown === 'loads' && (
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
                    <td className="pf-tl">{e.weighted ? 'lest' : 'kg'}</td>
                    {e.loads.map((l) => (
                      <td key={l.reps}>{l.text}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </Glass>
          )}
          {shown === 'records' && (
            <List>
              {e.records.map((r) => (
                <ListRow key={r.label} title={r.label} value={<span className="row" style={{ gap: 8 }}><b>{r.value}</b>{r.when && <span className="pf-chip">{r.when}</span>}</span>} />
              ))}
            </List>
          )}
          {shown === 'history' && (
            <List>
              {e.history.slice(0, 12).map((x, i) => (
                <ListRow key={i} title={x.summary} detail={`${x.when} · ${x.name}`} />
              ))}
            </List>
          )}
        </>
      )}

      <div className="row" style={{ gap: 8 }}>
        <div className="grow">
          <Button variant={e.inTemplates.length ? 'secondary' : 'action'} block onClick={() => setSheet('add')}>
            Ajouter à une séance
          </Button>
        </div>
        <Button onClick={() => setSheet('variant')}>+ Variante</Button>
      </div>

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
      <AddToSessionSheet open={sheet === 'add'} exercise={e} onClose={() => setSheet(null)} onPick={(templateId) => void act(call('addSlot', templateId, e.id))} />
    </div>
  );
}

function AddToSessionSheet({ open, exercise, onClose, onPick }: { open: boolean; exercise: ExerciseDetail; onClose: () => void; onPick: (templateId: string) => void }) {
  const [list, setList] = useState<TemplateSummary[]>([]);
  useEffect(() => {
    if (open) void call('templatesView').then(setList);
  }, [open]);
  return (
    <Sheet open={open} title="Ajouter à une séance" onClose={onClose}>
      <div className="stack">
        {list.length ? (
          <List>
            {list.map((t) => {
              const already = exercise.inTemplates.includes(t.name);
              return <ListRow key={t.id} title={t.name} detail={already ? 'déjà dedans · l’ajouter encore' : `${t.exercises.length} exercice${t.exercises.length > 1 ? 's' : ''}`} onClick={() => onPick(t.id)} />;
            })}
          </List>
        ) : (
          <span className="t-small muted">Pas encore de séance type : crée-en une dans Programme.</span>
        )}
      </div>
    </Sheet>
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
