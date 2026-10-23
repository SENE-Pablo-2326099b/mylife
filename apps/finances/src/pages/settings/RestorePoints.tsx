import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { deleteRestorePoint, listRestorePoints, restoreDb, restoreFromPoint } from '../../domain/restorePoints';
import { Button, Card, IconButton, Reveal, SectionTitle, toast } from '../../ui/index';

const when = (at: number) => new Date(at).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Points de restauration : revenir à l'état d'avant un geste qui a remplacé ou effacé des données. */
export function RestorePoints({ busy, run }: { busy: boolean; run: (fn: () => Promise<void>) => Promise<void> }) {
  const points = useLiveQuery(() => listRestorePoints(restoreDb), []);
  // Revenir à un point remplace tout : un second toucher confirme.
  const [confirm, setConfirm] = useState<number | null>(null);
  return (
    <Reveal index={2}>
      <SectionTitle>Points de restauration</SectionTitle>
      <Card>
        <p className="t-small text-secondary">
          Avant chaque restauration, suppression de la démo, « Tout effacer » ou reprise des données du compte, l’app garde une copie complète de tes données sur cet appareil (les 5 dernières). Elles ne quittent jamais l’appareil.
        </p>
        {points === undefined ? null : points.length === 0 ? (
          <p className="t-small mt-3 text-muted">Aucun point pour l’instant.</p>
        ) : (
          <div className="mt-3 flex flex-col divide-y divide-line">
            {points.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="t-body-strong">{p.reason}</p>
                  <p className="t-caption text-muted">
                    {when(p.at)} · {p.transactions} opération{p.transactions > 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant={confirm === p.id ? 'primary' : 'secondary'}
                    disabled={busy}
                    onClick={() => {
                      if (confirm !== p.id) return setConfirm(p.id ?? null);
                      setConfirm(null);
                      void run(async () => {
                        const r = await restoreFromPoint(p.id!);
                        toast({ message: `Données revenues au ${when(p.at)} (${r.transactions} opérations). L’état d’avant est gardé comme point.`, tone: 'gold' });
                      });
                    }}
                  >
                    {confirm === p.id ? 'Confirmer' : 'Revenir ici'}
                  </Button>
                  <IconButton icon="trash" size={18} label={`Supprimer le point du ${when(p.at)}`} onClick={() => void deleteRestorePoint(p.id!)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Reveal>
  );
}
