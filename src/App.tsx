import { Component, useEffect, type ReactNode } from 'react';
import { observable, useObservable } from './lib/observable';
import { inviteParts } from './lib/groupCrypto';
import { app } from './state/app';
import { go, route } from './state/nav';
import { Auth, recovery, RecoveryKey } from './screens/Auth';
import { Home } from './screens/Home';
import { Navigate } from './screens/Navigate';
import { Manage } from './screens/Manage';
import { CreateGroup, Groups, Join } from './screens/Groups';

const INVITE_KEY = 'raveloc:invite';

/** Invitation en attente (lien ouvert), gardée le temps de la session de l'onglet : elle survit à la connexion. */
const invitation = observable<{ value: { token: string; key: string } | null }>({ value: readInvite() });

function readInvite(): { token: string; key: string } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(INVITE_KEY) ?? 'null') as { token: string; key: string } | null;
    return v && typeof v.token === 'string' && typeof v.key === 'string' ? v : null;
  } catch {
    return null;
  }
}

function setInvite(value: { token: string; key: string } | null) {
  try {
    if (value) sessionStorage.setItem(INVITE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(INVITE_KEY);
  } catch {
    /* navigation privée stricte : l'invitation ne survivra pas à un rechargement */
  }
  invitation.set({ value });
}

/**
 * Lien d'invitation ouvert (au chargement, ou collé dans l'onglet où l'app tourne déjà) : on le garde
 * et on l'efface tout de suite de la barre d'adresse (historique, captures d'écran).
 */
export function captureInvite(): void {
  const parts = inviteParts(window.location.hash);
  if (!parts) return;
  setInvite(parts);
  history.replaceState(history.state, '', window.location.pathname + window.location.search);
}

if (typeof window !== 'undefined') window.addEventListener('hashchange', captureInvite);

export function App() {
  const s = useObservable(app);
  const r = useObservable(route);
  const rec = useObservable(recovery);
  const invite = useObservable(invitation).value;
  const signedIn = !!s.session && !s.sessionExpired;

  useEffect(() => {
    if (!signedIn || !invite || rec.key) return;
    setInvite(null);
    go({ name: 'join', token: invite.token, key: invite.key });
  }, [signedIn, invite?.token, rec.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (rec.key) return <RecoveryKey />;
  if (!signedIn) return <Auth expired={s.sessionExpired} invited={!!invite} />;
  switch (r.name) {
    case 'navigate':
      return <Navigate uid={r.uid} />;
    case 'manage':
      return <Manage />;
    case 'groups':
      return <Groups />;
    case 'create':
      return <CreateGroup />;
    case 'join':
      return <Join token={r.token} keyText={r.key} />;
    default:
      return <Home />;
  }
}

/** Une erreur d'affichage ne laisse jamais un écran vide. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="screen">
        <div className="card empty">
          <h1 className="h2">Un problème d’affichage est survenu</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {this.state.error.message}
          </p>
          <button type="button" className="btn primary" onClick={() => window.location.reload()}>
            Recharger
          </button>
        </div>
      </main>
    );
  }
}
