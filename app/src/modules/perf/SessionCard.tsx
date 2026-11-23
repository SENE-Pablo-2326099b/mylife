import { useEffect, useState } from 'react';
import { ModuleCard, ModuleLabel } from '@mylife/kit';
import { useGlance } from '../../legacy/glance';
import type { HomeCard } from './data/bridge';

/**
 * MyPerf sur l'accueil (maquette V3-Accueil) : la séance du jour, sa durée, sa semaine du bloc, « Démarrer ». Le module
 * se charge en arrière-plan (sa base, la fiche Copilot, les actions validées) ; en attendant, l'aperçu déposé la
 * dernière fois. Toute la carte s'ouvre d'un toucher.
 */
export function SessionCard() {
  const glance = useGlance('perf');
  const [card, setCard] = useState<HomeCard | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void import('./bridge').then((b) => {
      b.startPerfInbox();
      return b.publishPerf().then((c) => alive && setCard(c), () => alive && setCard(undefined));
    });
    return () => {
      alive = false;
    };
  }, []);
  const title = card?.title ?? glance?.title ?? 'Ta séance du jour';
  return (
    <ModuleCard tone="perf" href="/sport" label="Ouvrir MyPerf">
      <div className="pad stack" style={{ gap: 6 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="grow">
            <ModuleLabel tone="perf">{card?.kicker ?? 'MyPerf'}</ModuleLabel>
          </span>
          {card?.chip && <span className="badge">{card.chip}</span>}
        </div>
        <span className="t-card">{title}</span>
        {(card?.detail ?? glance?.detail) && <span className="t-small muted">{card ? card.detail : glance?.detail}</span>}
        <div style={{ marginTop: 6 }}>
          {/* Toute la carte est le lien ; ceci n'en est que l'invite. */}
          <span className={`btn ${card || glance ? 'btn-action' : 'btn-secondary'} btn-block`}>{card?.start ?? (glance ? 'Démarrer' : 'Ouvrir')}</span>
        </div>
      </div>
    </ModuleCard>
  );
}
