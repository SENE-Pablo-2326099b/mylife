import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ensureSeeded } from './db/seed';
import SettingsPage from './pages/Settings';
import Placeholder from './pages/Placeholder';
import TodayPage from './pages/Today';
import CyclePage from './pages/Cycle';
import AlertsPage from './pages/Alerts';
import AlertsSettingsPage from './pages/settings/AlertsSettings';
import { useAlerts } from './domain/useAlerts';
import { maybeAutoSync, useSyncState } from './sync/store';
import SyncPage from './pages/Sync';
import CallbackPage from './pages/Callback';
import TransactionsPage from './pages/Transactions';
import QueuePage from './pages/Queue';
import RulesPage from './pages/settings/Rules';
import CategoriesPage from './pages/settings/Categories';

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureSeeded()
      .then(() => setReady(true))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <p className="p-6 text-bad">Impossible d’ouvrir la base locale : {error}</p>;
  if (!ready) return <p className="p-6 text-muted">Chargement…</p>;

  return <Shell />;
}

function Shell() {
  const alerts = useAlerts();
  const sync = useSyncState();
  useEffect(() => {
    void maybeAutoSync();
  }, []);
  return (
    <Layout alertCount={alerts.filter((a) => a.level !== 'info').length} syncing={sync.syncing}>
      <Routes>
        <Route path="/" element={<TodayPage />} />
        <Route path="/cycle" element={<CyclePage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/a-classer" element={<QueuePage />} />
        <Route path="/alertes" element={<AlertsPage />} />
        <Route path="/synchro" element={<SyncPage />} />
        <Route path="/connexion/retour" element={<CallbackPage />} />
        <Route path="/reglages" element={<SettingsPage />} />
        <Route path="/reglages/regles" element={<RulesPage />} />
        <Route path="/reglages/categories" element={<CategoriesPage />} />
        <Route path="/reglages/alertes" element={<AlertsSettingsPage />} />
        <Route path="*" element={<Placeholder title="Page introuvable" />} />
      </Routes>
    </Layout>
  );
}
