import { ModuleCard, ModuleLabel } from '@mylife/kit';
import { splitAmount, useGlance } from '../../legacy/glance';

/** MyFinances, en attendant sa refonte (phase 3) : la carte lit l'aperçu que l'app actuelle dépose sur l'appareil. */
export function BudgetCard() {
  const glance = useGlance('finances');
  const split = glance ? splitAmount(glance.title) : null;
  return (
    <ModuleCard tone="finances" href="/finances/" label="Ouvrir MyFinances">
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
          <>
            <span className="t-card">Ton budget du jour</span>
            <span className="t-small muted">Ouvre MyFinances une fois sur cet appareil pour le voir ici.</span>
          </>
        )}
      </div>
    </ModuleCard>
  );
}
