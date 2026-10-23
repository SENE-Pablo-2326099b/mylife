import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
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
import { WrappedPage } from './pages/Wrapped';
import { HomePage } from './pages/Home';
import { InstallPage } from './pages/Install';
import { WelcomePage } from './pages/Welcome';
import { useSession } from './ui/session';

const TABS: TabDef[] = [
  { to: '/', label: 'Accueil', icon: 'home', active: 'home-fill', match: ['/'] },
  { to: '/compte', label: 'Compte', icon: 'person', active: 'person-fill', match: ['/compte'] },
  { to: '/apparence', label: 'Apparence', icon: 'palette', active: 'palette-fill', match: ['/apparence'] },
];
const TAB_PATHS = TABS.map((t) => t.to);

/** L'accueil de MyLife : le point d'entrée de l'app installée, avec le compte et l'apparence de toutes les apps. */
export function App() {
  const location = useLocation();
  const { pathname } = location;
  const welcome = pathname === '/bienvenue';
  const session = useSession();
  // Pas de compte, pas d'accueil : bienvenue puis création de compte (ou connexion), partout ailleurs aussi.
  if (!session && !welcome) return <Navigate to="/bienvenue" replace />;

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
