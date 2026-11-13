import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, Field, Glass, Icon, ModuleCard, ScreenHeader, SectionTitle } from '@mylife/kit';
import { ApiError, changePassword, checkLogin, createAccount, deleteAccount, loginIssue, normalizeLogin, passwordIssue, passwordStrength, recoverAccount, renewRecoveryKey, signIn, signOut } from '@mylife/core/index';
import { currentSession, pendingRecovery, setPendingRecovery, webPlatform } from '@mylife/core/web';
import { useLogin, useSessionTick } from '../store';

/**
 * Le compte MyLife dans la coquille V5 : création en un écran (identifiant, mot de passe, c'est tout), connexion,
 * récupération par la clé de secours, puis gestion (mot de passe, nouvelle clé, déconnexion, suppression).
 * Toute la logique (chiffrement, API) vient du cœur ; ici, seulement l'écran.
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

function PasswordInput({ id, value, onChange, isNew, label }: { id: string; value: string; onChange: (v: string) => void; isNew: boolean; label: string }) {
  const [shown, setShown] = useState(false);
  const strength = passwordStrength(value);
  return (
    <Field id={id} label={label} hint={isNew && value ? ['Trop court', 'Faible', 'Moyen', 'Bon', 'Très bon'][strength] : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input id={id} type={shown ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={isNew ? 'new-password' : 'current-password'} enterKeyHint="go" style={{ flex: 1, minWidth: 0 }} />
        <button type="button" className="btn btn-quiet" style={{ flex: 'none', minHeight: 44, fontSize: 13, padding: '0 10px' }} onClick={() => setShown((s) => !s)}>
          {shown ? 'Cacher' : 'Voir'}
        </button>
      </div>
      {isNew && value && (
        <div className="progress" aria-hidden="true">
          <span style={{ width: `${(strength / 4) * 100}%` }} />
        </div>
      )}
    </Field>
  );
}

/** Créer un compte, se connecter, ou récupérer son compte. */
export function AccountForms({ initial = 'create', onDone }: { initial?: Mode; onDone: (created: boolean) => void }) {
  const [mode, setMode] = useState<Mode>(initial);
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
        // La session n'est ouverte qu'une fois la clé de secours rangée sur l'appareil : l'écran suivant la montre.
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
    setMode(m);
    setError(null);
  };
  const loginHint = mode === 'create' ? (availability === 'free' ? 'Libre' : availability === 'checking' ? 'Vérification…' : availability === 'offline' ? 'Hors ligne : vérifié à la création.' : 'Lettres, chiffres, tirets ; 3 à 24 caractères.') : undefined;
  const titles = { create: 'Crée ton compte', login: 'Connecte-toi', recover: 'Récupère ton compte' };
  return (
    <Glass as="section" className="pad">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <span className="t-card">{titles[mode]}</span>
        {mode === 'create' && <span className="t-small muted">Un identifiant et un mot de passe. Pas de courriel, pas de code. Tes données sont chiffrées avant de quitter l'appareil.</span>}
        <Field id="login" label="Identifiant" hint={loginProblem ?? (availability === 'taken' ? 'Déjà pris : essaie une variante.' : loginHint)}>
          <input id="login" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" placeholder="Choisis un identifiant" enterKeyHint="next" />
        </Field>
        {mode === 'recover' && (
          <Field id="recovery" label="Clé de secours" hint="32 caractères, donnée à la création du compte.">
            <input id="recovery" value={recovery} onChange={(e) => setRecovery(e.target.value)} autoCapitalize="characters" autoCorrect="off" placeholder="XXXX-XXXX-XXXX-…" style={{ fontFamily: 'ui-monospace, monospace' }} />
          </Field>
        )}
        <PasswordInput id="password" label={mode === 'recover' ? 'Nouveau mot de passe' : 'Mot de passe'} value={password} onChange={setPassword} isNew={mode !== 'login'} />
        {pwProblem && <span className="t-small" style={{ color: 'var(--warn)' }}>{pwProblem}</span>}
        {error && (
          <span className="t-small" role="alert" style={{ color: 'var(--bad)' }}>
            {error}
          </span>
        )}
        <button type="submit" className="btn btn-action btn-block" disabled={!ready}>
          {busy ? 'Un instant…' : mode === 'create' ? 'Créer mon compte' : mode === 'login' ? 'Se connecter' : 'Récupérer mon compte'}
        </button>
        <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap', gap: 4 }}>
          {mode !== 'login' && (
            <Button variant="quiet" onClick={() => switchTo('login')}>
              J’ai déjà un compte
            </Button>
          )}
          {mode === 'login' && (
            <>
              <Button variant="quiet" onClick={() => switchTo('create')}>
                Créer un compte
              </Button>
              <Button variant="quiet" onClick={() => switchTo('recover')}>
                Mot de passe oublié ?
              </Button>
            </>
          )}
        </div>
      </form>
    </Glass>
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

/** Clé pas encore mise de côté : un rappel reste affiché jusqu'à « C'est fait ». */
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
    <>
      <div className="ml-bg" aria-hidden="true" />
      <main className="shell-main" id="contenu">
        <div className="stack" style={{ maxWidth: 440, margin: '40px auto 0' }}>
          <RecoveryKeyPanel login={pending.login} recoveryKey={pending.key} first onDone={() => navigate('/', { replace: true })} />
        </div>
      </main>
    </>
  );
}

/** Bienvenue : le premier écran sans compte. */
export function WelcomePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState<'intro' | 'account'>(params.get('mode') === 'login' ? 'account' : 'intro');
  const [initial, setInitial] = useState<Mode>(params.get('mode') === 'login' ? 'login' : 'create');
  if (step === 'account')
    return (
      <div className="stack" style={{ maxWidth: 440, margin: '40px auto 0' }}>
        <AccountForms initial={initial} onDone={(created) => navigate(created ? '/bienvenue' : '/', { replace: true })} />
        <a href="/confidentialite" className="t-small muted" style={{ textAlign: 'center', textDecoration: 'underline' }}>
          Ce que MyLife garde, et pourquoi
        </a>
      </div>
    );
  return (
    <div className="stack" style={{ maxWidth: 440, margin: '60px auto 0', gap: 24 }}>
      <div className="stack" style={{ gap: 8 }}>
        <span className="t-hero">MyLife</span>
        <span className="t-card" style={{ fontWeight: 600 }}>Tes finances, ton entraînement et tes sorties dans une seule app.</span>
        <span className="t-body muted">Un compte, une installation, et tes données chiffrées sur ton appareil avant de le quitter.</span>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <Button variant="action" block onClick={() => setStep('account')}>
          Commencer
        </Button>
        <Button
          block
          onClick={() => {
            setInitial('login');
            setStep('account');
          }}
        >
          J’ai déjà un compte
        </Button>
      </div>
      <a href="/confidentialite" className="t-small muted" style={{ textAlign: 'center', textDecoration: 'underline' }}>
        Ce que MyLife garde, et pourquoi
      </a>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Glass className="pad stack">
      <span className="t-strong">{title}</span>
      {children}
    </Glass>
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
      <RecoveryReminder />
      {freshKey ? (
        <RecoveryKeyPanel login={login} recoveryKey={freshKey} onDone={() => setFreshKey(null)} />
      ) : (
        <>
          <SectionTitle>Sécurité</SectionTitle>
          <Glass className="stack-0">
            <button type="button" className="list-row" style={{ padding: '6px 16px', background: 'none', border: 0, textAlign: 'left', width: '100%' }} onClick={() => open('password')}>
              <span className="grow t-body" style={{ fontWeight: 500 }}>Changer le mot de passe</span>
              <Icon name="chevron" size={18} />
            </button>
            <button type="button" className="list-row" style={{ padding: '6px 16px', background: 'none', border: 0, textAlign: 'left', width: '100%' }} onClick={() => open('recovery')}>
              <span className="grow t-body" style={{ fontWeight: 500 }}>Nouvelle clé de secours</span>
              <Icon name="chevron" size={18} />
            </button>
          </Glass>
          {panel === 'password' && (
            <Panel title="Nouveau mot de passe">
              <PasswordInput id="new-password" label="Nouveau mot de passe" value={password} onChange={setPassword} isNew />
              {error && <span className="t-small" style={{ color: 'var(--bad)' }}>{error}</span>}
              {done && <span className="t-small c-ok">{done}</span>}
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
              <span className="t-small muted">L'ancienne ne marchera plus. Tu devras mettre la nouvelle de côté.</span>
              {error && <span className="t-small" style={{ color: 'var(--bad)' }}>{error}</span>}
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
                location.assign('/v5/bienvenue');
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
              {error && <span className="t-small" style={{ color: 'var(--bad)' }}>{error}</span>}
              <Button
                variant="danger"
                block
                disabled={busy || !password}
                onClick={() =>
                  void run(async () => {
                    await deleteAccount(webPlatform, session, password);
                    location.assign('/v5/bienvenue');
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
