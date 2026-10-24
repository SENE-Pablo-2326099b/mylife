import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';

import { cloudCreate, cloudRecover, cloudSignIn } from '@/services/cloud';
import { platform } from '@/services/cloud/platform';
import { showToast } from '@/state/toastStore';
import { Button, Card, Field, IconButton, Text } from '@/ui/components/primitives';
import { space, useTheme } from '@/ui/theme';
import { checkLogin, loginIssue, normalizeLogin, passwordIssue, passwordStrength } from '@/vendor/mylife-sync';

type Mode = 'create' | 'login' | 'recover';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** L'identifiant est-il libre ? Réponse pendant la saisie. */
function useAvailability(login: string, enabled: boolean): 'idle' | 'checking' | 'free' | 'taken' | 'offline' {
  const value = normalizeLogin(login);
  const checkable = enabled && !loginIssue(value);
  // Réponse rangée avec l'identifiant vérifié : une réponse pour une ancienne saisie ne compte pas.
  const [answer, setAnswer] = useState<{ value: string; state: 'free' | 'taken' | 'offline' } | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!checkable) return;
    const n = ++seq.current;
    const t = setTimeout(() => {
      checkLogin(platform.api, value).then(
        (free) => n === seq.current && setAnswer({ value, state: free ? 'free' : 'taken' }),
        () => n === seq.current && setAnswer({ value, state: 'offline' }),
      );
    }, 350);
    return () => clearTimeout(t);
  }, [value, checkable]);
  if (!checkable) return 'idle';
  return answer?.value === value ? answer.state : 'checking';
}

export function PasswordField({ label, value, onChange, isNew, login }: { label: string; value: string; onChange: (v: string) => void; isNew: boolean; login?: string }) {
  const t = useTheme();
  const [shown, setShown] = useState(false);
  const s = passwordStrength(value);
  const issue = isNew && value ? passwordIssue(value, login) : null;
  const tones = [t.danger, t.warning, t.gold, t.success, t.success];
  const words = ['Trop court', 'Faible', 'Correct', 'Solide', 'Excellent'];
  return (
    <View style={{ gap: space.xs + 2 }}>
      <View>
        <Field label={label} value={value} onChangeText={onChange} secureTextEntry={!shown} autoCapitalize="none" autoCorrect={false} autoComplete={isNew ? 'new-password' : 'current-password'} textContentType={isNew ? 'newPassword' : 'password'} style={{ paddingRight: 52 }} />
        <View style={{ position: 'absolute', right: 2, bottom: 3 }}>
          <IconButton icon={shown ? 'eye-off-outline' : 'eye-outline'} label={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} onPress={() => setShown((v) => !v)} />
        </View>
      </View>
      {isNew && value.length > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
            {[1, 2, 3, 4].map((i) => (
              <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= s ? tones[s] : t.border }} />
            ))}
          </View>
          <Text variant="caption" style={{ color: tones[s] }}>
            {issue ?? words[s]}
          </Text>
        </View>
      )}
    </View>
  );
}

export function AccountForms() {
  const t = useTheme();
  const [mode, setMode] = useState<Mode>('create');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availability = useAvailability(login, mode === 'create');
  const loginProblem = mode === 'create' && login ? loginIssue(login) : null;
  const ready =
    !busy &&
    !!login.trim() &&
    (mode === 'login' ? password.length > 0 : !loginIssue(login) && !passwordIssue(password, login)) &&
    (mode !== 'create' || availability !== 'taken') &&
    (mode !== 'recover' || recovery.trim().length >= 32);

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') await cloudCreate(login, password);
      else if (mode === 'login') await cloudSignIn(login, password);
      else {
        await cloudRecover(login, recovery, password);
        showToast({ message: 'Compte récupéré : ton nouveau mot de passe est enregistré.' });
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
    setPassword('');
  };
  const loginHint =
    mode !== 'create' ? null : availability === 'checking' ? 'Vérification…' : availability === 'free' ? '✓ Libre' : availability === 'taken' ? 'Déjà pris : essaie une variante.' : availability === 'offline' ? 'Disponibilité vérifiée à la création.' : 'Ton nom sur MyLife : lettres, chiffres, . _ - @';

  return (
    <Card>
      <View style={{ gap: space.md }}>
        <View style={{ gap: space.xs }}>
          <Text variant="title">{mode === 'create' ? 'Crée ton compte' : mode === 'login' ? 'Connexion' : 'Mot de passe oublié'}</Text>
          <Text tone="secondary">
            {mode === 'create'
              ? 'Un seul compte pour toutes tes apps MyLife, sur tous tes appareils. Tes données sont chiffrées sur ton téléphone avant d’être sauvegardées.'
              : mode === 'login'
                ? 'Le même compte pour MyFinances, MyPerf et MyRave.'
                : 'Encore connecté sur un autre appareil ? Change simplement ton mot de passe depuis son écran Compte, sans clé. Sinon, ta clé de secours te redonne accès à ton compte, avec un nouveau mot de passe.'}
          </Text>
        </View>
        <View style={{ gap: space.xs + 2 }}>
          <Field label="Identifiant" value={login} onChangeText={setLogin} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" placeholder="Choisis un identifiant" />
          {(loginProblem || loginHint) && (
            <Text variant="caption" style={{ color: loginProblem || availability === 'taken' ? t.danger : availability === 'free' ? t.success : t.textMuted }}>
              {loginProblem ?? loginHint}
            </Text>
          )}
        </View>
        {mode === 'recover' && <Field label="Clé de secours" value={recovery} onChangeText={setRecovery} autoCapitalize="characters" autoCorrect={false} placeholder="XXXX-XXXX-XXXX-…" />}
        <PasswordField label={mode === 'recover' ? 'Nouveau mot de passe' : 'Mot de passe'} value={password} onChange={setPassword} isNew={mode !== 'login'} login={login} />
        {error !== null && (
          <Text variant="small" tone="danger">
            {error}
          </Text>
        )}
        <Button
          label={busy ? (mode === 'create' ? 'Création…' : mode === 'login' ? 'Connexion…' : 'Récupération…') : mode === 'create' ? 'Créer mon compte' : mode === 'login' ? 'Se connecter' : 'Récupérer mon compte'}
          onPress={() => void submit()}
          disabled={!ready}
        />
        {busy && Platform.OS !== 'web' && (
          <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            Chiffrement sur le téléphone : quelques secondes.
          </Text>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm }}>
          {mode !== 'login' && <Button label="J’ai déjà un compte" variant="ghost" onPress={() => switchTo('login')} />}
          {mode === 'login' && (
            <>
              <Button label="Créer un compte" variant="ghost" onPress={() => switchTo('create')} />
              <Button label="Mot de passe oublié ?" variant="ghost" onPress={() => switchTo('recover')} />
            </>
          )}
        </View>
      </View>
    </Card>
  );
}

