import { useEffect, useState } from 'react';
import { Badge, Button, Glass, IconButton, List, ListRow, Notice, SectionTitle } from '@mylife/kit';
import type { Overview } from '../data/queries';
import type { StorageInfo } from '../data/backend';
import { call, persistStorage, storageInfo } from '../data/client';
import { cloudBoot, dropForeign, resolveChoice, useCloud } from '../data/cloud';

/**
 * Tes données : ce que la base de MyPerf sur cet appareil contient (séances, séances types, références, mesures), la
 * synchro avec le compte (app `perf`, la même que l'app d'avant) et le stockage (protégé ou non). Né à l'étape P1.
 * Et l'export : tout (JSON complet, réimportable sans doublon) et les séries pour un tableur (CSV).
 */
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const kg = (v: number, signed: boolean) => `${signed && v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg`;
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const STRUCTURE: Record<Overview['structure'], string> = { periodized: 'blocs', cycle: 'cycle libre', routine: 'routine' };

export function VerifyPage() {
  const cloud = useCloud();
  const [o, setO] = useState<Overview | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [persisted, setPersisted] = useState<string>('…');
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // Rien d'un autre compte n'est lu : ses données partent avant la première lecture.
  const [clean, setClean] = useState(false);

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
  }, [clean, cloud.lastSyncAt, cloud.synced]);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <header className="row" style={{ alignItems: 'flex-end' }}>
        <IconButton icon="back" label="Retour à Aujourd’hui" href="/sport" />
        <div className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="t-small muted">MyPerf</span>
          <h1 className="t-screen">Tes données</h1>
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

          <SectionTitle>Exporter</SectionTitle>
          {failed && <Notice tone="bad">{failed}</Notice>}
          <List>
            <ListRow
              title="Tout exporter"
              detail="JSON complet · programme, cycles, historique"
              value="Télécharger"
              onClick={async () => {
                try {
                  download(`myperf-tout-${today()}.json`, await call('exportFull'), 'application/json');
                } catch (e) {
                  setFailed(`Export impossible : ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
            />
            <ListRow
              title="Séries pour un tableur"
              detail="CSV · une ligne par série"
              value="Télécharger"
              onClick={async () => {
                try {
                  download(`myperf-series-${today()}.csv`, `\ufeff${await call('setsCsv')}`, 'text/csv;charset=utf-8');
                } catch (e) {
                  setFailed(`Export impossible : ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
            />
          </List>

          <SectionTitle>Appareil</SectionTitle>
          <List>
            <ListRow title="Synchro" value={cloud.syncing ? 'en cours' : cloud.lastSyncAt ? 'à jour' : cloud.signedIn ? 'pas encore' : 'hors compte'} detail={o.pending > 0 ? `${o.pending} modifications à envoyer` : undefined} />
            <ListRow title="Stockage" value={<Badge tone={storage?.vfs === 'opfs-sahpool' && persisted === 'protégé' ? 'ok' : 'warn'}>{storage?.vfs === 'memory' ? 'en mémoire' : storage?.vfs === 'busy' ? 'ouvert ailleurs' : persisted}</Badge>} detail={storage ? `SQLite ${storage.sqlite}` : undefined} />
          </List>
          <span className="t-small muted">Lu comme : {o.capabilities.join(' · ') || '—'}</span>
        </>
      )}
    </div>
  );
}
