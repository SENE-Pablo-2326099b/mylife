import { Link } from 'react-router-dom';
import { EmptyState, PageTitle } from '../components/ui';
import { IconCheck, IconInfo, IconWarn } from '../components/icons';
import type { AlertLevel } from '../domain/alerts';
import { useAlerts } from '../domain/useAlerts';

const STYLE: Record<AlertLevel, { box: string; icon: JSX.Element; label: string }> = {
  bad: { box: 'border-bad/50 bg-bad/10', icon: <IconWarn className="text-bad" />, label: 'Important' },
  warn: { box: 'border-warn/50 bg-warn/10', icon: <IconWarn className="text-warn" />, label: 'À surveiller' },
  info: { box: 'border-line bg-surface', icon: <IconInfo className="text-accent" />, label: 'Info' },
};

export default function AlertsPage() {
  const alerts = useAlerts();
  return (
    <div className="space-y-4">
      <PageTitle sub="Recalculées à chaque synchro, sur le cycle en cours">Alertes d’optimisation</PageTitle>
      {alerts.length === 0 ? (
        <EmptyState title="Rien à signaler">
          <span className="inline-flex items-center gap-1 text-good">
            <IconCheck size={16} /> Tes dépenses sont dans les clous.
          </span>
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {alerts.map((a) => {
            const s = STYLE[a.level];
            const body = (
              <div className={`flex gap-3 rounded-2xl border p-4 ${s.box}`}>
                <span className="mt-0.5 shrink-0">{s.icon}</span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{s.label}</p>
                  <p className="font-semibold">{a.title}</p>
                  <p className="mt-1 text-sm text-muted">{a.detail}</p>
                </div>
              </div>
            );
            return <li key={a.id}>{a.link ? <Link to={a.link} className="block">{body}</Link> : body}</li>;
          })}
        </ul>
      )}
      <Link to="/reglages/alertes" className="inline-block text-sm text-accent underline">
        Configurer les alertes
      </Link>
    </div>
  );
}
