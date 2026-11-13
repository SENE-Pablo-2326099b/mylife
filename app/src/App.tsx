import { useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { Button, EmptyState, Icon, IconTile, Sheet, type IconName } from '@mylife/kit';
import { enabledModules } from './contract';
import { MODULES } from './modules';
import { KitPage } from './pages/Kit';
import { ModulesPage } from './pages/Modules';
import { SettingsPage } from './pages/Settings';
import { TodayPage } from './pages/Today';
import { useLogin, usePrefs } from './store';

/**
 * La coquille de MyLife V5 : la navigation (barre du bas sur téléphone, barre latérale sur ordinateur), le bouton
 * « + », et les écrans communs. Elle ne connaît les modules que par leur fiche (`modules/index.ts`).
 * Copilot mène encore à l'écran d'avant la V5 : il sera reconstruit ici.
 */

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: "Aujourd'hui", icon: 'today', end: true },
  { to: '/modules', label: 'Modules', icon: 'modules' },
];
const COPILOT = '/copilot';

function QuickAdd({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefs = usePrefs();
  const modules = enabledModules(MODULES, prefs);
  const adds = modules.flatMap((m) => m.quickAdds.map((q) => ({ ...q, tone: m.tone })));
  return (
    <Sheet open={open} title="Ajouter" onClose={onClose}>
      <div className="stack" style={{ gap: 10 }}>
        {adds.map((q) => (
          <a key={q.id} href={q.href} className="tile row" style={{ padding: '12px 14px', minHeight: 70, borderRadius: 20 }}>
            <IconTile tone={q.tone} icon={q.icon} />
            <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 17, fontWeight: 600 }}>{q.label}</span>
              <span className="t-small muted">{q.detail}</span>
            </span>
          </a>
        ))}
        {adds.length === 0 && <p className="t-body muted" style={{ margin: 0 }}>Allume un module pour pouvoir ajouter quelque chose.</p>}
        <Button variant="action" href={COPILOT} icon="copilot" block>
          Demander à Copilot
        </Button>
      </div>
    </Sheet>
  );
}

function Sidebar({ onAdd }: { onAdd: () => void }) {
  const prefs = usePrefs();
  return (
    <nav className="glass sidebar" aria-label="Navigation principale">
      <span className="t-card" style={{ padding: '0 14px', fontWeight: 800, fontSize: 22 }}>MyLife</span>
      <button type="button" className="btn btn-action btn-block" onClick={onAdd}>
        <Icon name="plus" size={18} strong />
        Ajouter
      </button>
      <div className="stack" style={{ gap: 4 }}>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="navlink">
            <Icon name={n.icon} size={19} />
            {n.label}
          </NavLink>
        ))}
        <a href={COPILOT} className="navlink">
          <Icon name="copilot" size={19} />
          Copilot
        </a>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <span className="t-label muted" style={{ padding: '0 14px 4px' }}>Modules</span>
        {enabledModules(MODULES, prefs).map((m) => (
          <a key={m.id} href={m.entry.href} className={`navlink tone-${m.tone}`}>
            <span className="navdot" />
            {m.name}
          </a>
        ))}
      </div>
      <span className="grow" />
      <NavLink to="/reglages" className="navlink">
        <Icon name="settings" size={19} />
        Réglages et compte
      </NavLink>
    </nav>
  );
}

function TabBar({ onAdd }: { onAdd: () => void }) {
  return (
    <nav className="glass tabbar" aria-label="Navigation principale">
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className="tab">
          <Icon name={n.icon} />
          {n.label}
        </NavLink>
      ))}
      <button type="button" className="tab-plus" aria-label="Ajouter" onClick={onAdd}>
        <Icon name="plus" size={24} strong />
      </button>
      <a href={COPILOT} className="tab">
        <Icon name="copilot" />
        Copilot
      </a>
      <NavLink to="/reglages" className="tab">
        <Icon name="settings" />
        Réglages
      </NavLink>
    </nav>
  );
}

export function App() {
  const login = useLogin();
  const [adding, setAdding] = useState(false);
  if (!login)
    return (
      <>
        <div className="ml-bg" aria-hidden="true" />
        <main className="shell-main">
          <div className="shell-content" style={{ maxWidth: 440, paddingTop: 80 }}>
            <EmptyState
              title="Connecte-toi à MyLife"
              body="La nouvelle version utilise le même compte. Connecte-toi (ou crée ton compte), puis reviens ici."
              action={
                <Button variant="action" href="/">
                  Me connecter
                </Button>
              }
            />
          </div>
        </main>
      </>
    );
  return (
    <>
      <div className="ml-bg" aria-hidden="true" />
      <div className="shell">
        <Sidebar onAdd={() => setAdding(true)} />
        <main className="shell-main" id="contenu">
          <div className="shell-content">
            <Routes>
              <Route path="/" element={<TodayPage />} />
              <Route path="/modules" element={<ModulesPage />} />
              <Route path="/reglages" element={<SettingsPage />} />
              <Route path="/kit" element={<KitPage />} />
              <Route path="*" element={<EmptyState title="Page introuvable" body="Ce lien ne mène nulle part." action={<Button href="/v5/">Revenir à Aujourd'hui</Button>} />} />
            </Routes>
          </div>
        </main>
        <TabBar onAdd={() => setAdding(true)} />
      </div>
      <QuickAdd open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
