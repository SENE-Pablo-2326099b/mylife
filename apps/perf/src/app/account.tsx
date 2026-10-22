import { useEffect, useState } from 'react';
import { Platform, Share, View } from 'react-native';

import {
  cloudChangePassword,
  cloudDeleteAccount,
  cloudRecoverySaved,
  cloudRenewRecovery,
  cloudSignOut,
  refreshCloud,
  syncCloud,
  useCloud,
} from '@/services/cloud';
import { showToast } from '@/state/toastStore';
import { Button, Card, Row, Text } from '@/ui/components/primitives';
import { AccountForms, PasswordField } from '@/features/account/forms';
import { Join } from '@/features/account/Join';
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
          <Row icon="log-out-outline" title="Se déconnecter" onPress={() => run(cloudSignOut, 'Déconnecté. Tes données restent dans ton compte ; un autre compte connecté ici n’en verra rien.')} />
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
