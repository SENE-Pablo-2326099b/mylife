import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { db } from '@/db/db';
import { backupBeforeReplace } from '@/services/autoBackup';
import { cloudAccountStatus, cloudChangePassword, cloudCreate, cloudJoin, cloudRecover, cloudSignIn, cloudSignOut, localItemCount, refreshCloud, syncCloud, useCloud } from '@/services/cloud';
import { exportJson } from '@/services/exportService';
import { showToast } from '@/state/toastStore';
import { Badge, Button, Card, Field, Segmented, Text } from '@/ui/components/primitives';
import { Screen } from '@/ui/components/Screen';
import { space, useTheme } from '@/ui/theme';

type Mode = 'login' | 'create' | 'recover';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const when = (ts: number | null) => (ts ? new Date(ts).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'jamais');

function SignIn({ onRecoveryKey }: { onRecoveryKey: (k: string) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [invite, setInvite] = useState('');
  const [recovery, setRecovery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (mode !== 'login' && password !== confirm) return setError('Les deux mots de passe ne sont pas identiques.');
    setBusy(true);
    try {
      if (mode === 'login') await cloudSignIn(login, password);
      else if (mode === 'create') onRecoveryKey(await cloudCreate(login, password, invite));
      else await cloudRecover(login, recovery, password);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const ready = !!login.trim() && password.length >= (mode === 'login' ? 1 : 8) && (mode !== 'create' || !!invite.trim()) && (mode !== 'recover' || !!recovery.trim());

  return (
    <Card>
      <View style={{ gap: space.md }}>
        <Segmented<Mode>
          options={[
            { value: 'login', label: 'Connexion' },
            { value: 'create', label: 'Créer' },
            { value: 'recover', label: 'Oublié' },
          ]}
          value={mode}
          onChange={(m) => {
            setMode(m);
            setError(null);
          }}
        />
        <Field label="Identifiant" value={login} onChangeText={setLogin} autoCapitalize="none" autoCorrect={false} autoComplete="username" placeholder="ex. pablo" />
        {mode === 'recover' && <Field label="Clé de secours" value={recovery} onChangeText={setRecovery} autoCapitalize="characters" autoCorrect={false} placeholder="XXXX-XXXX-…" />}
        <Field label={mode === 'recover' ? 'Nouveau mot de passe' : 'Mot de passe'} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        {mode !== 'login' && <Field label="Confirmer le mot de passe" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" />}
        {mode === 'create' && <Field label="Code d’invitation" value={invite} onChangeText={setInvite} autoCapitalize="none" autoCorrect={false} />}
        {mode !== 'login' && <Text variant="caption" tone="muted">8 caractères au moins. Le mot de passe chiffre tes données : choisis-le long.</Text>}
        {error !== null && <Text variant="small" tone="danger">{error}</Text>}
        <Button
          label={busy ? 'Chiffrement… (jusqu’à 30 s sur téléphone)' : mode === 'login' ? 'Se connecter' : mode === 'create' ? 'Créer mon compte' : 'Récupérer mon compte'}
          onPress={() => void submit()}
          disabled={busy || !ready}
        />
      </View>
    </Card>
  );
}

function RecoveryKey({ value, onDone }: { value: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <Card>
      <View style={{ gap: space.md }}>
        <Text variant="headline">Ta clé de secours</Text>
        <Text tone="secondary">Si tu oublies ton mot de passe, c’est le seul moyen de récupérer tes données : personne, pas même le serveur, ne peut les déchiffrer sans. Note-la dans un gestionnaire de mots de passe ou sur papier.</Text>
        <Text variant="headline" tone="accent" selectable style={{ textAlign: 'center', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined }}>
          {value}
        </Text>
        <Button label={saved ? 'Notée ✓' : 'Je l’ai notée'} variant={saved ? 'secondary' : 'ghost'} onPress={() => setSaved(true)} />
        <Button label="Continuer" onPress={onDone} disabled={!saved} />
      </View>
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
  const run = async (mode: 'auto' | 'useAccount' | 'useDevice') => {
    setBusy(true);
    setError(null);
    try {
      if (mode !== 'useDevice' && status && status.count > 0) {
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
        <Text variant="headline">Synchroniser cet appareil</Text>
        {status === null && error === null && <Text tone="secondary">Lecture du compte…</Text>}
        {status !== null && status.count === 0 && (
          <>
            <Text tone="secondary">Ton compte ne contient encore rien pour MyPerf : les données de cet appareil (séances, cycles, 1RM, mesures) vont y être envoyées, chiffrées.</Text>
            <Button label={busy ? 'Envoi…' : 'Envoyer mes données'} icon="cloud-upload-outline" onPress={() => void run('auto')} disabled={busy} />
          </>
        )}
        {status !== null && status.count > 0 && (
          <>
            <Text tone="secondary">
              Cet appareil : {local ?? '…'} éléments · ton compte : {status.count} éléments (modifiés le {when(status.lastUpdated)}). Un seul des deux est gardé, puis tous tes appareils le partagent.
            </Text>
            {deviceRicher ? (
              <>
                <Text tone="secondary">Cet appareil a plus de données que le compte : garde-les (elles remplaceront celles du compte).</Text>
                <Button label={busy ? 'Envoi…' : 'Garder les données de cet appareil'} icon="cloud-upload-outline" onPress={() => void run('useDevice')} disabled={busy} />
                <Button label="Prendre quand même celles du compte (copie gardée avant)" variant="ghost" onPress={() => void run('useAccount')} disabled={busy} />
              </>
            ) : (
              <>
                <Button label={busy ? 'Récupération…' : 'Récupérer les données du compte'} icon="cloud-download-outline" onPress={() => void run('useAccount')} disabled={busy} />
                <Text variant="caption" tone="muted">Une copie des données de cet appareil est gardée avant.</Text>
                <Button label="Garder plutôt celles de cet appareil (remplace le compte)" variant="ghost" onPress={() => void run('useDevice')} disabled={busy} />
              </>
            )}
          </>
        )}
        {error !== null && <Text variant="small" tone="danger">{error}</Text>}
      </View>
    </Card>
  );
}

function Status() {
  const t = useTheme();
  const cloud = useCloud();
  const [changing, setChanging] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <View style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
          <Text variant="headline">{cloud.session?.login}</Text>
          <Badge label={cloud.error ? 'Erreur' : cloud.syncing ? 'Synchro…' : 'Synchronisé'} color={cloud.error ? t.danger : cloud.syncing ? t.info : t.success} />
        </View>
        <Text tone="secondary">
          Dernière synchro : {when(cloud.lastSyncAt)}
          {cloud.pending > 0 ? ` · ${cloud.pending} modification${cloud.pending > 1 ? 's' : ''} à envoyer` : ''}
        </Text>
        {cloud.error !== null && <Text variant="small" tone="danger">{cloud.error}</Text>}
        <Button label="Synchroniser maintenant" icon="sync-outline" onPress={() => void syncCloud()} disabled={cloud.syncing} />
        {changing ? (
          <>
            <Field label="Nouveau mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
            <Button
              label={busy ? 'Chiffrement…' : 'Enregistrer le mot de passe'}
              variant="secondary"
              disabled={busy || password.length < 8}
              onPress={() => {
                setBusy(true);
                void cloudChangePassword(password)
                  .then(() => {
                    showToast({ message: 'Mot de passe changé. Ta clé de secours reste valable.' });
                    setChanging(false);
                    setPassword('');
                  })
                  .catch((e: unknown) => showToast({ message: message(e) }))
                  .finally(() => setBusy(false));
              }}
            />
          </>
        ) : (
          <Button label="Changer le mot de passe" variant="ghost" onPress={() => setChanging(true)} />
        )}
        <Button label="Se déconnecter de cet appareil" variant="ghost" onPress={() => void cloudSignOut().then(() => showToast({ message: 'Déconnecté. Tes données restent sur cet appareil.' }))} />
      </View>
    </Card>
  );
}

export default function AccountScreen() {
  const cloud = useCloud();
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  useEffect(() => {
    void refreshCloud();
  }, []);
  return (
    <Screen stack title="Compte MyLife" mood="settings">
      <View style={{ gap: space.md }}>
        <Card>
          <Text tone="secondary">
            Un seul compte pour MyPerf et MyFinances, sur ton téléphone comme sur ton ordinateur. Tes données sont chiffrées sur l’appareil avec ton mot de passe : le serveur ne garde que des blocs illisibles.
          </Text>
        </Card>
        {recoveryKey !== null ? <RecoveryKey value={recoveryKey} onDone={() => setRecoveryKey(null)} /> : !cloud.session ? <SignIn onRecoveryKey={setRecoveryKey} /> : !cloud.joined ? <Join /> : <Status />}
      </View>
    </Screen>
  );
}
