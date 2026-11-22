import { Navigate, Route, Routes } from 'react-router-dom';
import { JourPage } from './pages/Jour';
import { ProgrammePage, SlotPage, TemplatePage, TemplatesPage } from './pages/Programme';
import { SessionPage } from './pages/Session';
import { VerifyPage } from './pages/Verify';

/**
 * Les adresses du nouveau MyPerf, sous `/sport` (phase 4). L'app d'avant reste à `/perf/` jusqu'à la bascule (P8).
 * Page par page : Jour (le « + » et la navigation), la séance, Programme (séances types, créneaux), tes données ;
 * Exercices, Progrès ensuite.
 */
export function PerfRoutes() {
  return (
    <Routes>
      <Route index element={<JourPage />} />
      <Route path="donnees" element={<VerifyPage />} />
      <Route path="seance" element={<SessionPage />} />
      <Route path="programme" element={<ProgrammePage />} />
      <Route path="programme/seances" element={<TemplatesPage />} />
      <Route path="programme/seance/:id" element={<TemplatePage />} />
      <Route path="programme/creneau/:id" element={<SlotPage />} />
      <Route path="*" element={<Navigate to="/sport" replace />} />
    </Routes>
  );
}
