import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  changePassword,
  checkLogin,
  createAccount,
  deleteAccount,
  loginIssue,
  normalizeLogin,
  passwordIssue,
  passwordStrength,
  recoverAccount,
  renewRecoveryKey,
  signIn,
  signOut,
  type Session,
} from '../vendor/mylife-sync';
import { setPendingRecovery, webPlatform } from '../vendor/mylife-sync/web';
import { errorText, usePendingRecovery } from './session';
import { Icon } from './icons';
import { Button, Card, PasswordField, TextField } from './primitives';
import { toast } from './toastStore';

/**
 * Compte MyLife sur le web : les mêmes écrans dans toutes les apps (création, connexion, oubli, clé de
 * secours, gestion). Un seul compte pour toutes : se connecter dans une app connecte les autres.
 *
 * Création comme dans une app ordinaire : un identifiant, un mot de passe (le gestionnaire du téléphone
 * peut le proposer et l'enregistrer), c'est tout. La clé de secours vient après, et peut attendre.
 */

type Mode = 'create' | 'login' | 'recover';

/** L'identifiant est-il libre ? Réponse pendant la saisie (après une courte pause). */
function useAvailability(login: string, enabled: boolean): 'idle' | 'checking' | 'free' | 'taken' | 'offline' {
  const [state, setState] = useState<'idle' | 'checking' | 'free' | 'taken' | 'offline'>('idle');
  const seq = useRef(0);
  useEffect(() => {
    const value = normalizeLogin(login);
    if (!enabled || loginIssue(value)) {
      setState('idle');
      return;
    }
    const n = ++seq.current;
    setState('checking');
    const t = setTimeout(() => {
      checkLogin(webPlatform.api, value).then(
        (free) => n === seq.current && setState(free ? 'free' : 'taken'),
        () => n === seq.current && setState('offline'),
      );
    }, 350);
    return () => clearTimeout(t);
  }, [login, enabled]);
  return state;
}

/**
 * Créer un compte, se connecter, ou récupérer son compte. `onDone` : le compte est ouvert sur cet
 * appareil (et `created` vrai pour un compte neuf, dont la clé de secours vient d'être montrée).
 */
export function AccountForms({ initial = 'create', onDone, skip }: { initial?: Mode; onDone?: (created: boolean) => void; skip?: ReactNode }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availability = useAvailability(login, mode === 'create');

  const loginProblem = login ? loginIssue(login) : null;
  const pwProblem = mode === 'login' ? null : password ? passwordIssue(password, login) : null;
  const ready =
    !busy &&
    !!login.trim() &&
    (mode === 'login' ? password.length > 0 : !loginProblem && !passwordIssue(password, login)) &&
    (mode !== 'create' || availability !== 'taken') &&
    (mode !== 'recover' || recovery.trim().length >= 32);

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') {
        // La session n'est ouverte qu'une fois la clé de secours rangée : l'écran qui suit la montre aussitôt.
        const held = { ...webPlatform, sessions: { get: webPlatform.sessions.get, set: async () => undefined } };
        const r = await createAccount(held, { login, password });
        // Gardée sur l'appareil tant qu'elle n'est pas confirmée « mise de côté » (RecoveryReminder).
        setPendingRecovery({ login: r.session.login, key: r.recoveryKey });
        await webPlatform.sessions.set(r.session);
        onDone?.(true);
      } else if (mode === 'login') {
        await signIn(webPlatform, { login, password });
        onDone?.(false);
      } else {
        await recoverAccount(webPlatform, { login, recoveryKey: recovery, newPassword: password });
        toast({ message: 'Compte récupéré : ton nouveau mot de passe est enregistré.', tone: 'gold' });
        onDone?.(false);
      }
    } catch (e) {
      setError(errorText(e));
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
    mode !== 'create'
      ? undefined
      : availability === 'checking'
        ? 'Vérification…'
        : availability === 'free'
          ? (
              <span className="inline-flex items-center gap-1 text-success">
                <Icon name="check" size={14} /> Libre
              </span>
            )
          : availability === 'offline'
            ? 'Disponibilité vérifiée à la création.'
            : 'Ton nom sur MyLife : lettres, chiffres, . _ - @';

  return (
    <Card level="raised">
      <form
        className="flex flex-col gap-3"
        // Noms distincts pour la création et la connexion : les gestionnaires de mots de passe les reconnaissent.
        name={mode === 'create' ? 'mylife-signup' : 'mylife-signin'}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <p className="t-title">{mode === 'create' ? 'Crée ton compte' : mode === 'login' ? 'Connexion' : 'Mot de passe oublié'}</p>
          <p className="t-small mt-1 text-secondary">
            {mode === 'create'
              ? 'Un seul compte pour toutes tes apps MyLife, sur tous tes appareils. Tes données sont chiffrées sur ton téléphone avant d’être sauvegardées.'
              : mode === 'login'
                ? 'Le même compte pour MyFinances, MyPerf et myRaveLoc.'
                : 'Ta clé de secours te redonne accès à ton compte, avec un nouveau mot de passe.'}
          </p>
        </div>
        <TextField
          label="Identifiant"
          name="username"
          value={login}
          onChange={setLogin}
          plain
          autoComplete="username"
          placeholder="ex. pablo"
          hint={loginHint}
          error={(mode === 'create' && loginProblem) || (mode === 'create' && availability === 'taken' ? 'Déjà pris : essaie une variante.' : undefined)}
          enterKeyHint="next"
          autoFocus
        />
        {mode === 'recover' && <TextField label="Clé de secours" name="recovery-key" value={recovery} onChange={setRecovery} mono placeholder="XXXX-XXXX-XXXX-…" hint="32 caractères, donnée à la création du compte." />}
        <PasswordField
          label={mode === 'recover' ? 'Nouveau mot de passe' : 'Mot de passe'}
          name={mode === 'login' ? 'password' : 'new-password'}
          value={password}
          onChange={setPassword}
          isNew={mode !== 'login'}
          strength={passwordStrength(password)}
          issue={pwProblem}
          enterKeyHint="go"
        />
        {error && (
          <p className="t-small text-danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="mt-1 w-full" disabled={!ready}>
          {busy ? (mode === 'create' ? 'Création…' : mode === 'login' ? 'Connexion…' : 'Récupération…') : mode === 'create' ? 'Créer mon compte' : mode === 'login' ? 'Se connecter' : 'Récupérer mon compte'}
        </Button>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {mode !== 'login' && (
            <Button variant="ghost" size="sm" onClick={() => switchTo('login')}>
              J’ai déjà un compte
            </Button>
          )}
          {mode === 'login' && (
            <>
              <Button variant="ghost" size="sm" onClick={() => switchTo('create')}>
                Créer un compte
              </Button>
              <Button variant="ghost" size="sm" onClick={() => switchTo('recover')}>
                Mot de passe oublié ?
              </Button>
            </>
          )}
        </div>
        {skip}
      </form>
    </Card>
  );
}

function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * La clé de secours : seul moyen de retrouver ses données si le mot de passe est perdu (le chiffrement
 * de bout en bout interdit toute « réinitialisation par courriel »). Copier, enregistrer, partager ;
 * « Plus tard » la garde sur cet appareil et un rappel reste affiché jusqu'à « C'est fait ».
 */
export function RecoveryKeyPanel({ login, recoveryKey, onDone, first = false }: { login: string; recoveryKey: string; onDone: () => void; first?: boolean }) {
  const text = `Clé de secours MyLife\nIdentifiant : ${login}\nClé : ${recoveryKey}\n\nElle seule permet de retrouver ton compte si tu oublies ton mot de passe. Garde-la hors de ton téléphone (gestionnaire de mots de passe, papier).`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <Card level="raised" tone="gold">
      {first && (
        <p className="t-label flex items-center gap-1.5 text-success">
          <Icon name="check-circle" size={16} /> Compte créé
        </p>
      )}
      <p className="t-title mt-1">Ta clé de secours</p>
      <p className="t-small mt-1 text-secondary">
        Si tu oublies ton mot de passe, elle seule te rendra tes données : personne, pas même le serveur, ne peut les lire sans. Mets-la de côté, par exemple dans ton gestionnaire de mots de passe.
      </p>
      {/* Deux lignes de quatre groupes : jamais un groupe coupé en deux. Sélectionnable d'un geste. */}
      <p className="mt-3 grid select-all grid-cols-4 gap-x-2 gap-y-1 rounded-md p-3 text-center font-mono text-[17px] font-semibold tracking-wide" style={{ background: 'var(--gold-soft)' }} aria-label={`Clé de secours : ${recoveryKey}`}>
        {recoveryKey.split('-').map((g, i) => (
          <span key={i}>{g}</span>
        ))}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" icon="copy" onClick={() => void navigator.clipboard?.writeText(recoveryKey).then(() => toast({ message: 'Clé copiée' }))}>
          Copier
        </Button>
        {canShare ? (
          <Button variant="secondary" size="sm" icon="share" onClick={() => void navigator.share({ title: 'Clé de secours MyLife', text }).catch(() => undefined)}>
            Partager
          </Button>
        ) : (
          <Button variant="secondary" size="sm" icon="download" onClick={() => saveFile(`mylife-cle-de-secours-${login}.txt`, text)}>
            Enregistrer
          </Button>
        )}
      </div>
      <Button
        className="mt-3 w-full"
        icon="check"
        onClick={() => {
          setPendingRecovery(null);
          onDone();
        }}
      >
        C’est fait, je l’ai mise de côté
      </Button>
      <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={onDone}>
        Plus tard
      </Button>
    </Card>
  );
}

const LATER_KEY = 'mylife:recovery-later';

/**
 * Clé de secours pas encore mise de côté : ouverte d'emblée juste après la création du compte (dans
 * l'app où il vient d'être créé), puis réduite à un rappel jusqu'à « C'est fait ».
 */
export function RecoveryReminder() {
  const pending = usePendingRecovery();
  const [open, setOpen] = useState(() => {
    const p = pending;
    if (!p || Date.now() - p.at > 10 * 60_000) return false;
    try {
      return sessionStorage.getItem(LATER_KEY) !== String(p.at);
    } catch {
      return true;
    }
  });
  if (!pending) return null;
  if (open)
    return (
      <RecoveryKeyPanel
        login={pending.login}
        recoveryKey={pending.key}
        first={Date.now() - pending.at < 10 * 60_000}
        onDone={() => {
          try {
            sessionStorage.setItem(LATER_KEY, String(pending.at));
          } catch {
            /* rappel seulement pour cette page */
          }
          setOpen(false);
        }}
      />
    );
  return (
    <Card tone="warning" onClick={() => setOpen(true)} label="Mettre de côté ma clé de secours">
      <span className="flex items-center gap-3">
        <Icon name="key" className="text-warning" />
        <span className="min-w-0 flex-1">
          <span className="t-body-strong block">Mets de côté ta clé de secours</span>
          <span className="t-small block text-secondary">Sans elle, un mot de passe oublié = données perdues.</span>
        </span>
        <Icon name="chevron-forward" className="text-muted" />
      </span>
    </Card>
  );
}

/** Une ligne d'état (synchro d'une app, banques…) dans la carte du compte. */
export interface AccountStatusRow {
  label: string;
  detail: string;
  state: 'ok' | 'busy' | 'error' | 'off';
  action?: { label: string; onClick: () => void };
}

function Dot({ state }: { state: AccountStatusRow['state'] }) {
  const color = state === 'error' ? 'var(--danger)' : state === 'busy' ? 'var(--accent)' : state === 'ok' ? 'var(--success)' : 'var(--text-muted)';
  return <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${state === 'busy' ? 'animate-pulse' : ''}`} style={{ background: color, boxShadow: `0 0 10px ${color}` }} />;
}

/** Le compte ouvert sur cet appareil : état, mot de passe, clé de secours, déconnexion, suppression. */
export function AccountOverview({ session, rows = [], children }: { session: Session; rows?: AccountStatusRow[]; children?: ReactNode }) {
  const [panel, setPanel] = useState<'none' | 'password' | 'recovery' | 'delete'>('none');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const initial = (session.login[0] ?? '?').toUpperCase();

  const open = (p: typeof panel) => {
    setPanel(panel === p ? 'none' : p);
    setPassword('');
    setError(null);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (freshKey) return <RecoveryKeyPanel login={session.login} recoveryKey={freshKey} onDone={() => setFreshKey(null)} />;

  return (
    <div className="flex flex-col gap-3">
      <RecoveryReminder />
      <Card level="raised">
        <div className="flex items-center gap-3">
          <span className="liquid flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-display text-[20px] font-bold">{initial}</span>
          <span className="min-w-0 flex-1">
            <span className="t-headline block truncate">{session.login}</span>
            <span className="t-small block text-secondary">Compte MyLife · chiffré de bout en bout</span>
          </span>
        </div>
        {rows.length > 0 && (
          <div className="mt-3 flex flex-col">
            {rows.map((r) => (
              <div key={r.label} className="flex min-h-[52px] items-center gap-3 border-t border-line py-2">
                <Dot state={r.state} />
                <span className="min-w-0 flex-1">
                  <span className="t-body-strong block">{r.label}</span>
                  <span className="t-small block truncate text-secondary">{r.detail}</span>
                </span>
                {r.action && (
                  <Button variant="ghost" size="sm" onClick={r.action.onClick}>
                    {r.action.label}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {children}
      </Card>

      <Card className="flex flex-col gap-1 py-2">
        <AccountAction icon="lock" label="Changer le mot de passe" onClick={() => open('password')} />
        {panel === 'password' && (
          <div className="flex flex-col gap-2 pb-2">
            <PasswordField label="Nouveau mot de passe" name="new-password" isNew value={password} onChange={setPassword} strength={passwordStrength(password)} issue={password ? passwordIssue(password, session.login) : null} />
            {error && <p className="t-small text-danger">{error}</p>}
            <Button
              disabled={busy || !!passwordIssue(password, session.login)}
              onClick={() =>
                void run(async () => {
                  await changePassword(webPlatform, session, password);
                  toast({ message: 'Mot de passe changé. Ta clé de secours reste valable.', tone: 'gold' });
                  open('none');
                })
              }
            >
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        )}
        <AccountAction icon="key" label="Nouvelle clé de secours" onClick={() => open('recovery')} />
        {panel === 'recovery' && (
          <div className="flex flex-col gap-2 pb-2">
            <p className="t-small text-secondary">L’ancienne clé cessera de fonctionner.</p>
            {error && <p className="t-small text-danger">{error}</p>}
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const key = await renewRecoveryKey(webPlatform, session);
                  setPendingRecovery({ login: session.login, key });
                  setFreshKey(key);
                  open('none');
                })
              }
            >
              {busy ? 'Création…' : 'Créer une nouvelle clé'}
            </Button>
          </div>
        )}
        <AccountAction
          icon="logout"
          label="Se déconnecter"
          onClick={() => void signOut(webPlatform).then(() => toast({ message: 'Déconnecté de toutes tes apps sur cet appareil. Tes données y restent.' }))}
        />
        <AccountAction icon="trash" label="Supprimer mon compte" danger onClick={() => open('delete')} />
        {panel === 'delete' && (
          <div className="flex flex-col gap-2 pb-2">
            <p className="t-small text-secondary">
              Ton compte et tout ce qu’il sauvegarde sont effacés du serveur, pour toutes les apps. Ce qui est sur tes appareils y reste. C’est définitif.
            </p>
            <PasswordField label="Ton mot de passe, pour confirmer" name="password" value={password} onChange={setPassword} />
            {error && <p className="t-small text-danger">{error}</p>}
            <Button
              variant="danger"
              disabled={busy || !password}
              onClick={() =>
                void run(async () => {
                  await deleteAccount(webPlatform, session, password);
                  toast({ message: 'Compte supprimé. Tes données restent sur cet appareil.' });
                })
              }
            >
              {busy ? 'Suppression…' : 'Supprimer définitivement'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function AccountAction({ icon, label, onClick, danger = false }: { icon: 'lock' | 'key' | 'logout' | 'trash'; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`hl flex min-h-[48px] items-center gap-3 rounded-md px-1 text-left ${danger ? 'text-danger' : ''}`}>
      <Icon name={icon} size={19} className={danger ? 'text-danger' : 'text-accent'} />
      <span className="t-body-strong flex-1">{label}</span>
      <Icon name="chevron-forward" size={16} className="text-muted" />
    </button>
  );
}
