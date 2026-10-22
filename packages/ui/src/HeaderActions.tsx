import { useState, type ReactNode } from 'react';
import { IconButton } from './primitives';
import { usePendingRecovery } from './session';
import { Spaces, type SpaceRow, type SpaceShortcut } from './Spaces';

/**
 * En-tête des écrans principaux, le même dans toutes les apps MyLife : à gauche le bouton propre à
 * l'app (alertes dans MyFinances, coach dans MyPerf, phare dans myRaveLoc), à droite toujours les
 * Espaces MyLife (apps, compte, synchros — leur état se lit sur la pastille).
 */
export function HeaderActions({ appAction, rows = [], shortcuts = [], accountPath }: { appAction?: ReactNode; rows?: SpaceRow[]; shortcuts?: SpaceShortcut[]; accountPath: string }) {
  const [spaces, setSpaces] = useState(false);
  const pending = usePendingRecovery();
  const failing = rows.some((r) => r.state === 'error') || !!pending;
  const busy = rows.some((r) => r.state === 'busy');
  const dot = (color: string, pulse = false) => (
    <span className={`absolute right-2 top-2 h-2 w-2 rounded-full ${pulse ? 'animate-pulse' : ''}`} style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
  );
  return (
    <>
      {appAction}
      <IconButton
        icon="apps"
        label={failing ? 'Espaces MyLife (à voir)' : busy ? 'Espaces MyLife (synchro en cours)' : 'Espaces MyLife'}
        glass
        onClick={() => setSpaces(true)}
        badge={failing ? dot('var(--danger)') : busy ? dot('var(--accent)', true) : undefined}
      />
      <Spaces open={spaces} onClose={() => setSpaces(false)} rows={rows} shortcuts={shortcuts} accountPath={accountPath} />
    </>
  );
}
