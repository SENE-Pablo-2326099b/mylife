import { Button, ModuleCard, ModuleLabel } from '@mylife/kit';
import { useGlance } from '../../legacy/glance';

/** MyPerf, en attendant sa refonte (phase 4) : la carte lit l'aperçu que l'app actuelle dépose sur l'appareil. */
export function SessionCard() {
  const glance = useGlance('perf');
  return (
    <ModuleCard tone="perf" label="MyPerf">
      <div className="pad stack" style={{ gap: 6 }}>
        <ModuleLabel tone="perf">MyPerf</ModuleLabel>
        <span className="t-card">{glance?.title ?? 'Ta séance du jour'}</span>
        <span className="t-small muted">{glance ? glance.detail : 'Ouvre MyPerf une fois sur cet appareil pour la voir ici.'}</span>
        <div style={{ marginTop: 6 }}>
          <Button variant={glance ? 'action' : 'secondary'} href="/perf/" block>
            {glance ? 'Démarrer' : 'Ouvrir MyPerf'}
          </Button>
        </div>
      </div>
    </ModuleCard>
  );
}
