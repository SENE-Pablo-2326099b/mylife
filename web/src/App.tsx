import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Backdrop } from './ui/Backdrop';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Navigation, type TabDef } from './ui/Navigation';
import { KeptTabs, PushedScreen } from './ui/PageTransition';
import { setPaletteOpen } from './ui/paletteStore';
import { NotFoundScreen } from './ui/Screen';
import { ThemeProvider } from './ui/ThemeProvider';
import { ToastHost } from './ui/toast';
import { HomePalette } from './HomePalette';
import { AccountPage } from './pages/Account';
import { AppearancePage } from './pages/Appearance';
import { CharacterPage } from './pages/Character';
import { RecapPage } from './pages/Recap';
import { CrewJoinPage, CrewListPage, CrewPage } from './pages/Crew';
import { SortiePage, SortiesPage } from './pages/Sortie';
import { MusicPage } from './pages/Music';
import { GamesPage, TimePage } from './pages/Games';
import { stashInvite, takeStashedInvite, useCrewPublisher } from './crew';
import { useCharacter, useStatsInput } from './ui/stats';
import { lazy, Suspense, useEffect } from 'react';
import { WrappedPage } from './pages/Wrapped';
import { HomePage } from './pages/Home';
import { InstallPage } from './pages/Install';
import { WelcomePage } from './pages/Welcome';
import { usePendingRecovery, useSession } from './ui/session';

const TABS: TabDef[] = [
  { to: '/', label: 'Accueil', icon: 'home', active: 'home-fill', match: ['/'] },
  { to: '/compte', label: 'Compte', icon: 'person', active: 'person-fill', match: ['/compte'] },
  { to: '/apparence', label: 'Apparence', icon: 'palette', active: 'palette-fill', match: ['/apparence'] },
];
const TAB_PATHS = TABS.map((t) => t.to);

// Copilot embarque le SDK de l'API Claude : chargé seulement quand on l'ouvre (l'accueil reste léger).
const CopilotPage = lazy(() => import('./pages/Copilot').then((m) => ({ default: m.CopilotPage })));

/** L'accueil de MyLife : le point d'entrée de l'app installée, avec le compte et l'apparence de toutes les apps. */
export function App() {
  const location = useLocation();
  const { pathname } = location;
  const welcome = pathname === '/bienvenue';
  const session = useSession();
  // Pas de compte, pas d'accueil : bienvenue puis création de compte (ou connexion), partout ailleurs aussi.
  // Une invitation de Crew ouverte sans compte est gardée le temps de le créer.
  if (!session && !welcome) {
    stashInvite(location.hash);
    return <Navigate to="/bienvenue" replace />;
  }
  return <Home session={!!session} welcome={welcome} />;
}

/** L'app une fois connecté (ou sur la bienvenue). */
function Home({ session, welcome }: { session: boolean; welcome: boolean }) {
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  const character = useCharacter();
  const { stats, rest } = useStatsInput();
  // Mon score dans mes Crews, tenu à jour (seulement quand il change).
  useCrewPublisher(character, stats, rest);
  // Invitation reçue avant la connexion : on y va une fois l'accueil terminé, clé de secours mise de côté.
  const keyPending = usePendingRecovery() !== null;
  useEffect(() => {
    if (!session || welcome || keyPending) return;
    const hash = takeStashedInvite();
    if (hash) navigate(`/rejoindre${hash}`, { replace: true });
  }, [session, welcome, keyPending, navigate]);

  return (
    <ThemeProvider>
      <Backdrop />
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-md focus:px-3 focus:py-2 liquid">
        Aller au contenu
      </a>
      <ErrorBoundary resetKey={pathname}>
        <KeptTabs pages={{ '/': <HomePage />, '/compte': <AccountPage />, '/apparence': <AppearancePage /> }} />
        {!TAB_PATHS.includes(pathname) && (
          <PushedScreen>
            <Routes location={location}>
              <Route path="/bienvenue" element={<WelcomePage />} />
              <Route path="/installer" element={<InstallPage />} />
              <Route path="/personnage" element={<CharacterPage />} />
              <Route path="/bilan" element={<RecapPage />} />
              <Route path="/wrapped" element={<WrappedPage />} />
              <Route path="/crew" element={<CrewListPage />} />
              <Route path="/rejoindre" element={<CrewJoinPage />} />
              <Route path="/crew/rejoindre" element={<CrewJoinPage />} />
              <Route path="/crew/:id" element={<CrewPage />} />
              <Route path="/sorties" element={<SortiesPage />} />
              <Route path="/sorties/:id" element={<SortiePage />} />
              <Route path="/musique" element={<MusicPage />} />
              <Route path="/jeux" element={<GamesPage />} />
              <Route path="/temps" element={<TimePage />} />
              <Route
                path="/copilot"
                element={
                  <Suspense fallback={<p className="t-small px-4 pt-20 text-muted">Chargement de Copilot…</p>}>
                    <CopilotPage />
                  </Suspense>
                }
              />
              <Route path="*" element={<NotFoundScreen title="Page introuvable" body="Ce lien ne mène nulle part." />} />
            </Routes>
          </PushedScreen>
        )}
      </ErrorBoundary>
      {!welcome && <Navigation tabs={TABS} onSearch={() => setPaletteOpen(true)} />}
      {!welcome && <HomePalette />}
      <ToastHost />
    </ThemeProvider>
  );
}
