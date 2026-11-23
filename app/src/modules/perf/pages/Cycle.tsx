import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, List, ListRow, Notice } from '@mylife/kit';
import { call } from '../data/client';
import type { CycleReport } from '../data/cycleReport';
import { Head } from './common';
import { errorText, today, useData } from './util';
import '../perf.css';

/**
 * Le bilan d'un bloc (maquette V3-Cycle, validée le 22/11) : séances, records, forme ; les nouveaux 1RM de référence
 * proposés (à appliquer tous ou au choix) ; le bloc suivant ; faire le point avec Copilot.
 */
export function CyclePage() {
  const { id = '' } = useParams();
  const date = today();
  const navigate = useNavigate();
  const { data: c, error, reload } = useData<CycleReport | null>(() => call('cycleReport', id, date), [id, date]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  useEffect(() => {
    if (c) setChosen(c.proposals.filter((p) => p.changed).map((p) => p.exerciseId));
  }, [c]);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (c === null) return <Notice>Ce bloc n’existe plus.</Notice>;
  if (!c) return <span className="t-small muted">Lecture du bilan…</span>;
  const apply = async () => {
    try {
      for (const p of c.proposals.filter((x) => chosen.includes(x.exerciseId))) await call('setReference', p.exerciseId, p.value, date);
      setNote({ tone: 'ok', text: `${chosen.length} 1RM de référence mis à jour.` });
      reload();
    } catch (e) {
      setNote({ tone: 'bad', text: errorText(e) });
    }
  };
  const next = async () => {
    if (c.next) return navigate('/sport/programme');
    try {
      const created = await call('saveBlock', null, {}, date);
      navigate(`/sport/programme/bloc/${created}`);
    } catch (e) {
      setNote({ tone: 'bad', text: errorText(e) });
    }
  };
  const question = `Fais le point sur mon bloc « ${c.name} » (${c.kind}, ${c.dates}) : ${c.sessions.done} séances sur ${c.sessions.planned}, ${c.records} records${c.rating ? `, forme moyenne ${c.rating} sur 5` : ''}. Propositions de 1RM : ${c.proposals.map((p) => `${p.name} ${p.from ?? '?'} → ${p.to}`).join(', ')}. Qu'est-ce que tu conseilles pour la suite ?`;
  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 110 }}>
      <div className="pf-amb" aria-hidden="true" />
      <Head back="/sport/programme" kicker={`${c.ended ? 'Fin du bloc' : 'Bloc en cours'} ${c.name} · ${c.weeks} semaines`} title={c.ended ? 'Bloc terminé' : 'Où en est le bloc'} />
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <div className="pf-stats3">
        <span className="pf-statbox">
          <span className="t-label muted">Séances</span>
          <b className="pf-big">{c.sessions.done}</b>
          <span className="t-small muted">{`sur ${c.sessions.planned}`}</span>
        </span>
        <span className="pf-statbox">
          <span className="t-label muted">Records</span>
          <b className="pf-big">{c.records}</b>
          <span className="t-small muted">{`sur ${c.weeks} semaines`}</span>
        </span>
        <span className="pf-statbox">
          <span className="t-label muted">Forme</span>
          <b className="pf-big">{c.rating === null ? '—' : c.rating.toLocaleString('fr-FR')}</b>
          <span className="t-small muted">{c.rating === null ? 'pas notée' : 'sur 5'}</span>
        </span>
      </div>

      {c.proposals.length > 0 && (
        <div className="card-module pf-hero" style={{ gap: 10 }}>
          <span className="pf-kick c-tone">Nouveaux 1RM de référence proposés</span>
          <div className="pf-lines">
            {c.proposals.map((p) => {
              const on = chosen.includes(p.exerciseId);
              return (
                <button key={p.exerciseId} type="button" className="pf-line pf-propose" aria-pressed={on} onClick={() => setChosen(on ? chosen.filter((x) => x !== p.exerciseId) : [...chosen, p.exerciseId])}>
                  <span className={`pf-check${on ? ' is-on' : ''}`} aria-hidden="true">
                    {on ? '✓' : ''}
                  </span>
                  <span className="grow">{p.name}</span>
                  {p.from && <span className="t-small muted">{p.from}</span>}
                  <span className="muted">→</span>
                  <b>{p.to}</b>
                  {!p.changed && <span className="t-small muted">stable</span>}
                </button>
              );
            })}
          </div>
          <Button variant="action" block disabled={!chosen.length} onClick={() => void apply()}>
            {chosen.length === c.proposals.length ? 'Tout appliquer' : `Appliquer (${chosen.length})`}
          </Button>
        </div>
      )}

      <span className="pf-sec">
        <span>Ensuite</span>
        <span />
      </span>
      <List>
        {c.next ? (
          <ListRow href={`/sport/programme/bloc/${c.next.id}`} title={<span className="t-strong">{c.next.name}</span>} detail={`${c.next.kind} · ${c.next.weeks} · ${c.next.goal}`} value={<span className="pf-chip">{c.next.start}</span>} />
        ) : (
          <ListRow title="Pas encore de bloc après celui-ci" detail="le suivant reprend la même forme, enchaîné" />
        )}
      </List>

      <a className="btn btn-secondary" href={`/copilot?domaine=sport&q=${encodeURIComponent(question)}`} style={{ justifyContent: 'flex-start', gap: 10 }}>
        <span className="pf-copilot" aria-hidden="true">
          ✦
        </span>
        Faire le point avec Copilot
      </a>
      <Button variant="action" block onClick={() => void next()}>
        {c.next ? 'Voir le programme' : 'Créer le bloc suivant'}
      </Button>
    </div>
  );
}
