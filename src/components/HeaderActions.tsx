import { useState } from 'react';
import { useAlerts } from '../domain/useAlerts';
import { useCloud } from '../sync/cloud';
import { useSyncState } from '../sync/store';
import { IconButton } from '../ui/index';
import { Spaces } from './Spaces';

/**
 * En-tête des écrans principaux, le même dans toutes les apps MyLife : à gauche le bouton propre à
 * l'app (ici les alertes ; le coach dans MyPerf), à droite toujours les Espaces MyLife (apps, compte,
 * synchros — leur état se lit sur la pastille). Les actions passent par la palette (orbe du dock).
 */
export function HeaderActions() {
  const alerts = useAlerts();
  const bank = useSyncState();
  const cloud = useCloud();
  const [spaces, setSpaces] = useState(false);
  const serious = alerts.filter((a) => a.level !== 'info').length;
  const failing = !!bank.error || !!cloud.error;
  const busy = bank.syncing || cloud.syncing;
  const dot = (color: string, pulse = false) => (
    <span className={`absolute right-2 top-2 h-2 w-2 rounded-full ${pulse ? 'animate-pulse' : ''}`} style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
  );
  return (
    <>
      <IconButton icon="bell" label={serious ? `Alertes (${serious})` : 'Alertes'} to="/alertes" glass badge={serious > 0 ? dot('var(--danger)') : undefined} />
      <IconButton
        icon="apps"
        label={failing ? 'Espaces MyLife (erreur de synchro)' : busy ? 'Espaces MyLife (synchro en cours)' : 'Espaces MyLife'}
        glass
        onClick={() => setSpaces(true)}
        badge={failing ? dot('var(--danger)') : busy ? dot('var(--accent)', true) : undefined}
      />
      <Spaces open={spaces} onClose={() => setSpaces(false)} />
    </>
  );
}
