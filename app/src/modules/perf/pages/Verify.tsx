import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Glass, IconButton, List, ListRow, Notice, SectionTitle } from '@mylife/kit';
import type { Overview } from '../data/queries';
import type { StorageInfo } from '../data/backend';
import { call, persistStorage, storageInfo } from '../data/client';
import { cloudBoot, dropForeign, resolveChoice, useCloud } from '../data/cloud';

/**
 * Étape P1 de la phase 4 : la vérification. Le module MyPerf lit ses données depuis le compte (synchro `perf`, la même
 * que l'app d'avant) dans sa propre base : on vérifie ici que toutes ses séances, références et mesures sont là.
 * Les vrais écrans (séance, jour, programme, progrès) arrivent aux étapes suivantes.
 */
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const kg = (v: number, signed: boolean) => `${signed && v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg`;
const STRUCTURE: Record<Overview['structure'], string> = { periodized: 'blocs', cycle: 'cycle libre', routine: 'routine' };

export function VerifyPage() {
  const cloud = useCloud();
  const [o, setO] = useState<Overview | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [persisted, setPersisted] = useState<string>('…');
  const [error, setError] = useState<string | null>(null);
  // Rien d'un autre compte n'est lu : ses données partent avant la première lecture.
  const [clean, setClean] = useState(false);
  const navigate = useNavigate();
  const [start, setStart] = useState<{ today: { id: string; name: string }[]; others: { id: string; name: string }[]; active: string | null } | null>(null);
  const [more, setMore] = useState(false);
  const begin = async (templateId: string | null) => {
    await call('startSession', templateId, today());
    navigate('/sport/seance');
  };

  useEffect(() => {
    dropForeign().then(
      () => setClean(true),
      (e: Error) => setError(e.message),
    );
    cloudBoot();
    void persistStorage().then(setPersisted);
    storageInfo().then(setStorage, (e: Error) => setError(e.message));
  }, []);
  // Relu après chaque synchro.
  useEffect(() => {
    if (!clean) return;
    call('overview', today()).then(setO, (e: Error) => setError(e.message));
    call('startOptions', today()).then(setStart, (e: Error) => setError(e.message));
  }, [clean, cloud.lastSyncAt, cloud.synced]);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <header className="row" style={{ alignItems: 'flex-end' }}>
        <IconButton icon="back" label="Retour à MyLife" href="/" />
        <div className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="t-small muted">Sport · nouvelle version</span>
          <h1 className="t-screen">Vérification</h1>
        </div>
      </header>

      {error && <Notice tone="bad">La base de MyPerf n’a pas pu s’ouvrir : {error}</Notice>}
      {!cloud.signedIn && <Notice>Connecte-toi pour retrouver tes données.</Notice>}
      {cloud.error && <Notice tone="bad">{cloud.error}</Notice>}
      {cloud.choice && (
        <Glass className="pad stack">
          <span className="t-strong">Le compte a déjà {cloud.choice.account} éléments, et cet appareil aussi.</span>
          <Button variant="action" block onClick={() => void resolveChoice('useAccount')}>
            Prendre ceux du compte
          </Button>
          <Button block onClick={() => void resolveChoice('useDevice')}>
            Garder ceux de cet appareil
          </Button>
        </Glass>
      )}

      {start && (
        <Glass className="pad stack" style={{ gap: 10 }}>
          {start.active ? (
            <>
              <span className="t-small muted">Séance en cours</span>
              <Button variant="action" block href="/sport/seance">
                Reprendre la séance
              </Button>
            </>
          ) : (
            <>
              <span className="t-small muted">{start.today.length ? 'Prévu aujourd’hui' : 'Démarrer une séance'}</span>
              {start.today.map((t) => (
                <Button key={t.id} variant="action" block onClick={() => void begin(t.id)}>
                  {`Démarrer ${t.name}`}
                </Button>
              ))}
              <div className="row" style={{ gap: 8 }}>
                {start.others.length > 0 && (
                  <Button block onClick={() => setMore(!more)}>
                    Autre séance
                  </Button>
                )}
                <Button block onClick={() => void begin(null)}>
                  Séance libre
                </Button>
              </div>
              {(more || !start.today.length) && start.others.length > 0 && (
                <List>
                  {start.others.map((t) => (
                    <ListRow key={t.id} title={t.name} onClick={() => void begin(t.id)} />
                  ))}
                </List>
              )}
            </>
          )}
        </Glass>
      )}

      {o && (
        <>
          <Glass className="pad stack" style={{ gap: 6 }}>
            <span className="t-small muted">{cloud.syncing ? 'Synchronisation…' : 'Tes séances, retrouvées'}</span>
            <span className="display" style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.05 }}>
              {o.workouts.toLocaleString('fr-FR')}
            </span>
            <span className="t-small muted">
              {o.sets.toLocaleString('fr-FR')} séries · du {day(o.firstDate)} au {day(o.lastDate)}
            </span>
          </Glass>

          <List>
            <ListRow title="Structure" value={STRUCTURE[o.structure]} detail={o.currentBlock ? `${o.currentBlock.name} · semaine ${o.currentBlock.week} / ${o.currentBlock.of}${o.currentBlock.deload ? ' · décharge' : ''}` : undefined} />
            <ListRow title="Séances types" value={String(o.templates)} />
            <ListRow title="Exercices" value={String(o.exercises)} />
            <ListRow title="Mesures" value={String(o.bodyEntries)} detail={o.bodyweight !== null ? `poids du corps ${kg(o.bodyweight, false)}` : undefined} />
          </List>

          {o.lifts.length > 0 && (
            <>
              <SectionTitle>1RM de référence</SectionTitle>
              <List>
                {o.lifts.map((l) => (
                  <ListRow key={l.name} title={l.name} detail={l.source} value={kg(l.shown, l.weighted)} />
                ))}
              </List>
            </>
          )}

          <SectionTitle>Appareil</SectionTitle>
          <List>
            <ListRow title="Synchro" value={cloud.syncing ? 'en cours' : cloud.lastSyncAt ? 'à jour' : cloud.signedIn ? 'pas encore' : 'hors compte'} detail={o.pending > 0 ? `${o.pending} modifications à envoyer` : undefined} />
            <ListRow title="Stockage" value={<Badge tone={storage?.vfs === 'opfs-sahpool' && persisted === 'protégé' ? 'ok' : 'warn'}>{storage?.vfs === 'memory' ? 'en mémoire' : persisted}</Badge>} detail={storage ? `SQLite ${storage.sqlite}` : undefined} />
          </List>
          <span className="t-small muted">Lu comme : {o.capabilities.join(' · ') || '—'}</span>
        </>
      )}
    </div>
  );
}
