import { useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { observable, useObservable } from './lib/observable';
import { inviteParts } from './lib/groupCrypto';
import { app } from './state/app';
import { Beacon, setBeacon } from './components/Beacon';
import { RavelocPalette } from './components/Palette';
import { AuthScreen } from './screens/Auth';
import { AccountScreen } from './screens/Account';
import { Home } from './screens/Home';
import { Navigate } from './screens/Navigate';
import { Manage } from './screens/Manage';
import { CreateGroup, Groups, Join } from './screens/Groups';
import { Backdrop } from './ui/Backdrop';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { setGlance } from './ui/glance';
import { Navigation, type TabDef } from './ui/Navigation';
import { KeptTabs, PushedScreen } from './ui/PageTransition';
import { setPaletteOpen } from './ui/paletteStore';
import { NotFoundScreen } from './ui/Screen';
import { useSession } from './ui/session';
import { ThemeProvider } from './ui/ThemeProvider';
import { ToastHost } from './ui/toast';

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

const TABS: TabDef[] = [
  { to: '/', label: 'Retrouver', icon: 'navigate-outline', active: 'navigate', match: ['/', '/ami'] },
  { to: '/groupes', label: 'Groupes', icon: 'people', active: 'people-fill', match: ['/groupes', '/groupe'] },
];
const TAB_PATHS = TABS.map((t) => t.to);

/** Aperçu pour l'accueil MyLife et les Espaces : le groupe actif et ce qu'on y partage. */
function useRavelocGlance() {
  const s = useObservable(app);
  const group = s.groups.list.find((g) => g.id === s.activeId) ?? null;
  const live = s.live?.gid === group?.id ? s.live : null;
  const sharingFriends = live ? live.members.filter((m) => !m.me && m.sharing === 'on').length : null;
  const title = !s.session ? null : group ? (group.name ?? 'Groupe') : s.groups.status === 'ready' ? 'Aucun groupe en cours' : null;
  const detail = !group
    ? 'Crée un groupe pour ta prochaine sortie'
    : `${group.sharing === 'on' ? 'Tu partages ta position' : group.sharing === 'paused' ? 'Partage en pause' : 'Partage coupé'}${sharingFriends ? ` · ${sharingFriends} ami${sharingFriends > 1 ? 's' : ''} visible${sharingFriends > 1 ? 's' : ''}` : ''}`;
  const tone = group?.sharing === 'on' ? 'success' : group?.sharing === 'paused' ? 'warning' : undefined;
  useEffect(() => {
    if (!s.session) setGlance('raveloc', null);
    else if (title) setGlance('raveloc', { title, detail, tone, until: group?.expiresAt });
  }, [s.session, title, detail, tone, group?.expiresAt]);
}

export function App() {
  return (
    <ThemeProvider>
      <Backdrop />
      <Shell />
      <Beacon />
      <ToastHost />
    </ThemeProvider>
  );
}

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();
  const s = useObservable(app);
  const invite = useObservable(invitation).value;
  const signedIn = !!session && !s.sessionExpired;
  const { pathname } = location;
  useRavelocGlance();

  useEffect(() => {
    if (!signedIn || !invite) return;
    setInvite(null);
    navigate('/rejoindre', { state: invite });
  }, [signedIn, invite?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!signedIn && pathname !== '/compte') return <AuthScreen expired={s.sessionExpired} invited={!!invite} />;

  return (
    <>
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-md focus:px-3 focus:py-2 liquid">
        Aller au contenu
      </a>
      <ErrorBoundary resetKey={pathname}>
        <KeptTabs pages={{ '/': <Home />, '/groupes': <Groups /> }} />
        {!TAB_PATHS.includes(pathname) && (
          <PushedScreen>
            <Routes location={location}>
              <Route path="/ami/:uid" element={<Navigate />} />
              <Route path="/groupe" element={<Manage />} />
              <Route path="/groupes/nouveau" element={<CreateGroup />} />
              <Route path="/rejoindre" element={<Join />} />
              <Route path="/compte" element={<AccountScreen />} />
              <Route path="*" element={<NotFoundScreen title="Page introuvable" body="Ce lien ne mène nulle part." />} />
            </Routes>
          </PushedScreen>
        )}
      </ErrorBoundary>
      <Navigation tabs={TABS} onSearch={() => setPaletteOpen(true)} onAssistant={() => setBeacon(true)} holdLabel="mode phare" />
      <RavelocPalette />
    </>
  );
}
