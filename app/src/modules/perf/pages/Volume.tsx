import { useEffect, useState } from 'react';
import type { RegionId } from '@mylife/training';
import { Body } from '../body/Body';
import { call } from '../data/client';
import type { BodyVolume, ExerciseLine, Region, RegionDetail } from '../data/exercises';
import { useData } from './util';

/** La teinte d'un groupe musculaire : celle d'un module du kit (poussée, tirage, jambes, abdos). */
const TONE: Record<Region, string> = { push: 'tone-perf', pull: 'tone-finances', legs: 'tone-rave', core: 'tone-chef' };

const LEVEL = [0, 0.35, 0.7, 1];

/** Le volume par muscle (comme l'ancien MyPerf) : séries dures par semaine, sur 7 ou 28 jours ; toucher une zone. */
/** Le volume par muscle de la page Progrès. `days` : la période de la page ; sinon `choose` affiche le choix 7 / 28 jours. */
export function VolumeCard({ date, days: fixed, choose }: { date: string; days?: number; choose?: boolean }) {
  const [own, setDays] = useState(28);
  const days = fixed ?? own;
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
        {choose && [7, 28].map((n) => (
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

export function Tile({ label, region, small }: { label: string; region: Region; small?: boolean }) {
  return (
    <span className={`pf-mt ${TONE[region]}${small ? ' is-small' : ''}`} aria-hidden="true">
      {label}
    </span>
  );
}

export function ExRow({ l }: { l: ExerciseLine }) {
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

