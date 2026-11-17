import { Navigate, Route, Routes } from 'react-router-dom';
import { BanquesPage } from './pages/Banques';
import { CategoriesPage } from './pages/Categories';
import { ComptePage } from './pages/Compte';
import { ImportTrPage } from './pages/ImportTr';
import { ClasserPage } from './pages/Classer';
import { JourPage } from './pages/Jour';
import { OperationsPage } from './pages/Operations';
import { PatrimoinePage } from './pages/Patrimoine';
import { PlanPage } from './pages/Plan';
import { ReglagesPage } from './pages/Reglages';
import { ReprisePage } from './pages/Reprise';

/**
 * Les adresses de MyFinances, sous `/argent` (l'ancienne app garde `/finances/` le temps de la bascule : étape M6).
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
      <Route path="patrimoine/compte/:id" element={<ComptePage />} />
      <Route path="patrimoine/import" element={<ImportTrPage />} />
      <Route path="reglages" element={<ReglagesPage />} />
      <Route path="reglages/:section" element={<ReglagesPage />} />
      <Route path="categories" element={<CategoriesPage />} />
      <Route path="banques" element={<BanquesPage />} />
      <Route path="moteur" element={<ReprisePage />} />
      <Route path="*" element={<Navigate to="/argent" replace />} />
    </Routes>
  );
}
