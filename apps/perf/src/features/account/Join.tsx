import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { db } from '@/db/db';
import { backupBeforeReplace } from '@/services/autoBackup';
import { cloudAccountStatus, cloudJoin, localItemCount } from '@/services/cloud';
import { exportJson } from '@/services/exportService';
import { showToast } from '@/state/toastStore';
import { Button, Card, Text } from '@/ui/components/primitives';
import { space } from '@/ui/theme';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const when = (ts: number | null) => (ts ? new Date(ts).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'jamais');

/**
 * Première synchro d'un appareil qui a déjà des séances saisies hors de tout compte. Compte neuf : partir
 * de zéro (proposé d'abord : un compte neuf ne reprend rien de l'appareil sans qu'on le demande) ou y mettre
 * ces données. Compte rempli : garder l'un ou l'autre (jamais de fusion). Une copie est gardée avant de
 * remplacer quoi que ce soit.
 */
export function Join() {
  const [status, setStatus] = useState<{ count: number; lastUpdated: number | null } | null>(null);
  const [local, setLocal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    cloudAccountStatus().then(setStatus, (e: unknown) => setError(message(e)));
    void localItemCount().then(setLocal);
  }, []);
  // L'appareil le plus complet est proposé en premier : on ne remplace jamais de vraies données par du vide.
  const deviceRicher = status !== null && local !== null && local > status.count;
  const run = async (mode: 'useAccount' | 'useDevice') => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'useAccount') {
        // Copie des données de l'appareil avant de les remplacer.
        if (Platform.OS === 'web') {
          if ((db().first<{ n: number }>('SELECT COUNT(*) AS n FROM workouts')?.n ?? 0) > 0) await exportJson();
        } else backupBeforeReplace();
      }
      const r = await cloudJoin(mode);
      showToast(
        {
          message:
            r.action === 'uploaded' ? `Données envoyées (chiffrées) : ${r.count} éléments` : r.count === 0 ? 'C’est parti, de zéro' : `Données du compte récupérées : ${r.count} éléments`,
        },
        5000,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (status?.count === 0)
    return (
      <Card>
        <View style={{ gap: space.md }}>
          <Text variant="headline">Ton compte est neuf</Text>
          <Text tone="secondary">
            Cet appareil contient déjà des séances ({local ?? '…'} éléments), reliées à aucun compte. Ton compte part de zéro, sauf si ces données sont les tiennes.
          </Text>
          <Button label={busy ? 'Préparation…' : 'Partir de zéro'} icon="sparkles-outline" onPress={() => void run('useAccount')} disabled={busy} />
          <Text variant="caption" tone="muted">
            Les données de cet appareil sont effacées (s’il y a des séances, une copie est d’abord gardée).
          </Text>
          <Button label="Ce sont les miennes : les mettre dans mon compte" variant="ghost" onPress={() => void run('useDevice')} disabled={busy} />
          {error !== null && (
            <Text variant="small" tone="danger">
              {error}
            </Text>
          )}
        </View>
      </Card>
    );

  return (
    <Card>
      <View style={{ gap: space.md }}>
        <Text variant="headline">Lesquelles garder ?</Text>
        <Text tone="secondary">
          Ton compte et cet appareil ont chacun des séances. Cet appareil : {local ?? '…'} éléments · ton compte : {status?.count ?? '…'} éléments{status ? ` (modifiés le ${when(status.lastUpdated)})` : ''}. Un seul des deux est gardé, puis tous tes appareils le partagent.
        </Text>
        {deviceRicher ? (
          <>
            <Button label={busy ? 'Envoi…' : 'Garder les données de cet appareil'} icon="cloud-upload-outline" onPress={() => void run('useDevice')} disabled={busy} />
            <Button label="Prendre celles du compte (copie gardée avant)" variant="ghost" onPress={() => void run('useAccount')} disabled={busy} />
          </>
        ) : (
          <>
            <Button label={busy ? 'Récupération…' : 'Récupérer les données du compte'} icon="cloud-download-outline" onPress={() => void run('useAccount')} disabled={busy} />
            <Text variant="caption" tone="muted">
              Une copie des données de cet appareil est gardée avant.
            </Text>
            <Button label="Garder plutôt celles de cet appareil (remplace le compte)" variant="ghost" onPress={() => void run('useDevice')} disabled={busy} />
          </>
        )}
        {error !== null && (
          <Text variant="small" tone="danger">
            {error}
          </Text>
        )}
      </View>
    </Card>
  );
}
