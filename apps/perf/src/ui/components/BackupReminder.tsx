import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { exportJson } from '@/services/exportService';
import { BACKUP_EVENT, lastWebBackup, snoozeWebBackup, webBackupDue } from '@/services/webBackup';
import { showToast } from '@/state/toastStore';
import { Button, Card, Text } from '@/ui/components/primitives';
import { space, useTheme } from '@/ui/theme';

const ago = (ts: number) => {
  const d = Math.floor((Date.now() - ts) / 86_400_000);
  return d <= 0 ? 'aujourd’hui' : d === 1 ? 'hier' : `il y a ${d} jours`;
};

/** « Sauvegarde de la semaine » (web) : télécharge une copie des données, ou repousse d'un jour. */
export function BackupReminder({ hasData }: { hasData: boolean }) {
  const t = useTheme();
  const [, tick] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    if (typeof window === 'undefined') return;
    window.addEventListener(BACKUP_EVENT, fn);
    return () => window.removeEventListener(BACKUP_EVENT, fn);
  }, []);
  if (!hasData || !webBackupDue()) return null;
  const last = lastWebBackup();
  return (
    <Card level="raised" tone="warning">
      <View style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
          <Ionicons name="shield-checkmark-outline" size={22} color={t.warning} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">Sauvegarde de la semaine</Text>
            <Text variant="small" tone="secondary">
              {last === null ? 'Tu n’as encore jamais sauvegardé.' : `Dernière sauvegarde ${ago(last)}.`} Tes séances sont dans ce navigateur : une copie, c’est une assurance si elles sont effacées.
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              label={busy ? 'Préparation…' : 'Sauvegarder maintenant'}
              icon="download-outline"
              disabled={busy}
              onPress={() => {
                setBusy(true);
                exportJson()
                  .then(() => showToast({ message: 'Sauvegarde téléchargée' }))
                  .catch((e: unknown) => showToast({ message: e instanceof Error ? e.message : String(e) }))
                  .finally(() => setBusy(false));
              }}
            />
          </View>
          <Button label="Plus tard" variant="ghost" onPress={snoozeWebBackup} />
        </View>
      </View>
    </Card>
  );
}
