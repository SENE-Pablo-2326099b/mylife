import { lazy, Suspense, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { db } from './db/db';
import { ensureSeeded } from './db/seed';
import { wealthHousekeeping } from './domain/wealthDb';
import TodayPage from './pages/Today';
import { absorbSetupLink } from './sync/setupLink';
import { cloudBoot } from './sync/cloud';
import { maybeAutoSync } from './sync/store';
import { Backdrop } from './ui/Backdrop';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { SkeletonCard } from './ui/extras';
import { Navigation, type TabDef } from './ui/Navigation';
import { PageTransition } from './ui/PageTransition';
import { setPaletteOpen } from './ui/paletteStore';
import { CommandPalette } from './components/CommandPalette';
import { NotFoundScreen } from './ui/Screen';
import { ThemeProvider } from './ui/ThemeProvider';
import { ToastHost } from './ui/toast';
import { toast } from './ui/toastStore';


// Pages chargées à la demande : l'ouverture de l'app ne télécharge que l'écran Aujourd'hui.
const AlertsPage = lazy(() => import('./pages/Alerts'));
const AssistantPage = lazy(() => import('./pages/Assistant'));
const CallbackPage = lazy(() => import('./pages/Callback'));
const CyclePage = lazy(() => import('./pages/Cycle'));
const ForecastPage = lazy(() => import('./pages/insights/Forecast'));
const FirePage = lazy(() => import('./pages/insights/Fire'));
const RecurringPage = lazy(() => import('./pages/insights/Recurring'));
const OnboardingPage = lazy(() => import('./pages/Onboarding'));
const QueuePage = lazy(() => import('./pages/Queue'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const AlertsSettingsPage = lazy(() => import('./pages/settings/AlertsSettings'));
const AppearancePage = lazy(() => import('./pages/settings/Appearance'));
const BudgetSettingsPage = lazy(() => import('./pages/settings/BudgetSettings'));
const CategoriesPage = lazy(() => import('./pages/settings/Categories'));
const DataPage = lazy(() => import('./pages/settings/Data'));
const ProfilePage = lazy(() => import('./pages/settings/Profile'));
const AccountPage = lazy(() => import('./pages/settings/Account'));
const RulesPage = lazy(() => import('./pages/settings/Rules'));
const SyncPage = lazy(() => import('./pages/Sync'));
const TransactionsPage = lazy(() => import('./pages/Transactions'));
const PortfolioDetailPage = lazy(() => import('./pages/wealth/PortfolioDetail'));
const TrImportPage = lazy(() => import('./pages/wealth/TrImport'));
const WealthPage = lazy(() => import('./pages/wealth/Wealth'));

/** Une fois l'app affichée, les onglets principaux se préchargent en tâche de fond (tap instantané). */
function prefetchTabs() {
  const run = () => void Promise.all([import('./pages/Cycle'), import('./pages/Transactions'), import('./pages/wealth/Wealth'), import('./pages/Settings')]).catch(() => undefined);
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2000);
}

const pageFallback = (
  <div className="mx-auto max-w-content space-y-3 px-4 pt-16" aria-busy="true">
    <SkeletonCard tall />
    <SkeletonCard />
  </div>
);

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureSeeded()
      .then(absorbSetupLink)
      .then((linked) => {
        setReady(true);
        if (linked) toast({ message: 'Relais configuré sur cet appareil' });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <ThemeProvider>
      <Backdrop />
      {error ? (
        <p className="t-body p-6 text-danger">Impossible d’ouvrir la base locale : {error}</p>
      ) : ready ? (
        <Shell />
      ) : (
        <div className="mx-auto max-w-content space-y-3 px-4 pt-16" aria-busy="true">
          <SkeletonCard tall />
          <SkeletonCard />
        </div>
      )}
    </ThemeProvider>
  );
}

function Shell() {
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  const onboarded = useLiveQuery(async () => (await db.settings.get('main'))?.onboarded ?? false, []);
  const toClassify = useLiveQuery(() => db.transactions.filter((t) => t.categoryId === null).count(), []) ?? 0;

  useEffect(() => {
    prefetchTabs();
    // D'abord ce que les autres appareils ont fait (dont leurs synchros bancaires), puis la banque.
    void cloudBoot()
      .catch(() => undefined)
      .then(() => maybeAutoSync())
      .finally(() => void wealthHousekeeping().catch(() => undefined));
    // Sur téléphone, l'app reste souvent ouverte en arrière-plan : on revérifie les banques à chaque
    // retour (toujours dans la limite de « synchro auto toutes les N heures »).
    const onShow = () => document.visibilityState === 'visible' && void maybeAutoSync().catch(() => undefined);
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, []);

  const tabs: TabDef[] = [
    { to: '/', label: 'Aujourd’hui', icon: 'flash', active: 'flash-fill', match: ['/'] },
    { to: '/budget', label: 'Budget', icon: 'pie', active: 'pie-fill', match: ['/budget', '/previsions', '/recurrents'] },
    { to: '/operations', label: 'Opérations', icon: 'list', active: 'list-fill', match: ['/operations', '/a-classer'], badge: toClassify },
    { to: '/patrimoine', label: 'Patrimoine', icon: 'diamond', active: 'diamond-fill', match: ['/patrimoine', '/independance'] },
    { to: '/reglages', label: 'Réglages', icon: 'options', active: 'options-fill', match: ['/reglages', '/synchro', '/alertes'] },
  ];

  if (onboarded === undefined) return null;
  const welcome = pathname === '/bienvenue';
  // Premier lancement : l'accueil d'abord (sauf retour de banque, qui doit aboutir, et compte MyLife,
  // proposé dès l'accueil : se connecter récupère tout, réglages compris).
  if (!onboarded && !welcome && pathname !== '/connexion/retour' && pathname !== '/reglages/compte') return <Navigate to="/bienvenue" replace />;

  return (
    <>
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-md focus:px-3 focus:py-2 liquid">
        Aller au contenu
      </a>
      <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={pageFallback}>
      <PageTransition>
      <Routes location={location}>
        <Route path="/bienvenue" element={<OnboardingPage />} />
        <Route path="/" element={<TodayPage />} />
        <Route path="/budget" element={<CyclePage />} />
        <Route path="/cycle" element={<Navigate to="/budget" replace />} />
        <Route path="/previsions" element={<ForecastPage />} />
        <Route path="/recurrents" element={<RecurringPage />} />
        <Route path="/operations" element={<TransactionsPage />} />
        <Route path="/transactions" element={<Navigate to="/operations" replace />} />
        <Route path="/a-classer" element={<QueuePage />} />
        <Route path="/alertes" element={<AlertsPage />} />
        <Route path="/assistant" element={<AssistantPage />} />
        <Route path="/patrimoine" element={<WealthPage />} />
        <Route path="/patrimoine/placement/:id" element={<PortfolioDetailPage />} />
        <Route path="/patrimoine/import" element={<TrImportPage />} />
        <Route path="/independance" element={<FirePage />} />
        <Route path="/synchro" element={<SyncPage />} />
        <Route path="/connexion/retour" element={<CallbackPage />} />
        <Route path="/reglages" element={<SettingsPage />} />
        <Route path="/reglages/profil" element={<ProfilePage />} />
        <Route path="/reglages/compte" element={<AccountPage />} />
        <Route path="/reglages/budget" element={<BudgetSettingsPage />} />
        <Route path="/reglages/apparence" element={<AppearancePage />} />
        <Route path="/reglages/regles" element={<RulesPage />} />
        <Route path="/reglages/categories" element={<CategoriesPage />} />
        <Route path="/reglages/alertes" element={<AlertsSettingsPage />} />
        <Route path="/reglages/donnees" element={<DataPage />} />
        <Route path="*" element={<NotFoundScreen title="Page introuvable" body="Ce lien ne mène nulle part." />} />
      </Routes>
      </PageTransition>
      </Suspense>
      </ErrorBoundary>
      {!welcome && <Navigation tabs={tabs} onSearch={() => setPaletteOpen(true)} onAssistant={() => navigate('/assistant')} />}
      {!welcome && <CommandPalette />}
      <ToastHost />
    </>
  );
}
