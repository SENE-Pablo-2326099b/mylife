import { lazy, Suspense, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Button, EmptyState, Icon, IconTile, Sheet, type IconName } from '@mylife/kit';
import { enabledModules } from './contract';
import { MODULES } from './modules';
import { AccountPage, RecoveryReminder, WelcomeKey, WelcomePage } from './pages/Account';
import { pendingRecovery } from '@mylife/core/web';
import { DataPage } from './pages/Data';
import { InstallPage } from './pages/Install';
import { KitPage } from './pages/Kit';
import { PrivacyPage } from './pages/Privacy';
import { ModulesPage } from './pages/Modules';
import { SettingsPage } from './pages/Settings';
import { TodayPage } from './pages/Today';
import { useLogin, usePrefs } from './store';

/**
 * La coquille de MyLife V5 : la navigation (barre du bas sur téléphone, barre latérale sur ordinateur), le bouton
 * « + », et les écrans communs. Elle ne connaît les modules que par leur fiche (`modules/index.ts`).
 */

// Copilot embarque le SDK de l'API Claude : chargé seulement quand on l'ouvre.
const CopilotPage = lazy(() => import('./pages/Copilot').then((m) => ({ default: m.CopilotPage })));

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: "Aujourd’hui", icon: 'today', end: true },
  { to: '/modules', label: 'Modules', icon: 'modules' },
];
const COPILOT = '/copilot';
/** Lisibles sans compte. */
const PUBLIC = ['/bienvenue', '/confidentialite'];

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
        <NavLink to={COPILOT} className="btn btn-action btn-block" onClick={onClose}>
          <Icon name="copilot" size={18} />
          Demander à Copilot
        </NavLink>
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
        <NavLink to={COPILOT} className="navlink">
          <Icon name="copilot" size={19} />
          Copilot
        </NavLink>
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
      <NavLink to={COPILOT} className="tab">
        <Icon name="copilot" />
        Copilot
      </NavLink>
      <NavLink to="/reglages" className="tab">
        <Icon name="settings" />
        Réglages
      </NavLink>
    </nav>
  );
}

export function App() {
  const login = useLogin();
  const { pathname } = useLocation();
  const [adding, setAdding] = useState(false);
  if (!login) {
    if (!PUBLIC.includes(pathname)) return <Navigate to="/bienvenue" replace />;
    return (
      <>
        <div className="ml-bg" aria-hidden="true" />
        <main className="shell-main" id="contenu">
          <div className="shell-content">
            <Routes>
              <Route path="/bienvenue" element={<WelcomePage />} />
              <Route path="/confidentialite" element={<PrivacyPage />} />
            </Routes>
          </div>
        </main>
      </>
    );
  }
  // Compte tout juste créé : la bienvenue montre d'abord la clé de secours, puis mène à l'accueil.
  if (pathname === '/bienvenue' && !pendingRecovery()) return <Navigate to="/" replace />;
  if (pathname === '/bienvenue') return <WelcomeKey />;
  return (
    <>
      <div className="ml-bg" aria-hidden="true" />
      <div className="shell">
        <Sidebar onAdd={() => setAdding(true)} />
        <main className="shell-main" id="contenu">
          <div className="shell-content">
            <RecoveryReminder />
            <Routes>
              <Route path="/" element={<TodayPage />} />
              <Route path="/modules" element={<ModulesPage />} />
              <Route path="/reglages" element={<SettingsPage />} />
              <Route path="/compte" element={<AccountPage />} />
              <Route path="/donnees" element={<DataPage />} />
              <Route path="/confidentialite" element={<PrivacyPage />} />
              <Route path="/installer" element={<InstallPage />} />
              <Route path="/kit" element={<KitPage />} />
              <Route
                path="/copilot"
                element={
                  <Suspense fallback={<span className="t-small muted">Chargement de Copilot…</span>}>
                    <CopilotPage />
                  </Suspense>
                }
              />
              <Route path="*" element={<EmptyState title="Page introuvable" body="Ce lien ne mène nulle part." action={<Button href="/v5/">Revenir à Aujourd’hui</Button>} />} />
            </Routes>
          </div>
        </main>
        <TabBar onAdd={() => setAdding(true)} />
      </div>
      <QuickAdd open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
