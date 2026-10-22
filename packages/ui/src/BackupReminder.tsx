import { useState } from 'react';
import { markBackedUp, snoozeBackup, useBackupStatus } from './backup';
import { Icon } from './icons';
import { Button, Card } from './primitives';
import { relativeTime } from './relative';
import { toast } from './toastStore';

/**
 * « Fais ta sauvegarde de la semaine » : une carte avec un bouton qui télécharge la copie des données de
 * l'app (`onBackup` la produit), et « Plus tard » qui repousse d'un jour. Rien à afficher tant que la
 * dernière sauvegarde a moins de 7 jours, ni quand l'app n'a pas encore de données (`hasData`).
 */
export function BackupReminder({ app, hasData, onBackup }: { app: string; hasData: boolean; onBackup: () => Promise<void> }) {
  const { due, last } = useBackupStatus(app);
  const [busy, setBusy] = useState(false);
  if (!due || !hasData) return null;
  return (
    <Card tone="warning" level="raised">
      <div className="flex items-start gap-3">
        <Icon name="shield" className="mt-0.5 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="t-body-strong">Sauvegarde de la semaine</p>
          <p className="t-small mt-0.5 text-secondary">
            {last === null ? 'Tu n’as encore jamais sauvegardé.' : `Dernière sauvegarde ${relativeTime(last)}.`} Tes données sont dans ce navigateur : une copie, c’est une assurance si elles sont effacées.
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <Button
          icon="download"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onBackup()
              .then(() => {
                markBackedUp(app);
                toast({ message: 'Sauvegarde téléchargée', tone: 'gold' });
              })
              .catch((e: unknown) => toast({ message: e instanceof Error ? e.message : String(e), tone: 'danger' }))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Préparation…' : 'Sauvegarder maintenant'}
        </Button>
        <Button variant="ghost" onClick={() => snoozeBackup(app)}>
          Plus tard
        </Button>
      </div>
    </Card>
  );
}
