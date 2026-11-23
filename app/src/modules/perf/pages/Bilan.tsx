import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, List, ListRow, Notice } from '@mylife/kit';
import { call } from '../data/client';
import type { SessionReport } from '../data/report';
import { errorText, useData } from './util';
import '../perf.css';

/**
 * Le bilan d'une séance (maquette V3-Bilan, validée le 22/11) : séries, tonnage et records ; chaque exercice par
 * rapport au plan ; la forme et une note pour la prochaine fois ; Copilot, partager, terminer.
 */
const VERDICT: Record<SessionReport['exercises'][number]['verdict'], { label: string; cls: string }> = {
  record: { label: 'Record', cls: '' },
  'au-dessus': { label: 'au-dessus', cls: ' is-ok' },
  conforme: { label: 'conforme', cls: ' is-neutral' },
  'en dessous': { label: 'en dessous', cls: ' is-neutral' },
  partiel: { label: 'partiel', cls: ' is-neutral' },
  libre: { label: 'fait', cls: ' is-neutral' },
};

export function BilanPage() {
  const { id = '' } = useParams();
  const { data: r, error } = useData<SessionReport | null>(() => call('sessionReport', id), [id]);
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  useEffect(() => {
    if (!r) return;
    setRating(r.rating);
    setNotes(r.notes);
  }, [r]);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (r === null) return <Notice>Cette séance n’existe plus.</Notice>;
  if (!r) return <span className="t-small muted">Lecture du bilan…</span>;
  const save = async (next: number | null, text: string) => {
    try {
      await call('rateSession', id, next, text);
    } catch (e) {
      setNote({ tone: 'bad', text: errorText(e) });
    }
  };
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: r.name, text: r.share });
      else {
        await navigator.clipboard.writeText(r.share);
        setNote({ tone: 'ok', text: 'Bilan copié.' });
      }
    } catch {
      /* partage annulé */
    }
  };
  const question = `Fais-moi le point sur ma séance « ${r.name} » du ${new Date(`${r.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} : ${r.exercises.map((x) => `${x.name} ${x.summary} (${x.verdict})`).join(' ; ')}.`;
  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 60 }}>
      <div className="pf-amb" aria-hidden="true" />
      <header style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 12 }}>
        <span className="pf-kick">{r.kicker}</span>
        <h1 className="t-screen" style={{ fontSize: 40, lineHeight: '46px' }}>
          Bien joué.
        </h1>
      </header>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <div className="pf-stats3">
        <span className="pf-statbox">
          <span className="t-label muted">Séries</span>
          <b className="pf-big">{r.sets.done}</b>
          <span className="t-small muted">{r.sets.planned ? `sur ${r.sets.planned}` : 'faites'}</span>
        </span>
        <span className="pf-statbox">
          <span className="t-label muted">Tonnage</span>
          <b className="pf-big">{r.tonnage.kg >= 1000 ? `${(r.tonnage.kg / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} t` : `${r.tonnage.kg} kg`}</b>
          <span className={`t-small${r.tonnage.delta?.startsWith('+') ? ' c-tone' : ' muted'}`}>{r.tonnage.delta ?? 'première fois'}</span>
        </span>
        <span className="pf-statbox">
          <span className="t-label muted">Records</span>
          <b className="pf-big">{r.records.length}</b>
          <span className="t-small muted pf-nowrap">{r.records.length ? r.records.map((x) => x.name.split(' ')[0]!.toLowerCase()).join(', ') : 'pas cette fois'}</span>
        </span>
      </div>

      {r.exercises.length > 0 && (
        <>
          <span className="pf-sec">
            <span>Par rapport au plan</span>
            <span />
          </span>
          <List>
            {r.exercises.map((x) => (
              <ListRow
                key={x.exerciseId}
                href={`/sport/exercices/${x.exerciseId}`}
                title={<span className="t-strong">{x.name}</span>}
                detail={x.summary}
                value={<span className={`pf-chip${x.next ? ' is-ok' : VERDICT[x.verdict].cls}`}>{x.verdict === 'record' ? 'Record' : (x.next ?? VERDICT[x.verdict].label)}</span>}
              />
            ))}
          </List>
        </>
      )}

      <div className="card-module pf-hero" style={{ gap: 10 }}>
        <span className="pf-kick c-tone">Note de la séance</span>
        <div className="row" role="group" aria-label="Forme, de 1 à 5" style={{ gap: 6 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={`pf-chip${rating === n ? '' : ' is-neutral'}`}
              aria-pressed={rating === n}
              onClick={() => {
                const next = rating === n ? null : n;
                setRating(next);
                void save(next, notes);
              }}
            >
              {n}
            </button>
          ))}
          <span className="t-small muted" style={{ marginLeft: 4 }}>
            forme
          </span>
        </div>
        <input className="input" aria-label="Note" placeholder="Une note pour la prochaine fois" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} onBlur={() => void save(rating, notes)} />
      </div>

      <a className="btn btn-secondary" href={`/copilot?domaine=sport&q=${encodeURIComponent(question)}`} style={{ justifyContent: 'flex-start', gap: 10 }}>
        <span className="pf-copilot" aria-hidden="true">
          ✦
        </span>
        Demander à Copilot
      </a>
      <div className="row" style={{ gap: 8 }}>
        <Button onClick={() => void share()}>Partager</Button>
        <div className="grow">
          <Button variant="action" block href="/sport" onClick={() => void save(rating, notes)}>
            Terminer
          </Button>
        </div>
      </div>
    </div>
  );
}
