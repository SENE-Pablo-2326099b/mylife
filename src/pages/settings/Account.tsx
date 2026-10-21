import { useEffect, useState } from 'react';
import { formatDateTime, relativeTime } from '../../lib/relative';
import {
  cloudAccountStatus,
  cloudChangePassword,
  cloudCreate,
  cloudJoin,
  cloudRecover,
  cloudSignIn,
  cloudSignOut,
  downloadLocalCopy,
  syncCloud,
  useCloud,
} from '../../sync/cloud';
import { Badge, Button, Card, Icon, Reveal, SectionTitle, Segmented, TextField, toast } from '../../ui/index';
import { Screen } from '../../ui/Screen';

type Mode = 'login' | 'create' | 'recover';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Connexion, création de compte, clé de secours. */
function SignInCard({ onRecoveryKey }: { onRecoveryKey: (key: string) => void }) {
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
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
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
        label="Compte"
      />
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextField label="Identifiant" value={login} onChange={setLogin} autoComplete="username" placeholder="ex. pablo" />
        {mode === 'recover' && <TextField label="Clé de secours" value={recovery} onChange={setRecovery} mono placeholder="XXXX-XXXX-…" hint="Donnée à la création du compte." />}
        <TextField
          label={mode === 'recover' ? 'Nouveau mot de passe' : 'Mot de passe'}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          hint={mode === 'login' ? undefined : '8 caractères au moins. Il chiffre tes données : choisis-le long.'}
        />
        {mode !== 'login' && <TextField label="Confirmer le mot de passe" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />}
        {mode === 'create' && <TextField label="Code d’invitation" value={invite} onChange={setInvite} hint="Donné par la personne qui gère MyLife." />}
        {error && <p className="t-small text-danger">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !login.trim() || password.length < (mode === 'login' ? 1 : 8) || (mode === 'create' && !invite.trim()) || (mode === 'recover' && !recovery.trim())}>
          {busy ? 'Chiffrement… (quelques secondes)' : mode === 'login' ? 'Se connecter' : mode === 'create' ? 'Créer mon compte' : 'Récupérer mon compte'}
        </Button>
      </form>
    </Card>
  );
}

/** Clé de secours : montrée une seule fois, à la création. */
function RecoveryKeyCard({ recoveryKey, onDone }: { recoveryKey: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <Card tone="warning">
      <p className="t-headline">Ta clé de secours</p>
      <p className="t-small mt-1 text-secondary">
        Si tu oublies ton mot de passe, c’est le <strong className="text-ink">seul</strong> moyen de récupérer tes données : personne, pas même le serveur, ne peut les déchiffrer sans. Note-la dans un gestionnaire de mots de passe ou sur papier.
      </p>
      <p className="t-headline mt-3 select-all break-all rounded-md p-3 text-center font-mono tracking-wide" style={{ background: 'var(--accent-soft)' }}>
        {recoveryKey}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon="receipt" onClick={() => void navigator.clipboard?.writeText(recoveryKey).then(() => toast({ message: 'Clé copiée' }))}>
          Copier
        </Button>
        <Button size="sm" variant={saved ? 'primary' : 'ghost'} icon="check" onClick={() => setSaved(true)}>
          Je l’ai notée
        </Button>
      </div>
      <Button className="mt-3 w-full" disabled={!saved} onClick={onDone}>
        Continuer
      </Button>
    </Card>
  );
}

/** Première synchro de cet appareil : envoyer ses données, ou prendre celles du compte. */
function JoinCard() {
  const [status, setStatus] = useState<{ count: number; lastUpdated: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    cloudAccountStatus().then(setStatus, (e: unknown) => setError(errorText(e)));
  }, []);

  const run = async (mode: 'auto' | 'useAccount' | 'useDevice') => {
    setBusy(true);
    setError(null);
    try {
      if (mode !== 'useDevice' && status && status.count > 0) await downloadLocalCopy();
      const r = await cloudJoin(mode);
      toast({ message: r.action === 'uploaded' ? `Données envoyées (chiffrées) : ${r.count} éléments` : `Données du compte récupérées : ${r.count} éléments`, tone: 'gold' });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card level="raised">
      <p className="t-headline">Synchroniser cet appareil</p>
      {!status && !error && <p className="t-small mt-2 text-secondary">Lecture du compte…</p>}
      {status && status.count === 0 && (
        <>
          <p className="t-small mt-2 text-secondary">Ton compte ne contient encore rien pour MyFinances : les données de cet appareil vont y être envoyées, chiffrées. Tes autres appareils les récupéreront.</p>
          <Button className="mt-3 w-full" icon="upload" disabled={busy} onClick={() => void run('auto')}>
            {busy ? 'Envoi…' : 'Envoyer mes données'}
          </Button>
        </>
      )}
      {status && status.count > 0 && (
        <>
          <p className="t-small mt-2 text-secondary">
            Ton compte contient déjà {status.count} éléments MyFinances{status.lastUpdated ? `, modifiés le ${formatDateTime(new Date(status.lastUpdated).toISOString())}` : ''}. Ils vont <strong className="text-ink">remplacer</strong> les données de cet appareil (une copie de celles-ci est d’abord téléchargée, par sécurité).
          </p>
          <Button className="mt-3 w-full" icon="download" disabled={busy} onClick={() => void run('useAccount')}>
            {busy ? 'Récupération…' : 'Récupérer les données du compte'}
          </Button>
          <Button variant="ghost" className="mt-2 w-full" disabled={busy} onClick={() => void run('useDevice')}>
            Garder plutôt celles de cet appareil (remplace le compte)
          </Button>
        </>
      )}
      {error && <p className="t-small mt-2 text-danger">{error}</p>}
    </Card>
  );
}

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Changer le mot de passe
      </Button>
    );
  return (
    <div className="space-y-2">
      <TextField label="Nouveau mot de passe" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
      <Button
        size="sm"
        disabled={busy || password.length < 8}
        onClick={() => {
          setBusy(true);
          void cloudChangePassword(password)
            .then(() => {
              toast({ message: 'Mot de passe changé. Ta clé de secours reste valable.' });
              setOpen(false);
              setPassword('');
            })
            .catch((e: unknown) => toast({ message: errorText(e), tone: 'danger' }))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Chiffrement…' : 'Enregistrer'}
      </Button>
    </div>
  );
}

export default function AccountPage() {
  const cloud = useCloud();
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  return (
    <Screen stack title="Compte MyLife" kicker="Synchronisation chiffrée" mood="settings" back="/reglages">
      <Reveal index={0}>
        <Card>
          <div className="flex items-start gap-3">
            <Icon name="lock" className="mt-0.5 text-accent" />
            <p className="t-small text-secondary">
              Un seul compte pour MyFinances et MyPerf, sur ton téléphone comme sur ton ordinateur. Tes données sont <strong className="text-ink">chiffrées sur ton appareil</strong> avec ton mot de passe : le serveur ne garde que des blocs illisibles et ne connaît pas ton mot de passe.
            </p>
          </div>
        </Card>
      </Reveal>

      <Reveal index={1} className="mt-3">
        {recoveryKey ? (
          <RecoveryKeyCard recoveryKey={recoveryKey} onDone={() => setRecoveryKey(null)} />
        ) : !cloud.session ? (
          <SignInCard onRecoveryKey={setRecoveryKey} />
        ) : !cloud.joined ? (
          <JoinCard />
        ) : (
          <Card level="raised">
            <div className="flex items-center justify-between gap-2">
              <p className="t-headline">{cloud.session.login}</p>
              {cloud.error ? <Badge tone="danger">Erreur</Badge> : cloud.syncing ? <Badge>Synchro…</Badge> : <Badge tone="success">Synchronisé</Badge>}
            </div>
            <p className="t-small mt-1 text-secondary">
              {cloud.lastSyncAt ? `Dernière synchro ${relativeTime(cloud.lastSyncAt)}` : 'Pas encore synchronisé'}
              {cloud.pending > 0 ? ` · ${cloud.pending} modification${cloud.pending > 1 ? 's' : ''} à envoyer` : ''}
            </p>
            {cloud.error && <p className="t-small mt-2 text-danger">{cloud.error}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" icon="sync" disabled={cloud.syncing} onClick={() => void syncCloud()}>
                Synchroniser
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void cloudSignOut().then(() => toast({ message: 'Déconnecté de cet appareil. Tes données y restent.' }))}>
                Se déconnecter
              </Button>
            </div>
            <div className="mt-2">
              <ChangePassword />
            </div>
          </Card>
        )}
      </Reveal>

      {cloud.session && cloud.joined && (
        <Reveal index={2}>
          <SectionTitle>Sur tes autres appareils</SectionTitle>
          <Card>
            <p className="t-small text-secondary">
              Ouvre MyFinances ou MyPerf, va dans Réglages → Compte et connecte-toi avec le même identifiant. Toutes les modifications se synchronisent ensuite toutes seules, à l’ouverture de l’app et quelques secondes après chaque changement.
            </p>
          </Card>
        </Reveal>
      )}
    </Screen>
  );
}
