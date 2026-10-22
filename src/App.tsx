import { lazy, Suspense, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { db } from './db/db';
import { adoptSharedAppearance, ensureSeeded } from './db/seed';
import { wealthHousekeeping } from './domain/wealthDb';
import TodayPage from './pages/Today';
import { absorbSetupLink } from './sync/setupLink';
import { cloudBoot } from './sync/cloud';
import { maybeAutoSync } from './sync/store';
import { Backdrop } from './ui/Backdrop';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { SkeletonCard } from './ui/extras';
import { Navigation, type TabDef } from './ui/Navigation';
import { KeptTabs, PushedScreen } from './ui/PageTransition';
import { isTabPath } from './ui/tabActive';
import { setPaletteOpen } from './ui/paletteStore';
import { CommandPalette } from './components/CommandPalette';
import { NotFoundScreen } from './ui/Screen';
import { ThemeProvider } from './ui/ThemeProvider';
import { ToastHost } from './ui/toast';
import { toast } from './ui/toastStore';
import { useToClassifyCount } from './domain/unclassified';


// Pages chargées à la demande : l'ouverture de l'app ne télécharge que l'écran Aujourd'hui.
const load = {
  AlertsPage: () => import('./pages/Alerts'),
  AssistantPage: () => import('./pages/Assistant'),
  CallbackPage: () => import('./pages/Callback'),
  CyclePage: () => import('./pages/Cycle'),
  ForecastPage: () => import('./pages/insights/Forecast'),
  FirePage: () => import('./pages/insights/Fire'),
  RecurringPage: () => import('./pages/insights/Recurring'),
  OnboardingPage: () => import('./pages/Onboarding'),
  QueuePage: () => import('./pages/Queue'),
  SettingsPage: () => import('./pages/Settings'),
  AlertsSettingsPage: () => import('./pages/settings/AlertsSettings'),
  AppearancePage: () => import('./pages/settings/Appearance'),
  BudgetSettingsPage: () => import('./pages/settings/BudgetSettings'),
  CategoriesPage: () => import('./pages/settings/Categories'),
  DataPage: () => import('./pages/settings/Data'),
  ProfilePage: () => import('./pages/settings/Profile'),
  AccountPage: () => import('./pages/settings/Account'),
  RulesPage: () => import('./pages/settings/Rules'),
  SyncPage: () => import('./pages/Sync'),
  TransactionsPage: () => import('./pages/Transactions'),
  PortfolioDetailPage: () => import('./pages/wealth/PortfolioDetail'),
  TrImportPage: () => import('./pages/wealth/TrImport'),
  WealthPage: () => import('./pages/wealth/Wealth'),
};
const AlertsPage = lazy(load.AlertsPage);
const AssistantPage = lazy(load.AssistantPage);
const CallbackPage = lazy(load.CallbackPage);
const CyclePage = lazy(load.CyclePage);
const ForecastPage = lazy(load.ForecastPage);
const FirePage = lazy(load.FirePage);
const RecurringPage = lazy(load.RecurringPage);
const OnboardingPage = lazy(load.OnboardingPage);
const QueuePage = lazy(load.QueuePage);
const SettingsPage = lazy(load.SettingsPage);
const AlertsSettingsPage = lazy(load.AlertsSettingsPage);
const AppearancePage = lazy(load.AppearancePage);
const BudgetSettingsPage = lazy(load.BudgetSettingsPage);
const CategoriesPage = lazy(load.CategoriesPage);
const DataPage = lazy(load.DataPage);
const ProfilePage = lazy(load.ProfilePage);
const AccountPage = lazy(load.AccountPage);
const RulesPage = lazy(load.RulesPage);
const SyncPage = lazy(load.SyncPage);
const TransactionsPage = lazy(load.TransactionsPage);
const PortfolioDetailPage = lazy(load.PortfolioDetailPage);
const TrImportPage = lazy(load.TrImportPage);
const WealthPage = lazy(load.WealthPage);

/**
 * Une fois l'app affichée, tous les écrans se préchargent en tâche de fond, les onglets d'abord, par
 * petits lots aux moments creux : aucun écran n'attend son code (ni squelette qui clignote) au toucher.
 */
function prefetchPages() {
  const order = [load.CyclePage, load.TransactionsPage, load.WealthPage, load.SettingsPage, ...Object.values(load)];
  const idle = (fn: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 600));
  const next = () => {
    const batch = order.splice(0, 3);
    if (!batch.length) return;
    void Promise.all(batch.map((f) => f().catch(() => undefined))).then(() => idle(next));
  };
  idle(next);
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
      .then(() => adoptSharedAppearance().catch(() => undefined))
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
  const toClassify = useToClassifyCount();

  useEffect(() => {
    prefetchPages();
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
      <KeptTabs pages={{ '/': <TodayPage />, '/budget': <CyclePage />, '/operations': <TransactionsPage />, '/patrimoine': <WealthPage />, '/reglages': <SettingsPage /> }} />
      {!isTabPath(pathname) && (
      <PushedScreen>
      <Routes location={location}>
        <Route path="/bienvenue" element={<OnboardingPage />} />
        <Route path="/cycle" element={<Navigate to="/budget" replace />} />
        <Route path="/previsions" element={<ForecastPage />} />
        <Route path="/recurrents" element={<RecurringPage />} />
        <Route path="/transactions" element={<Navigate to="/operations" replace />} />
        <Route path="/a-classer" element={<QueuePage />} />
        <Route path="/alertes" element={<AlertsPage />} />
        <Route path="/assistant" element={<AssistantPage />} />
        <Route path="/patrimoine/placement/:id" element={<PortfolioDetailPage />} />
        <Route path="/patrimoine/import" element={<TrImportPage />} />
        <Route path="/independance" element={<FirePage />} />
        <Route path="/synchro" element={<SyncPage />} />
        <Route path="/connexion/retour" element={<CallbackPage />} />
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
      </PushedScreen>
      )}
      </Suspense>
      </ErrorBoundary>
      {!welcome && <Navigation tabs={tabs} onSearch={() => setPaletteOpen(true)} onAssistant={() => navigate('/assistant')} />}
      {!welcome && <CommandPalette />}
      <ToastHost />
    </>
  );
}
