import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, Field, Glass, Icon, IconButton, List, ListRow, ModuleCard, Notice, Panel, PasswordField, ScreenHeader, SectionTitle } from '@mylife/kit';
import { ApiError, changePassword, checkLogin, createAccount, deleteAccount, loginIssue, normalizeLogin, passwordIssue, passwordStrength, recoverAccount, renewRecoveryKey, signIn, signOut } from '@mylife/core/index';
import { currentSession, pendingRecovery, setPendingRecovery, webPlatform } from '@mylife/core/web';
import { useLogin, useSessionTick } from '../store';

/**
 * Le compte MyLife dans la coquille V5 : création en un écran (identifiant, mot de passe, c’est tout), connexion,
 * récupération par la clé de secours, puis gestion (mot de passe, nouvelle clé, déconnexion, suppression).
 * Toute la logique (chiffrement, API) vient du cœur ; ici, seulement l’écran.
 */

const errorText = (e: unknown) => (e instanceof ApiError && e.status === 0 ? 'Pas de réseau : réessaie une fois connecté.' : e instanceof Error ? e.message : String(e));

type Mode = 'create' | 'login' | 'recover';

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

function PasswordInput({ id, value, onChange, isNew, label, error, aside }: { id: string; value: string; onChange: (v: string) => void; isNew: boolean; label: string; error?: string | null; aside?: ReactNode }) {
  return (
    <Field id={id} label={label} error={error} aside={aside}>
      <PasswordField id={id} value={value} onChange={onChange} isNew={isNew} strength={isNew ? passwordStrength(value) : undefined} />
    </Field>
  );
}

/** Mise en page des écrans d'accès : la marque en haut (avec un retour éventuel), le contenu, le pied. */
function AuthScreen({ onBack, children, foot }: { onBack?: () => void; children: ReactNode; foot?: ReactNode }) {
  return (
    <>
      <div className="ml-bg" aria-hidden="true" />
      <main className="auth" id="contenu">
        <div className="auth-inner">
          <div className="auth-top">
            {onBack && <IconButton icon="back" label="Retour" onClick={onBack} />}
            <Brand />
          </div>
          {children}
          <div className="auth-foot">
            {foot}
            <a href="/confidentialite" className="link link-quiet t-small">
              Ce que MyLife garde, et pourquoi
            </a>
          </div>
        </div>
      </main>
    </>
  );
}

function Brand() {
  return (
    <div className="auth-brand">
      <img src="/favicon.svg" alt="" />
      <span>MyLife</span>
    </div>
  );
}

const TITLES = { create: 'Crée ton compte', login: 'Connecte-toi', recover: 'Récupère ton compte' } as const;
const LEADS = {
  create: 'Un identifiant et un mot de passe, c’est tout. Tes données sont chiffrées avant de quitter l’appareil.',
  login: 'Content de te revoir.',
  recover: 'Avec ta clé de secours, tu choisis un nouveau mot de passe et tu retrouves tout.',
} as const;

/** Créer un compte, se connecter, ou récupérer son compte. */
export function AccountForms({ mode, onMode, onDone }: { mode: Mode; onMode: (m: Mode) => void; onDone: (created: boolean) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availability = useAvailability(login, mode === 'create');
  const loginProblem = mode === 'create' && login ? loginIssue(login) : null;
  const pwProblem = mode !== 'login' && password ? passwordIssue(password, login) : null;
  const ready = !busy && !!login.trim() && (mode === 'login' ? password.length > 0 : !loginProblem && !passwordIssue(password, login)) && (mode !== 'create' || availability !== 'taken') && (mode !== 'recover' || recovery.trim().length >= 32);

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') {
        // La session n’est ouverte qu’une fois la clé de secours rangée sur l’appareil : l’écran suivant la montre.
        const held = { ...webPlatform, sessions: { get: webPlatform.sessions.get, set: async () => undefined } };
        const r = await createAccount(held, { login, password });
        setPendingRecovery({ login: r.session.login, key: r.recoveryKey });
        await webPlatform.sessions.set(r.session);
        onDone(true);
      } else if (mode === 'login') {
        await signIn(webPlatform, { login, password });
        onDone(false);
      } else {
        await recoverAccount(webPlatform, { login, recoveryKey: recovery, newPassword: password });
        onDone(false);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const switchTo = (m: Mode) => {
    onMode(m);
    setError(null);
  };
  const loginError = loginProblem ?? (availability === 'taken' ? 'Déjà pris : essaie une variante.' : null);
  const loginHint = mode === 'create' ? (availability === 'free' ? 'Libre' : availability === 'checking' ? 'Vérification…' : availability === 'offline' ? 'Hors ligne : vérifié à la création.' : 'Lettres, chiffres, tirets ; 3 à 24 caractères.') : undefined;
  return (
    <>
      <Glass as="section" className="auth-card">
        <form
          className="stack"
          style={{ gap: 16 }}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="stack" style={{ gap: 6 }}>
            <h1 className="auth-title">{TITLES[mode]}</h1>
            <span className="t-body muted">{LEADS[mode]}</span>
          </div>
          <Field id="login" label="Identifiant" error={loginError} hint={loginHint} hintTone={availability === 'free' ? 'ok' : undefined}>
            <input id="login" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={mode === 'create' ? 'Choisis un identifiant' : 'Ton identifiant'} enterKeyHint="next" />
          </Field>
          {mode === 'recover' && (
            <Field id="recovery" label="Clé de secours" hint="32 caractères, donnée à la création du compte.">
              <input id="recovery" className="mono" value={recovery} onChange={(e) => setRecovery(e.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX-…" />
            </Field>
          )}
          <PasswordInput
            id="password"
            label={mode === 'recover' ? 'Nouveau mot de passe' : 'Mot de passe'}
            value={password}
            onChange={setPassword}
            isNew={mode !== 'login'}
            error={pwProblem}
            aside={
              mode === 'login' ? (
                <button type="button" className="link link-quiet t-small" onClick={() => switchTo('recover')}>
                  Mot de passe oublié ?
                </button>
              ) : undefined
            }
          />
          {error && <Notice tone="bad">{error}</Notice>}
          <button type="submit" className="btn btn-action btn-block" disabled={!ready}>
            {busy ? 'Un instant…' : mode === 'create' ? 'Créer mon compte' : mode === 'login' ? 'Se connecter' : 'Récupérer mon compte'}
          </button>
        </form>
      </Glass>
      <p className="auth-switch" style={{ margin: 0 }}>
        {mode === 'create' ? 'Déjà un compte ? ' : mode === 'login' ? 'Pas encore de compte ? ' : 'Tu te souviens ? '}
        <button type="button" className="link" onClick={() => switchTo(mode === 'create' ? 'login' : mode === 'login' ? 'create' : 'login')}>
          {mode === 'login' ? 'Créer un compte' : 'Se connecter'}
        </button>
      </p>
    </>
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

/** La clé de secours : seul moyen de retrouver ses données si le mot de passe est perdu. */
export function RecoveryKeyPanel({ login, recoveryKey, onDone, first = false }: { login: string; recoveryKey: string; onDone: () => void; first?: boolean }) {
  const text = `Clé de secours MyLife\nIdentifiant : ${login}\nClé : ${recoveryKey}\n\nElle seule permet de retrouver ton compte si tu oublies ton mot de passe. Garde-la hors de ton téléphone (gestionnaire de mots de passe, papier).`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const [copied, setCopied] = useState(false);
  return (
    <ModuleCard tone="neutral" label="Ta clé de secours">
      <div className="pad stack">
        {first && <Badge tone="ok">Compte créé</Badge>}
        <span className="t-card">Ta clé de secours</span>
        <span className="t-small muted">Si tu oublies ton mot de passe, elle seule te rendra tes données : personne, pas même le serveur, ne peut les lire sans. Mets-la de côté, par exemple dans ton gestionnaire de mots de passe.</span>
        <p className="tile" style={{ margin: 0, padding: 12, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '4px 8px', textAlign: 'center', fontFamily: 'ui-monospace, monospace', fontSize: 17, fontWeight: 600, userSelect: 'all' }} aria-label={`Clé de secours : ${recoveryKey}`}>
          {recoveryKey.split('-').map((g, i) => (
            <span key={i}>{g}</span>
          ))}
        </p>
        <div className="grid-2">
          <Button
            onClick={() => {
              void navigator.clipboard?.writeText(recoveryKey).then(() => setCopied(true));
            }}
          >
            {copied ? 'Copiée' : 'Copier'}
          </Button>
          {canShare ? <Button onClick={() => void navigator.share({ title: 'Clé de secours MyLife', text }).catch(() => undefined)}>Partager</Button> : <Button onClick={() => saveFile(`mylife-cle-de-secours-${login}.txt`, text)}>Enregistrer</Button>}
        </div>
        <Button
          variant="action"
          block
          onClick={() => {
            setPendingRecovery(null);
            onDone();
          }}
        >
          C’est fait, je l’ai mise de côté
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Plus tard
        </Button>
      </div>
    </ModuleCard>
  );
}

/** Clé pas encore mise de côté : un rappel reste affiché jusqu’à « C’est fait ». */
export function RecoveryReminder() {
  useSessionTick();
  const pending = pendingRecovery();
  const [open, setOpen] = useState(false);
  if (!pending) return null;
  if (open) return <RecoveryKeyPanel login={pending.login} recoveryKey={pending.key} onDone={() => setOpen(false)} />;
  return (
    <button type="button" className="glass row" style={{ minHeight: 56, padding: '8px 14px', borderRadius: 16, textAlign: 'left', width: '100%' }} onClick={() => setOpen(true)}>
      <span style={{ color: 'var(--warn)' }}>
        <Icon name="lock" size={20} />
      </span>
      <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="t-strong">Mets de côté ta clé de secours</span>
        <span className="t-small muted">Sans elle, un mot de passe oublié = données perdues.</span>
      </span>
      <Icon name="chevron" size={16} />
    </button>
  );
}

/** Juste après la création du compte : la clé de secours, en plein écran, avant tout le reste. */
export function WelcomeKey() {
  const navigate = useNavigate();
  useSessionTick();
  const pending = pendingRecovery();
  if (!pending) return null;
  return (
    <AuthScreen>
      <RecoveryKeyPanel login={pending.login} recoveryKey={pending.key} first onDone={() => navigate('/', { replace: true })} />
    </AuthScreen>
  );
}

/** Bienvenue : le premier écran sans compte, puis création, connexion ou récupération. */
export function WelcomePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode | null>(params.get('mode') === 'login' ? 'login' : null);
  if (mode)
    return (
      <AuthScreen onBack={() => (mode === 'recover' ? setMode('login') : setMode(null))}>
        <AccountForms mode={mode} onMode={setMode} onDone={(created) => navigate(created ? '/bienvenue' : '/', { replace: true })} />
      </AuthScreen>
    );
  return (
    <AuthScreen
      foot={
        <div className="stack" style={{ gap: 10, width: '100%' }}>
          <Button variant="action" block onClick={() => setMode('create')}>
            Commencer
          </Button>
          <Button block onClick={() => setMode('login')}>
            J’ai déjà un compte
          </Button>
        </div>
      }
    >
      <div className="stack" style={{ gap: 12, marginTop: 'min(14vh, 120px)' }}>
        <h1 className="t-hero" style={{ margin: 0 }}>
          Ta vie,
          <br />
          en un seul endroit.
        </h1>
        <span className="t-body muted" style={{ fontSize: 17, lineHeight: '25px' }}>Tes finances, ton entraînement et tes sorties dans une seule app. Un compte, et tes données chiffrées sur ton appareil avant de le quitter.</span>
      </div>
    </AuthScreen>
  );
}

/** Le compte ouvert sur cet appareil : mot de passe, clé de secours, déconnexion, suppression. */
export function AccountPage() {
  const login = useLogin();
  const [panel, setPanel] = useState<'none' | 'password' | 'recovery' | 'delete'>('none');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const session = currentSession();
  if (!session || !login) return null;
  const open = (p: typeof panel) => {
    setPanel(panel === p ? 'none' : p);
    setPassword('');
    setError(null);
    setDone(null);
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
  return (
    <>
      <ScreenHeader kicker="Ton compte" title={login} />
      {freshKey ? (
        <RecoveryKeyPanel login={login} recoveryKey={freshKey} onDone={() => setFreshKey(null)} />
      ) : (
        <>
          <SectionTitle>Sécurité</SectionTitle>
          <List>
            <ListRow title="Changer le mot de passe" onClick={() => open('password')} />
            <ListRow title="Nouvelle clé de secours" onClick={() => open('recovery')} />
          </List>
          {panel === 'password' && (
            <Panel title="Changer le mot de passe">
              <PasswordInput id="new-password" label="Nouveau mot de passe" value={password} onChange={setPassword} isNew />
              {error && <Notice tone="bad">{error}</Notice>}
              {done && <Notice tone="ok">{done}</Notice>}
              <Button
                variant="action"
                block
                disabled={busy || !!passwordIssue(password, login)}
                onClick={() =>
                  void run(async () => {
                    await changePassword(webPlatform, session, password);
                    setPassword('');
                    setDone('Mot de passe changé.');
                  })
                }
              >
                Enregistrer
              </Button>
            </Panel>
          )}
          {panel === 'recovery' && (
            <Panel title="Nouvelle clé de secours">
              <span className="t-small muted">L’ancienne ne marchera plus. Tu devras mettre la nouvelle de côté.</span>
              {error && <Notice tone="bad">{error}</Notice>}
              <Button
                variant="action"
                block
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const key = await renewRecoveryKey(webPlatform, session);
                    setPendingRecovery({ login, key });
                    setFreshKey(key);
                    setPanel('none');
                  })
                }
              >
                Générer une nouvelle clé
              </Button>
            </Panel>
          )}
          <SectionTitle>Cet appareil</SectionTitle>
          <Button
            block
            onClick={() =>
              void run(async () => {
                await signOut(webPlatform);
                location.assign('/bienvenue');
              })
            }
          >
            Se déconnecter
          </Button>
          <span className="t-small muted">De toutes les apps MyLife de cet appareil. Tes données restent dans ton compte.</span>
          <SectionTitle>Danger</SectionTitle>
          <Button variant="danger" block onClick={() => open('delete')}>
            Supprimer mon compte
          </Button>
          {panel === 'delete' && (
            <Panel title="Supprimer le compte, pour de bon">
              <span className="t-small muted">Tout ce que le serveur garde pour toi est effacé tout de suite, pour toutes les apps. Les appareils gardent leurs données locales.</span>
              <PasswordInput id="confirm-password" label="Ton mot de passe, pour confirmer" value={password} onChange={setPassword} isNew={false} />
              {error && <Notice tone="bad">{error}</Notice>}
              <Button
                variant="danger"
                block
                disabled={busy || !password}
                onClick={() =>
                  void run(async () => {
                    await deleteAccount(webPlatform, session, password);
                    location.assign('/bienvenue');
                  })
                }
              >
                Supprimer définitivement
              </Button>
            </Panel>
          )}
        </>
      )}
    </>
  );
}
