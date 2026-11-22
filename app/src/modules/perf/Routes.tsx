import { Navigate, Route, Routes } from 'react-router-dom';
import { SessionPage } from './pages/Session';
import { VerifyPage } from './pages/Verify';

/**
 * Les adresses du nouveau MyPerf, sous `/sport` (phase 4). L'app d'avant reste à `/perf/` jusqu'à la bascule (P8).
 * Étape P1 : la vérification des données ; P2 : la séance. Jour, Programme, Progrès viennent aux étapes suivantes.
 */
export function PerfRoutes() {
  return (
    <Routes>
      <Route index element={<VerifyPage />} />
      <Route path="seance" element={<SessionPage />} />
      <Route path="*" element={<Navigate to="/sport" replace />} />
    </Routes>
  );
}
