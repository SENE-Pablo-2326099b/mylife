import { Icon, IconTile, ModuleCard, ScreenHeader, SectionTitle, Switch } from '@mylife/kit';
import { toggleModule, type ModuleManifest } from '../contract';
import { MODULES } from '../modules';
import { usePrefs, writePrefs } from '../store';

/** Le catalogue : allumer seulement ce qui sert. Un module éteint n'apparaît nulle part ailleurs. */

function Row({ m, on, onToggle }: { m: ModuleManifest; on: boolean; onToggle: (next: boolean) => void }) {
  const inner = (
    <div className="row pad">
      <a href={m.entry.href} className="row grow" aria-label={`Ouvrir ${m.name}`}>
        <IconTile tone={m.tone} icon={m.icon} soft={!on} />
        <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="t-card" style={{ fontSize: 19 }}>{m.name}</span>
          <span className="t-small muted">{m.tagline}</span>
        </span>
      </a>
      <Switch checked={on} onChange={onToggle} label={`${m.name} : ${on ? 'allumé' : 'éteint'}`} />
    </div>
  );
  return on ? <ModuleCard tone={m.tone}>{inner}</ModuleCard> : <div className="glass">{inner}</div>;
}

export function ModulesPage() {
  const prefs = usePrefs();
  const active = MODULES.filter((m) => m.status === 'active');
  const soon = MODULES.filter((m) => m.status === 'soon');
  return (
    <>
      <ScreenHeader title="Modules" />
      <p className="t-body muted" style={{ margin: 0 }}>Active seulement ce qui te sert. Un module éteint n'apparaît nulle part.</p>
      <section className="stack">
        {active.map((m) => (
          <Row key={m.id} m={m} on={!prefs.off.includes(m.id)} onToggle={(next) => writePrefs(toggleModule(prefs, m.id, next))} />
        ))}
      </section>
      {soon.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <SectionTitle>Bientôt</SectionTitle>
          {soon.map((m) => (
            <div key={m.id} className="empty" style={{ flexDirection: 'row', textAlign: 'left', padding: 14, gap: 14 }}>
              <IconTile tone={m.tone} icon={m.icon} soft />
              <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="t-card" style={{ fontSize: 19 }}>{m.name}</span>
                <span className="t-small muted">{m.tagline}</span>
              </span>
            </div>
          ))}
        </section>
      )}
      <p className="t-small muted row" style={{ margin: 0 }}>
        <Icon name="lock" size={16} />
        Éteindre un module ne supprime aucune donnée : tu le retrouves en le rallumant.
      </p>
    </>
  );
}
