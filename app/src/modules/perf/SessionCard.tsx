import { ModuleCard, ModuleLabel } from '@mylife/kit';
import { useGlance } from '../../legacy/glance';

/** MyPerf, en attendant sa refonte (phase 4) : la carte lit l'aperçu que l'app actuelle dépose sur l'appareil.
 * Elle s'ouvre d'un toucher n'importe où, comme les autres cartes de l'accueil. */
export function SessionCard() {
  const glance = useGlance('perf');
  return (
    <ModuleCard tone="perf" href="/sport" label="Ouvrir MyPerf">
      <div className="pad stack" style={{ gap: 6 }}>
        <ModuleLabel tone="perf">MyPerf</ModuleLabel>
        <span className="t-card">{glance?.title ?? 'Ta séance du jour'}</span>
        {glance?.detail && <span className="t-small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{glance.detail}</span>}
        <div style={{ marginTop: 6 }}>
          {/* Toute la carte est le lien ; ceci n'en est que l'invite. */}
          <span className={`btn ${glance ? 'btn-action' : 'btn-secondary'} btn-block`}>{glance ? 'Démarrer' : 'Ouvrir'}</span>
        </div>
      </div>
    </ModuleCard>
  );
}
