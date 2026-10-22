import { useLiveQuery } from 'dexie-react-hooks';
import { getMeta } from '../db/db';
import { useAlerts } from '../domain/useAlerts';
import { syncCloud, useCloud } from '../sync/cloud';
import { runSync, useSyncState } from '../sync/store';
import { HeaderActions as MyLifeHeader } from '../ui/HeaderActions';
import { IconButton } from '../ui/index';
import { relativeTime } from '../ui/relative';
import type { SpaceRow } from '../ui/Spaces';

/**
 * En-tête commun de MyLife (src/ui/HeaderActions) avec ce qui est propre à MyFinances : le bouton des
 * alertes, et dans les Espaces l'état de la synchro du compte et des banques.
 */
export function HeaderActions() {
  const alerts = useAlerts();
  const bank = useSyncState();
  const cloud = useCloud();
  const lastBank = useLiveQuery(() => getMeta<number>('lastSyncAt'), [bank.finishedAt]);
  const serious = alerts.filter((a) => a.level !== 'info').length;

  const rows: SpaceRow[] = [];
  if (cloud.session)
    rows.push({
      id: 'cloud',
      label: 'Synchro MyFinances',
      detail: cloud.error ?? (cloud.syncing ? 'Synchro en cours…' : !cloud.joined ? 'Appareil en cours de liaison…' : `Synchronisé ${relativeTime(cloud.lastSyncAt)}`),
      state: cloud.error ? 'error' : cloud.syncing || !cloud.joined ? 'busy' : 'ok',
      to: '/reglages/compte',
      onSync: () => void syncCloud(),
    });
  rows.push({
    id: 'banks',
    label: 'Banques',
    detail: bank.error ?? (bank.syncing ? 'Interrogation des banques…' : `Synchro ${relativeTime(lastBank)}`),
    state: bank.error ? 'error' : bank.syncing ? 'busy' : lastBank ? 'ok' : 'off',
    to: '/synchro',
    onSync: () => void runSync(),
  });

  return (
    <MyLifeHeader
      appAction={
        <IconButton
          icon="bell"
          label={serious ? `Alertes (${serious})` : 'Alertes'}
          to="/alertes"
          glass
          badge={serious > 0 ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full" style={{ background: 'var(--danger)', boxShadow: '0 0 8px var(--danger)' }} /> : undefined}
        />
      }
      rows={rows}
      // Même rangée dans chaque app : l'assistant de l'app, ses données propres, ses réglages.
      shortcuts={[
        { label: 'Assistant', icon: 'sparkles', to: '/assistant' },
        { label: 'Banques', icon: 'bank', to: '/synchro' },
        { label: 'Réglages', icon: 'options', to: '/reglages' },
      ]}
      accountPath="/reglages/compte"
    />
  );
}
