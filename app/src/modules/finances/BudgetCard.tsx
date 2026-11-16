import { useEffect } from 'react';
import { ModuleCard, ModuleLabel } from '@mylife/kit';
import { localToday, readGlance } from '@mylife/lumen';
import { splitAmount, useGlance } from '../../legacy/glance';

/** Un aperçu plus vieux que ça est recalculé en arrière-plan. */
const FRESH_MS = 10 * 60_000;

/**
 * La carte de l'accueil : le budget du jour, tel que le moteur l'a déposé sur l'appareil. Le moteur n'est chargé
 * qu'au besoin (aperçu absent ou ancien), hors du premier affichage de l'accueil.
 */
export function BudgetCard() {
  const glance = useGlance('finances');
  const split = glance ? splitAmount(glance.title) : null;
  useEffect(() => {
    const g = readGlance('finances');
    if (g && Date.now() - g.at < FRESH_MS) return;
    void import('./data/refresh').then((m) => m.refreshGlance(localToday())).catch(() => undefined);
  }, []);
  return (
    <ModuleCard tone="finances" href="/argent" label="Ouvrir MyFinances">
      <div className="pad stack" style={{ gap: 8 }}>
        <ModuleLabel tone="finances">MyFinances</ModuleLabel>
        {glance ? (
          <>
            {split ? (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span className="t-hero">{split.amount}</span>
                <span className="t-body muted">{split.rest}</span>
              </div>
            ) : (
              <span className="t-card">{glance.title}</span>
            )}
            {glance.detail && <span className="t-small muted">{glance.detail}</span>}
          </>
        ) : (
          <span className="t-card">Ton budget du jour</span>
        )}
      </div>
    </ModuleCard>
  );
}
