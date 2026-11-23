import { useState } from 'react';
import { Button, Field, Glass, List, ListRow, Notice, Sheet } from '@mylife/kit';
import { call } from '../data/client';
import type { ProgressView, ProgressWindow } from '../data/progress';
import { Head } from './common';
import { errorText, today, useData } from './util';
import { VolumeCard } from './Volume';
import '../perf.css';

/**
 * Les progrès (maquettes V3-Progres et V3-Progres-libre, validées le 22/11). Avec des lifts au % du 1RM : le corps et
 * le volume par muscle, les lifts (référence, estimé en lest net, tendance), les plateaux (« Copilot », « Masquer :
 * voulu »), la régularité, le poids du corps. Sans : les chiffres de la période, ce qui monte dans la grandeur de chaque
 * exercice, les séries par muscle, la régularité.
 */
const HIDE_KEY = 'mylife:perf:plateaux-masques';
const readHidden = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(HIDE_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};
const fr = (n: number) => n.toLocaleString('fr-FR');

function Spark({ values, rising }: { values: number[]; rising: boolean | null }) {
  if (values.length < 2) return <span style={{ width: 62 }} />;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 70).toFixed(1)},${(19 - ((v - min) / span) * 16).toFixed(1)}`).join(' ');
  return (
    <svg viewBox="0 0 70 22" width="62" height="22" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={rising === false ? 'var(--ink-2)' : 'var(--tone-solid)'} strokeOpacity={rising === false ? 0.6 : 1} strokeWidth="2.5" />
    </svg>
  );
}

export function ProgresPage() {
  const date = today();
  const [win, setWin] = useState<ProgressWindow>(28);
  const [hidden, setHidden] = useState<string[]>(() => readHidden());
  const [body, setBody] = useState(false);
  const [weighing, setWeighing] = useState(false);
  const { data: v, error, reload } = useData<ProgressView>(() => call('progressView', date, win, hidden), [date, win, hidden.join(',')]);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!v) return <span className="t-small muted">Lecture de tes progrès…</span>;
  const hide = (key: string) => {
    const next = [...hidden, key];
    setHidden(next);
    try {
      localStorage.setItem(HIDE_KEY, JSON.stringify(next));
    } catch {
      /* stockage indisponible : masqué pour cette visite */
    }
  };
  const windows: { id: ProgressWindow; label: string }[] = [
    { id: 7, label: '7 jours' },
    { id: 28, label: '28 jours' },
    ...(v.window.cycle ? [{ id: 'cycle' as const, label: 'Ce cycle' }] : []),
  ];
  const max = Math.max(1, ...v.muscles.map((m) => m.sets));
  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 110 }}>
      <div className="pf-amb" aria-hidden="true" />
      <Head back="/" kicker={v.subtitle} title="Progrès" />
      <div className="row" style={{ gap: 6 }}>
        {windows.map((w) => (
          <button key={String(w.id)} type="button" className={`pf-chip${win === w.id ? '' : ' is-neutral'}`} aria-pressed={win === w.id} onClick={() => setWin(w.id)}>
            {w.label}
          </button>
        ))}
      </div>

      {v.profile === 'free' && (
        <div className="pf-stats3">
          <span className="pf-statbox">
            <span className="t-label muted">Séances</span>
            <b className="pf-big">{v.stats.sessions}</b>
            <span className="t-small muted">{v.stats.planned ? `sur ${v.stats.planned}` : 'faites'}</span>
          </span>
          <span className="pf-statbox">
            <span className="t-label muted">Temps</span>
            <b className="pf-big">{v.stats.minutes >= 60 ? `${Math.floor(v.stats.minutes / 60)} h ${String(v.stats.minutes % 60).padStart(2, '0')}` : `${v.stats.minutes} min`}</b>
            <span className="t-small muted">{v.stats.sessions ? `${Math.round(v.stats.minutes / v.stats.sessions)} min / séance` : '—'}</span>
          </span>
          <span className="pf-statbox">
            <span className="t-label muted">Records</span>
            <b className="pf-big">{v.stats.records}</b>
            <span className="t-small muted">{`sur ${v.window.days} j`}</span>
          </span>
        </div>
      )}

      {v.profile === 'lifts' && <VolumeCard date={date} days={v.window.days} />}

      {v.profile === 'lifts' && v.lifts.length > 0 && (
        <>
          <span className="pf-sec">
            <span>Lifts principaux</span>
            <span>1RM réf. · estimé</span>
          </span>
          <List>
            {v.lifts.map((l) => (
              <ListRow
                key={l.exerciseId}
                href={`/sport/exercices/${l.exerciseId}`}
                title={<span className="t-strong">{l.name}</span>}
                value={
                  <span className="row" style={{ gap: 10 }}>
                    <Spark values={l.trend} rising={l.rising} />
                    <span className="pf-val" style={{ minWidth: 76 }}>
                      {l.reference || l.estimate ? <b>{l.reference ?? `${l.estimate} kg`}</b> : <small>pas encore</small>}
                      {l.reference && l.estimate && <small className={l.rising ? 'c-tone' : undefined}>{`${l.estimate} est.`}</small>}
                    </span>
                  </span>
                }
              />
            ))}
          </List>
        </>
      )}

      {v.plateaus.map((p) => (
        <div key={p.exerciseId} className="notice notice-warn pf-plateau">
          <span className="grow">
            <b>Plateau</b>
            {` · ${p.name}, ${p.cycles} cycles`}
          </span>
          <a className="btn btn-quiet" href={`/copilot?domaine=sport&q=${encodeURIComponent(`Mon ${p.name} stagne depuis ${p.cycles} cycles : qu'est-ce que tu proposes ?`)}`}>
            Copilot
          </a>
          <button type="button" className="btn btn-quiet" onClick={() => hide(`${p.exerciseId}:${p.cycles}`)}>
            Masquer : voulu
          </button>
        </div>
      ))}

      {v.profile === 'free' && v.ups.length > 0 && (
        <>
          <span className="pf-sec">
            <span>Ce qui monte</span>
            <span>{`sur ${v.window.days} j`}</span>
          </span>
          <List>
            {v.ups.map((u) => (
              <ListRow
                key={u.exerciseId}
                href={`/sport/exercices/${u.exerciseId}`}
                title={<span className="t-strong">{u.name}</span>}
                detail={u.metric}
                value={
                  <span className="pf-val">
                    <b>{u.now}</b>
                    <small className={u.better && u.before ? 'c-tone' : undefined}>{u.before ? (u.better ? `était ${u.before}` : 'stable') : 'nouveau'}</small>
                  </span>
                }
              />
            ))}
          </List>
        </>
      )}

      {v.profile === 'free' && v.muscles.length > 0 && (
        <>
          <span className="pf-sec">
            <span>Séries par muscle</span>
            <span>{`${v.window.days} jours`}</span>
          </span>
          <Glass className="pf-bars">
            {v.muscles.slice(0, 4).map((m) => (
              <div key={m.id} className="pf-bar">
                <div className="row t-small">
                  <span className="grow">{m.label}</span>
                  <b>{m.sets}</b>
                </div>
                <div className="progress">
                  <span style={{ width: `${Math.round((m.sets / max) * 100)}%`, background: 'var(--tone-grad)' }} />
                </div>
              </div>
            ))}
            <button type="button" className="pf-link is-muted" style={{ alignSelf: 'flex-start', padding: 0 }} aria-expanded={body} onClick={() => setBody(!body)}>
              {body ? 'Moins' : 'Le corps en détail ›'}
            </button>
          </Glass>
          {body && <VolumeCard date={date} days={v.window.days} />}
        </>
      )}

      <span className="pf-sec">
        <span>Régularité · 14 semaines</span>
        <span>{`${v.consistency.total} séance${v.consistency.total > 1 ? 's' : ''} · ${fr(v.consistency.perWeek)} / sem.`}</span>
      </span>
      <Glass className="pf-weeksgrid">
        {v.consistency.weeks.map((w, i) => (
          <span key={w.start} className={`pf-wkbar is-l${w.level}${i === v.consistency.weeks.length - 1 ? ' is-now' : ''}`} title={`Semaine du ${new Date(`${w.start}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} : ${w.sessions} séance${w.sessions > 1 ? 's' : ''}`} />
        ))}
      </Glass>

      <List>
        <ListRow
          title="Poids du corps"
          detail={v.bodyweight?.rate !== null && v.bodyweight?.rate !== undefined ? `${v.bodyweight.rate > 0 ? '+' : ''}${fr(v.bodyweight.rate)} kg / sem.` : undefined}
          value={v.bodyweight ? <span className="pf-val"><b>{`${fr(v.bodyweight.value)} kg`}</b><small>{`moy. 7 j ${fr(v.bodyweight.average)}`}</small></span> : <span className="t-small muted">à noter</span>}
          onClick={() => setWeighing(true)}
        />
      </List>

      <WeightSheet
        open={weighing}
        onClose={() => setWeighing(false)}
        onSaved={() => {
          setWeighing(false);
          reload();
        }}
      />
    </div>
  );
}

function WeightSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <Sheet open={open} title="Poids du jour" onClose={onClose}>
      <div className="stack">
        {failed && <Notice tone="bad">{failed}</Notice>}
        <Field id="pf-weigh" label="Poids (kg)">
          <input id="pf-weigh" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </Field>
        <Button
          variant="action"
          block
          disabled={!text.trim()}
          onClick={async () => {
            try {
              await call('addBodyweight', today(), Number(text.replace(',', '.')));
              setText('');
              onSaved();
            } catch (e) {
              setFailed(errorText(e));
            }
          }}
        >
          Noter
        </Button>
      </div>
    </Sheet>
  );
}
