import { useState } from 'react';
import { useForecast } from '../../domain/useInsights';
import { useSettings } from '../../hooks';
import { addDays, cycleFor, diffDays, formatDay, formatLong, formatShort, todayISO } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { LineChart } from '../../ui/charts';
import { Badge, Button, Card, Disclosure, EmptyState, Group, Icon, Metric, Money, Reveal, Row, SectionTitle, Segmented } from '../../ui/index';
import { Screen } from '../../ui/Screen';
import { Pending } from '../../ui/extras';

const HORIZONS = [
  { value: 'cycle', label: 'Jusqu’à la paie' },
  { value: '30', label: '30 jours' },
  { value: '90', label: '90 jours' },
] as const;

const SOURCE_LABEL = { recurring: 'récurrent détecté', income: 'revenu prévu', charge: 'charge prévue', plan: 'investissement programmé' } as const;

/** Prévision de trésorerie : vais-je finir le cycle dans le vert, et quel sera le point bas ? */
export default function ForecastPage() {
  const settings = useSettings();
  const [h, setH] = useState<(typeof HORIZONS)[number]['value']>('cycle');
  const today = todayISO();
  const until = h === 'cycle' ? cycleFor(today, settings.payday).end : addDays(today, Number(h));
  const { forecast, hasBalances, loaded } = useForecast(until);

  if (!loaded) {
    return (
      <Screen stack title="Prévision de trésorerie" mood="budget" back="/budget">
        <Pending />
      </Screen>
    );
  }
  if (!hasBalances || !forecast) {
    return (
      <Screen stack title="Prévision de trésorerie" mood="budget" back="/budget">
        <Card level="raised">
          <EmptyState icon="trend-up" title="Il faut un solde de départ" body="La prévision part du solde de tes comptes courants : connecte une banque (ou charge la démo)." action={<Button to="/synchro" icon="bank">Banques</Button>} />
        </Card>
      </Screen>
    );
  }

  const negative = forecast.lowest.balance < 0;
  const tight = !negative && forecast.lowest.balance < forecast.dailySpend * 5;
  const days = diffDays(today, until);

  return (
    <Screen stack title="Prévision de trésorerie" kicker={`Comptes courants · ${days} jours`} mood="budget" back="/budget">
      <Reveal index={0}>
        <Card level="raised" glow={!negative && !tight} tone={negative ? 'danger' : tight ? 'warning' : 'neutral'}>
          <p className="t-label text-muted">Solde prévu le {formatShort(until)}</p>
          <Money cents={forecast.end} className={`mt-1 block text-[40px] leading-[46px] tracking-[-1.2px] ${forecast.end < 0 ? 'text-danger' : ''}`} />
          <p className="t-small mt-1 text-secondary">
            Aujourd’hui <Money cents={forecast.start} className="text-[13px] text-ink" /> · {formatCents(forecast.end - forecast.start, { sign: true })} d’ici là
          </p>
          <div className="mt-3">
            {negative ? (
              <Badge tone="danger" icon="warning">
                Découvert prévu le {formatShort(forecast.lowest.date)} ({formatCents(forecast.lowest.balance)})
              </Badge>
            ) : tight ? (
              <Badge tone="warning" icon="warning">
                Point bas serré le {formatShort(forecast.lowest.date)} : {formatCents(forecast.lowest.balance)}
              </Badge>
            ) : (
              <Badge tone="success" icon="check-circle">
                Point bas {formatCents(forecast.lowest.balance, { compact: true })} le {formatShort(forecast.lowest.date)}
              </Badge>
            )}
          </div>
        </Card>
      </Reveal>

      <Reveal index={1} className="mt-3">
        <Segmented options={HORIZONS} value={h} onChange={setH} label="Horizon" />
      </Reveal>

      <Reveal index={2}>
        <SectionTitle>Solde jour par jour</SectionTitle>
        <Card>
          <LineChart
            series={[{ id: 'b', label: 'Solde prévu', values: forecast.points.map((p) => p.balance), look: 'primary' }]}
            xLabels={forecast.points.map((p) => formatShort(p.date))}
            formatY={(v) => formatCents(v, { short: true })}
            zero={forecast.lowest.balance < 0}
            ariaLabel={`Solde prévu : ${formatCents(forecast.start)} aujourd’hui, ${formatCents(forecast.end)} le ${formatLong(until)}, point bas ${formatCents(forecast.lowest.balance)}.`}
          />
        </Card>
      </Reveal>

      <Reveal index={3}>
        <SectionTitle action={<span className="t-caption text-muted">{forecast.events.length}</span>}>À venir</SectionTitle>
        {forecast.events.length === 0 ? (
          <p className="t-small px-0.5 text-muted">Aucun revenu ni charge récurrente connus sur la période. Ajoute-les dans Réglages → Revenus, charges et épargne, avec leur jour.</p>
        ) : (
          <Group>
            {forecast.events.slice(0, 40).map((e, i) => (
              <Row
                key={`${e.date}${e.label}${i}`}
                icon={e.amount > 0 ? 'arrow-down' : e.source === 'plan' ? 'trend-up' : 'arrow-up'}
                iconTone={e.amount > 0 ? 'success' : undefined}
                title={e.label}
                subtitle={`${formatDay(e.date)} · ${SOURCE_LABEL[e.source]}`}
                right={<Money cents={e.amount} sign tone={e.amount > 0 ? 'success' : undefined} />}
              />
            ))}
          </Group>
        )}
      </Reveal>

      <Reveal index={4}>
        <Disclosure title="Comment c’est calculé">
          <Card className="space-y-2">
            <Metric label="Dépenses courantes retenues" value={`${formatCents(forecast.dailySpend)} / jour`} hint="Ton rythme moyen des 8 dernières semaines (hors charges fixes)." />
            <p className="t-small text-secondary">
              <Icon name="info" size={14} className="mr-1 inline align-[-2px]" />
              Départ : solde actuel des comptes courants (hors épargne et comptes masqués). On ajoute les revenus et charges récurrents détectés dans tes opérations, puis ceux saisis dans les réglages qui n’y figurent pas encore, et tes investissements programmés. Les virements entre tes comptes s’annulent.
            </p>
            {settings.incomes.some((l) => !l.day) && <p className="t-small text-warning">Certains revenus n’ont pas de jour : ils ne sont pas dans la prévision.</p>}
          </Card>
        </Disclosure>
      </Reveal>
    </Screen>
  );
}
