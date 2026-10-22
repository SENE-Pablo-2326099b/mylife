import { useState } from 'react';
import { createAccount, signIn, type Session } from '../vendor/mylife-sync';
import { observable, useObservable } from '../lib/observable';
import { platform } from '../lib/session';
import { BrandMark, ErrorLine, Icon, useAction } from '../ui/kit';

/**
 * Clé de secours d'un compte tout juste créé : la session existe déjà, mais on la montre avant tout le
 * reste (une seule fois, jamais enregistrée).
 */
export const recovery = observable<{ key: string | null }>({ key: null });

export function RecoveryKey() {
  const { key } = useObservable(recovery);
  const [saved, setSaved] = useState(false);
  if (!key) return null;
  return (
    <main className="screen">
      <div className="card raised stack">
        <h1 className="h2">Ta clé de secours MyLife</h1>
        <p className="muted small" style={{ margin: 0 }}>
          Elle seule permet de retrouver ton compte si tu oublies ton mot de passe. Elle ne sera plus jamais affichée : note-la hors
          de ce téléphone.
        </p>
        <code className="key">{key}</code>
        <button type="button" className="btn small" onClick={() => void navigator.clipboard?.writeText(key).catch(() => undefined)}>
          <Icon name="copy" size={18} /> Copier
        </button>
        <label className="row small">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} style={{ width: 22, height: 22 }} />
          Je l’ai notée en lieu sûr
        </label>
        <button type="button" className="btn primary block" disabled={!saved} onClick={() => recovery.set({ key: null })}>
          Continuer
        </button>
      </div>
    </main>
  );
}

/**
 * Connexion au compte MyLife (le même que MyFinances et MyPerf : pas de compte à part). Déjà connecté
 * dans une autre app de MyLife sur ce navigateur ? Cet écran n'apparaît pas.
 */
export function Auth({ expired, invited }: { expired: boolean; invited: boolean }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const action = useAction();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      if (mode === 'login') await signIn(platform, { login, password });
      else {
        // La session n'est enregistrée qu'après la clé de secours : l'app montre la clé avant tout autre écran.
        let created: Session | null = null;
        const held = { ...platform, sessions: { get: platform.sessions.get, set: async (x: Session | null) => void (created = x) } };
        const r = await createAccount(held, { login, password, invite });
        recovery.set({ key: r.recoveryKey });
        await platform.sessions.set(created ?? r.session);
      }
    });
  };

  return (
    <main className="screen">
      <div className="row" style={{ marginTop: 12 }}>
        <BrandMark size={52} />
        <div>
          <h1 className="title">myRaveLoc</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Retrouver ses amis dans la foule.
          </p>
        </div>
      </div>

      {expired && (
        <div className="banner warn" role="status">
          <Icon name="alert" />
          <span>Session expirée : reconnecte-toi. Ton partage de position est suspendu en attendant.</span>
        </div>
      )}
      {invited && (
        <div className="banner info" role="status">
          <Icon name="users" />
          <span>Tu as reçu une invitation. Connecte-toi pour rejoindre le groupe.</span>
        </div>
      )}

      <form className="card stack" onSubmit={submit}>
        <h2 className="h2">{mode === 'login' ? 'Connexion à MyLife' : 'Créer ton compte MyLife'}</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Le même compte que MyFinances et MyPerf. Ton mot de passe ne quitte jamais ce téléphone.
        </p>
        <label className="field">
          <span className="label">Identifiant</span>
          <input autoComplete="username" autoCapitalize="none" spellCheck={false} value={login} onChange={(e) => setLogin(e.target.value)} required minLength={3} />
        </label>
        <label className="field">
          <span className="label">Mot de passe</span>
          <input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'signup' ? 8 : 1} />
        </label>
        {mode === 'signup' && (
          <label className="field">
            <span className="label">Code d’invitation MyLife</span>
            <input autoCapitalize="none" spellCheck={false} value={invite} onChange={(e) => setInvite(e.target.value)} required />
            <span className="faint tiny">Demande-le à la personne qui t’a invité·e sur MyLife.</span>
          </label>
        )}
        <ErrorLine error={action.error} />
        <button type="submit" className="btn primary block big" disabled={action.busy}>
          {action.busy ? (mode === 'login' ? 'Connexion…' : 'Création…') : mode === 'login' ? 'Se connecter' : 'Créer le compte'}
        </button>
        {action.busy && <p className="faint tiny" style={{ margin: 0 }}>Calcul de la clé sur l’appareil : quelques secondes sur un téléphone.</p>}
      </form>

      <button type="button" className="btn ghost" onClick={() => (setMode(mode === 'login' ? 'signup' : 'login'), action.setError(null))}>
        {mode === 'login' ? 'Créer un compte MyLife' : 'J’ai déjà un compte'}
      </button>
    </main>
  );
}
