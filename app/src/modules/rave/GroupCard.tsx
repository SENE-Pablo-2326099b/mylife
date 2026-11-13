import { ModuleCard, ModuleLabel } from '@mylife/kit';
import { useGlance } from '../../legacy/glance';

/** MyRave, en attendant sa refonte (phase 5, avec les Sorties) : la carte lit l'aperçu de l'app actuelle. */
export function GroupCard() {
  const glance = useGlance('raveloc');
  return (
    <ModuleCard tone="rave" href="/raveloc/" label="Ouvrir MyRave">
      <div className="pad stack" style={{ gap: 6 }}>
        <ModuleLabel tone="rave">MyRave</ModuleLabel>
        <span className="t-card">{glance?.title ?? 'Tes sorties'}</span>
        {glance?.detail && <span className="t-small muted">{glance.detail}</span>}
      </div>
    </ModuleCard>
  );
}
