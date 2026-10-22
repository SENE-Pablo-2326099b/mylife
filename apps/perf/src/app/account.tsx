import { useEffect, useState } from 'react';
import { Platform, Share, View } from 'react-native';

import { db } from '@/db/db';
import { backupBeforeReplace } from '@/services/autoBackup';
import {
  cloudAccountStatus,
  cloudChangePassword,
  cloudDeleteAccount,
  cloudJoin,
  cloudRecoverySaved,
  cloudRenewRecovery,
  cloudSignOut,
  localItemCount,
  refreshCloud,
  syncCloud,
  useCloud,
} from '@/services/cloud';
import { exportJson } from '@/services/exportService';
import { showToast } from '@/state/toastStore';
import { Button, Card, Row, Text } from '@/ui/components/primitives';
import { AccountForms, PasswordField } from '@/features/account/forms';
import { Screen } from '@/ui/components/Screen';
import { space, useTheme } from '@/ui/theme';
import { passwordIssue } from '@/vendor/mylife-sync';

/**
 * Compte MyLife dans MyPerf : les mêmes écrans que dans les apps web (src/ui/account.tsx de MyLife),
 * en React Native pour l'app Android. Création en un écran (identifiant + mot de passe), clé de secours
 * montrée juste après puis rappelée, gestion complète du compte.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const when = (ts: number | null) => (ts ? new Date(ts).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'jamais');

/** La clé de secours : seul moyen de retrouver ses données si le mot de passe est perdu. */
function RecoveryKeyPanel({ login, value, fresh, onLater }: { login: string; value: string; fresh: boolean; onLater: () => void }) {
  const t = useTheme();
  const text = `Clé de secours MyLife\nIdentifiant : ${login}\nClé : ${value}\n\nElle seule permet de retrouver ton compte si tu oublies ton mot de passe. Garde-la hors de ton téléphone.`;
  return (
    <Card>
      <View style={{ gap: space.md }}>
        {fresh && (
          <Text variant="label" style={{ color: t.success }}>
            ✓ Compte créé
          </Text>
        )}
        <Text variant="title">Ta clé de secours</Text>
        <Text tone="secondary">Si tu oublies ton mot de passe, elle seule te rendra tes données : personne, pas même le serveur, ne peut les lire sans. Mets-la de côté, par exemple dans ton gestionnaire de mots de passe.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm, padding: space.md, borderRadius: 12, backgroundColor: t.goldSoft }}>
          {value.split('-').map((g, i) => (
            <Text key={i} selectable variant="headline" style={{ width: '21%', textAlign: 'center', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined }}>
              {g}
            </Text>
          ))}
        </View>
        <Button
          label={Platform.OS === 'web' ? 'Copier' : 'Partager ou enregistrer'}
          icon={Platform.OS === 'web' ? 'copy-outline' : 'share-outline'}
          variant="secondary"
          onPress={() =>
            Platform.OS === 'web'
              ? void navigator.clipboard?.writeText(value).then(() => showToast({ message: 'Clé copiée' }))
              : void Share.share({ title: 'Clé de secours MyLife', message: text }).catch(() => undefined)
          }
        />
        <Button label="C’est fait, je l’ai mise de côté" icon="checkmark" onPress={() => void cloudRecoverySaved()} />
        <Button label="Plus tard" variant="ghost" onPress={onLater} />
      </View>
    </Card>
  );
}

function RecoveryReminder() {
  const cloud = useCloud();
  const pending = cloud.recovery;
  // Juste après la création : ouverte d'emblée (comme dans les apps web), puis réduite à un rappel.
  const [fresh] = useState(() => !!pending && Date.now() - pending.at < 10 * 60_000);
  const [open, setOpen] = useState(fresh);
  if (!pending) return null;
  if (open) return <RecoveryKeyPanel login={pending.login} value={pending.key} fresh={fresh} onLater={() => setOpen(false)} />;
  return (
    <Card onPress={() => setOpen(true)}>
      <Row icon="key-outline" title="Mets de côté ta clé de secours" subtitle="Sans elle, un mot de passe oublié = données perdues." />
    </Card>
  );
}

function Join() {
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
      showToast({ message: r.action === 'uploaded' ? `Données envoyées (chiffrées) : ${r.count} éléments` : `Données du compte récupérées : ${r.count} éléments` }, 5000);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
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

function Overview() {
  const t = useTheme();
  const cloud = useCloud();
  const [panel, setPanel] = useState<'none' | 'password' | 'delete'>('none');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const open = (p: typeof panel) => {
    setPanel(panel === p ? 'none' : p);
    setPassword('');
  };
  const run = (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    void fn()
      .then(() => done && showToast({ message: done }))
      .catch((e: unknown) => showToast({ message: message(e) }))
      .finally(() => setBusy(false));
  };
  const login = cloud.session?.login ?? '';
  const syncLine = cloud.error ?? (cloud.syncing ? 'Synchro en cours…' : !cloud.joined ? 'Appareil en cours de liaison…' : `Synchronisé ${when(cloud.lastSyncAt)}${cloud.pending > 0 ? ` · ${cloud.pending} modification${cloud.pending > 1 ? 's' : ''} à envoyer` : ''}`);
  return (
    <View style={{ gap: space.md }}>
      <RecoveryReminder />
      <Card>
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="title" style={{ color: t.onAccent }}>
                {(login[0] ?? '?').toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="headline">{login}</Text>
              <Text variant="small" tone="secondary">
                Compte MyLife · chiffré de bout en bout
              </Text>
            </View>
          </View>
          <Row icon="barbell-outline" title="MyPerf" subtitle={syncLine} right={cloud.joined ? <Button label="Synchroniser" variant="ghost" onPress={() => void syncCloud()} disabled={cloud.syncing} /> : undefined} />
        </View>
      </Card>
      <Card>
        <View style={{ gap: space.xs }}>
          <Row icon="lock-closed-outline" title="Changer le mot de passe" onPress={() => open('password')} />
          {panel === 'password' && (
            <View style={{ gap: space.sm }}>
              <PasswordField label="Nouveau mot de passe" value={password} onChange={setPassword} isNew login={login} />
              <Button label={busy ? 'Enregistrement…' : 'Enregistrer'} disabled={busy || !!passwordIssue(password, login)} onPress={() => run(async () => (await cloudChangePassword(password), open('none')), 'Mot de passe changé. Ta clé de secours reste valable.')} />
            </View>
          )}
          <Row icon="key-outline" title="Nouvelle clé de secours" subtitle="L’ancienne cessera de fonctionner." onPress={() => run(cloudRenewRecovery)} />
          <Row icon="log-out-outline" title="Se déconnecter" onPress={() => run(cloudSignOut, 'Déconnecté. Tes données restent sur cet appareil.')} />
          <Row icon="trash-outline" title="Supprimer mon compte" onPress={() => open('delete')} />
          {panel === 'delete' && (
            <View style={{ gap: space.sm }}>
              <Text tone="secondary">Ton compte et tout ce qu’il sauvegarde sont effacés du serveur, pour toutes les apps. Ce qui est sur tes appareils y reste. C’est définitif.</Text>
              <PasswordField label="Ton mot de passe, pour confirmer" value={password} onChange={setPassword} isNew={false} />
              <Button label={busy ? 'Suppression…' : 'Supprimer définitivement'} variant="danger" disabled={busy || !password} onPress={() => run(() => cloudDeleteAccount(password), 'Compte supprimé. Tes données restent sur cet appareil.')} />
            </View>
          )}
        </View>
      </Card>
    </View>
  );
}

export default function AccountScreen() {
  const cloud = useCloud();
  useEffect(() => {
    void refreshCloud();
  }, []);
  return (
    <Screen stack title="Compte MyLife" mood="settings">
      <View style={{ gap: space.md }}>{!cloud.session ? <AccountForms /> : cloud.choice ? <Join /> : <Overview />}</View>
    </Screen>
  );
}
