import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import { useAlerts } from '../domain/useAlerts';
import { useCloud } from '../sync/cloud';
import { runSync, useSyncState } from '../sync/store';
import { Group, IconButton, Row, Sheet, toast } from '../ui/index';
import { Spaces } from './Spaces';

/**
 * Actions de l'en-tête des écrans principaux : alertes, « + » (actions rapides) et lanceur MyLife
 * (apps, compte, banques). L'état des synchros se lit sur la pastille du lanceur.
 */
export function HeaderActions() {
  const alerts = useAlerts();
  const bank = useSyncState();
  const cloud = useCloud();
  const [sheet, setSheet] = useState<'add' | 'apps' | null>(null);
  const serious = alerts.filter((a) => a.level !== 'info').length;
  const failing = !!bank.error || !!cloud.error;
  const busy = bank.syncing || cloud.syncing;
  const dot = (color: string, pulse = false) => (
    <span className={`absolute right-2 top-2 h-2 w-2 rounded-full ${pulse ? 'animate-pulse' : ''}`} style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
  );
  return (
    <>
      <IconButton icon="bell" label={serious ? `Alertes (${serious})` : 'Alertes'} to="/alertes" glass badge={serious > 0 ? dot('var(--danger)') : undefined} />
      <IconButton icon="add" label="Actions rapides" glass onClick={() => setSheet('add')} />
      <IconButton
        icon="apps"
        label={failing ? 'Apps et synchro (erreur)' : busy ? 'Apps et synchro (en cours)' : 'Apps et synchro'}
        glass
        onClick={() => setSheet('apps')}
        badge={failing ? dot('var(--danger)') : busy ? dot('var(--accent)', true) : undefined}
      />
      <QuickActions open={sheet === 'add'} onClose={() => setSheet(null)} />
      <Spaces open={sheet === 'apps'} onClose={() => setSheet(null)} />
    </>
  );
}

function QuickActions({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const bank = useSyncState();
  const toClassify = useLiveQuery(() => db.transactions.filter((t) => t.categoryId === null).count(), []) ?? 0;
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  const syncBanks = () => {
    onClose();
    void runSync().then((r) => {
      if (r) toast({ message: `Banques à jour · ${r.reduce((s, x) => s + x.added, 0)} nouvelle(s) opération(s)` });
    });
  };
  return (
    <Sheet open={open} onClose={onClose} title="Actions rapides">
      <Group className="mb-3">
        <Row icon="sparkles" iconTone="accent" title="Demander à l’assistant" subtitle="Claude lit tes finances et propose, tu valides" onClick={() => go('/assistant')} />
      </Group>
      <Group>
        <Row icon="sync" iconTone="accent" title="Synchroniser les banques" subtitle={bank.syncing ? 'En cours…' : 'Soldes et nouvelles opérations'} onClick={bank.syncing ? undefined : syncBanks} />
        {toClassify > 0 && <Row icon="tag" iconTone="warning" title={`Classer ${toClassify} opération${toClassify > 1 ? 's' : ''}`} onClick={() => go('/a-classer')} />}
        <Row icon="upload" title="Importer un relevé Trade Republic" subtitle="PDF : achats, ventes, dividendes" onClick={() => go('/patrimoine/import')} />
      </Group>
      <Group className="mt-3">
        <Row icon="trend-up" title="Ajouter un placement" onClick={() => go('/patrimoine?vue=placements&ajouter=1')} />
        <Row icon="flag" title="Nouvel objectif d’épargne" onClick={() => go('/patrimoine?vue=objectifs&ajouter=1')} />
        <Row icon="home" title="Ajouter un bien ou une dette" onClick={() => go('/patrimoine?vue=biens&ajouter=1')} />
        <Row icon="rocket" title="Simuler mon indépendance financière" onClick={() => go('/independance')} />
      </Group>
    </Sheet>
  );
}
