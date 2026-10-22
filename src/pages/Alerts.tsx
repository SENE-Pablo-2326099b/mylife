import type { AlertLevel } from '../domain/alerts';
import { useAlertsState } from '../domain/useAlerts';
import { Button, Card, EmptyState, Icon, Reveal, type IconName } from '../ui/index';
import { Screen } from '../ui/Screen';
import { Pending } from '../ui/extras';

const STYLE: Record<AlertLevel, { tone: 'danger' | 'warning' | 'info'; icon: IconName; label: string }> = {
  bad: { tone: 'danger', icon: 'warning', label: 'Important' },
  warn: { tone: 'warning', icon: 'alert-circle', label: 'À surveiller' },
  info: { tone: 'info', icon: 'info', label: 'Info' },
};

export default function AlertsPage() {
  const { alerts, loaded } = useAlertsState();
  return (
    <Screen stack title="Alertes" kicker="Recalculées à chaque synchro" mood="focus" right={<Button variant="ghost" size="sm" to="/reglages/alertes">Régler</Button>}>
      {!loaded ? (
        <Pending cards={1} />
      ) : alerts.length === 0 ? (
        <Card level="raised" glow>
          <EmptyState icon="check-circle" title="Rien à signaler" body="Tes dépenses sont dans les clous." />
        </Card>
      ) : (
        <ul className="space-y-3">
          {alerts.map((a, i) => {
            const s = STYLE[a.level];
            return (
              <li key={a.id}>
                <Reveal index={i}>
                  <Card to={a.link} tone={s.tone} className="flex gap-3">
                    <Icon name={s.icon} size={22} className={`mt-0.5 text-${s.tone}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`t-label text-${s.tone}`}>{s.label}</p>
                      <p className="t-headline mt-0.5">{a.title}</p>
                      <p className="t-small mt-1 text-secondary">{a.detail}</p>
                    </div>
                    {a.link && <Icon name="chevron-forward" size={17} className="self-center text-muted" />}
                  </Card>
                </Reveal>
              </li>
            );
          })}
        </ul>
      )}
    </Screen>
  );
}
