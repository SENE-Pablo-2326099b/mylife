import { Navigate, Route, Routes } from 'react-router-dom';
import { ClasserPage } from './pages/Classer';
import { JourPage } from './pages/Jour';
import { OperationsPage } from './pages/Operations';
import { PatrimoinePage } from './pages/Patrimoine';
import { PlanPage } from './pages/Plan';
import { ReglagesPage } from './pages/Reglages';
import { ReprisePage } from './pages/Reprise';

/**
 * Les adresses de MyFinances V5, sous `/argent` (provisoire : l'ancienne app garde `/finances/` jusqu'à la bascule).
 * Quatre onglets, un par question : Jour, Opérations, Plan, Patrimoine ; plus « à classer », les réglages, et
 * « pourquoi ce chiffre » (le moteur, terme par terme).
 */
export function FinancesRoutes() {
  return (
    <Routes>
      <Route index element={<JourPage />} />
      <Route path="operations" element={<OperationsPage />} />
      <Route path="classer" element={<ClasserPage />} />
      <Route path="plan" element={<PlanPage />} />
      <Route path="patrimoine" element={<PatrimoinePage />} />
      <Route path="reglages" element={<ReglagesPage />} />
      <Route path="moteur" element={<ReprisePage />} />
      <Route path="*" element={<Navigate to="/argent" replace />} />
    </Routes>
  );
}
