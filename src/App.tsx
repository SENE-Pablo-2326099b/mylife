import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ensureSeeded } from './db/seed';
import SettingsPage from './pages/Settings';
import Placeholder from './pages/Placeholder';

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

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Placeholder title="Aujourd’hui" />} />
        <Route path="/cycle" element={<Placeholder title="Cycle en cours" />} />
        <Route path="/transactions" element={<Placeholder title="Opérations" />} />
        <Route path="/alertes" element={<Placeholder title="Alertes" />} />
        <Route path="/synchro" element={<Placeholder title="Synchronisation" />} />
        <Route path="/reglages/*" element={<SettingsPage />} />
        <Route path="*" element={<Placeholder title="Page introuvable" />} />
      </Routes>
    </Layout>
  );
}
