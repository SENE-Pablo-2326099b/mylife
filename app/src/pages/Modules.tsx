import { Icon, IconTile, ModuleCard, ScreenHeader, Switch } from '@mylife/kit';
import { toggleModule, type ModuleManifest } from '../contract';
import { MODULES } from '../modules';
import { usePrefs, writePrefs } from '../store';

/**
 * Le catalogue : une grande tuile par module, à sa couleur quand il est allumé, éteinte sinon. L’interrupteur allume ou
 * éteint ; la flèche ouvre le module. Un module « bientôt » est là, en retrait, sans interrupteur.
 */
function Tile({ m, on, onToggle }: { m: ModuleManifest; on: boolean; onToggle?: (next: boolean) => void }) {
  const body = (
    <div className="pad stack" style={{ gap: 14, minHeight: 150 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <IconTile tone={m.tone} icon={m.icon} soft={!on} />
        <span className="row" style={{ gap: 8 }}>
          {on && (
            <a href={m.entry.href} aria-label={`Ouvrir ${m.name}`} className="tile row" style={{ width: 36, height: 36, borderRadius: 999, justifyContent: 'center' }}>
              <Icon name="chevron" size={18} />
            </a>
          )}
          {onToggle ? <Switch checked={on} onChange={onToggle} label={`${m.name} : ${on ? 'allumé' : 'éteint'}`} /> : <span className="badge">Bientôt</span>}
        </span>
      </div>
      <span className="grow" />
      <span className="stack-0" style={{ gap: 2 }}>
        <span className="t-card" style={{ fontSize: 21 }}>{m.name}</span>
        <span className="t-small muted">{m.tagline}</span>
      </span>
    </div>
  );
  if (!on)
    return (
      <div className="glass" style={{ opacity: m.status === 'soon' ? 0.75 : 1 }}>
        {body}
      </div>
    );
  return <ModuleCard tone={m.tone}>{body}</ModuleCard>;
}

export function ModulesPage() {
  const prefs = usePrefs();
  return (
    <>
      <ScreenHeader kicker="Allume seulement ce qui te sert" title="Modules" />
      <div className="grid-2 grid-modules">
        {MODULES.map((m) =>
          m.status === 'active' ? <Tile key={m.id} m={m} on={!prefs.off.includes(m.id)} onToggle={(next) => writePrefs(toggleModule(prefs, m.id, next))} /> : <Tile key={m.id} m={m} on={false} />,
        )}
      </div>
    </>
  );
}
