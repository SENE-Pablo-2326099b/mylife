import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { db } from './db/db';
import { ensureSeeded } from './db/seed';
import { wealthHousekeeping } from './domain/wealthDb';
import AlertsPage from './pages/Alerts';
import CallbackPage from './pages/Callback';
import CyclePage from './pages/Cycle';
import ForecastPage from './pages/insights/Forecast';
import FirePage from './pages/insights/Fire';
import RecurringPage from './pages/insights/Recurring';
import OnboardingPage from './pages/Onboarding';
import QueuePage from './pages/Queue';
import SettingsPage from './pages/Settings';
import AlertsSettingsPage from './pages/settings/AlertsSettings';
import AppearancePage from './pages/settings/Appearance';
import BudgetSettingsPage from './pages/settings/BudgetSettings';
import CategoriesPage from './pages/settings/Categories';
import DataPage from './pages/settings/Data';
import ProfilePage from './pages/settings/Profile';
import AccountPage from './pages/settings/Account';
import RulesPage from './pages/settings/Rules';
import SyncPage from './pages/Sync';
import TodayPage from './pages/Today';
import TransactionsPage from './pages/Transactions';
import PortfolioDetailPage from './pages/wealth/PortfolioDetail';
import TrImportPage from './pages/wealth/TrImport';
import WealthPage from './pages/wealth/Wealth';
import { absorbSetupLink } from './sync/setupLink';
import { cloudBoot } from './sync/cloud';
import { maybeAutoSync } from './sync/store';
import { Backdrop } from './ui/Backdrop';
import { SkeletonCard } from './ui/extras';
import { Navigation, type TabDef } from './ui/Navigation';
import { NotFoundScreen } from './ui/Screen';
import { ThemeProvider } from './ui/ThemeProvider';
import { ToastHost } from './ui/toast';
import { toast } from './ui/toastStore';

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

/** Remonte en haut à chaque changement d'écran (les écrans défilent avec la fenêtre). */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Shell() {
  const { pathname } = useLocation();
  const onboarded = useLiveQuery(async () => (await db.settings.get('main'))?.onboarded ?? false, []);
  const toClassify = useLiveQuery(() => db.transactions.filter((t) => t.categoryId === null).count(), []) ?? 0;

  useEffect(() => {
    // D'abord ce que les autres appareils ont fait (dont leurs synchros bancaires), puis la banque.
    void cloudBoot()
      .catch(() => undefined)
      .then(() => maybeAutoSync())
      .finally(() => void wealthHousekeeping().catch(() => undefined));
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
  // Premier lancement : l'accueil d'abord (sauf retour de banque, qui doit aboutir).
  if (!onboarded && !welcome && pathname !== '/connexion/retour') return <Navigate to="/bienvenue" replace />;

  return (
    <>
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-md focus:px-3 focus:py-2 liquid">
        Aller au contenu
      </a>
      <ScrollToTop />
      <Routes>
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
      {!welcome && <Navigation tabs={tabs} />}
      <ToastHost />
    </>
  );
}
