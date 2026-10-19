import { useState } from 'react';
import { useLatest } from '../../hooks';
import { db } from '../../db/db';
import { changeWithUndo } from '../../db/undo';
import { CADENCE_LABEL, subscriptionsMonthly, type Recurring } from '../../domain/recurring';
import { useRecurring } from '../../domain/useInsights';
import { useCategoryMap } from '../../hooks';
import { formatShort } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { Badge, Button, Card, EmptyState, Group, Metric, Money, Reveal, Row, SectionTitle, Sheet, TextField, toast } from '../../ui/index';
import { Screen } from '../../ui/Screen';

/** Abonnements et récurrents détectés : ce qui part (et arrive) tout seul chaque mois. */
export default function RecurringPage() {
  const { list, loaded } = useRecurring();
  const cats = useCategoryMap();
  const [open, setOpen] = useState<string | null>(null);
  const current = list.find((r) => r.key === open) ?? null;
  const shown = useLatest(current);
  const [showIgnored, setShowIgnored] = useState(false);

  const visible = list.filter((r) => r.active && r.status !== 'ignored');
  const subs = visible.filter((r) => r.kind === 'expense' && r.subscription);
  const charges = visible.filter((r) => r.kind === 'expense' && !r.subscription);
  const incomes = visible.filter((r) => r.kind === 'income');
  const ignored = list.filter((r) => r.status === 'ignored');
  const changes = subs.filter((r) => r.priceChange && r.priceChange.to > r.priceChange.from);
  const monthlySubs = subscriptionsMonthly(list);

  const setStatus = async (r: Recurring, status: 'confirmed' | 'ignored' | null, label?: string | null) => {
    setOpen(null);
    if (status === 'ignored') {
      await changeWithUndo(`${r.label} retiré des récurrents`, async () => ({ recurring: (await db.recurring.get(r.key)) ? [await db.recurring.get(r.key)] : [] }), () => db.recurring.put({ key: r.key, status: 'ignored', label: label ?? null }), async () => {
        const prev = await db.recurring.get(r.key);
        if (prev?.status === 'ignored') await db.recurring.delete(r.key);
      });
    } else if (status === null) await db.recurring.delete(r.key);
    else {
      await db.recurring.put({ key: r.key, status, label: label ?? null });
      toast({ message: `${label ?? r.label} confirmé` });
    }
  };

  const row = (r: Recurring) => {
    const c = r.categoryId ? cats.get(r.categoryId) : undefined;
    return (
      <Row
        key={r.key}
        emoji={c?.emoji ?? '🔁'}
        title={r.label}
        subtitle={
          <>
            {CADENCE_LABEL[r.cadence]} · prochain {formatShort(r.nextDate)}
            {r.priceChange && r.priceChange.to !== r.priceChange.from && (
              <span className={r.priceChange.to > r.priceChange.from ? ' text-warning' : ' text-success'}> · {r.priceChange.to > r.priceChange.from ? 'hausse' : 'baisse'} de prix</span>
            )}
          </>
        }
        onClick={() => setOpen(r.key)}
        right={
          <span className="text-right">
            <Money cents={r.amount} sign tone={r.kind === 'income' ? 'success' : undefined} />
            {r.cadence !== 'monthly' && <span className="t-caption block text-muted">{formatCents(Math.abs(r.monthly), { compact: true })}/mois</span>}
          </span>
        }
      />
    );
  };

  return (
    <Screen stack title="Abonnements et récurrents" kicker="Détectés dans tes opérations" mood="budget" back="/budget">
      <Reveal index={0}>
        <Card level="raised" glow>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Abonnements / mois" value={formatCents(monthlySubs, { short: true })} hint={`soit ${formatCents(monthlySubs * 12, { short: true })} par an`} />
            <Metric label="Revenus / mois" value={formatCents(incomes.reduce((s, r) => s + r.monthly, 0), { short: true })} tone="success" />
          </div>
          {changes.length > 0 && (
            <p className="t-small mt-3 text-warning">
              {changes.length} abonnement{changes.length > 1 ? 's ont' : ' a'} augmenté : {changes.map((r) => `${r.label} (${formatCents(r.priceChange!.from)} → ${formatCents(r.priceChange!.to)})`).join(', ')}.
            </p>
          )}
        </Card>
      </Reveal>

      {loaded && visible.length === 0 ? (
        <Card className="mt-4">
          <EmptyState icon="repeat" title="Rien de récurrent pour l’instant" body="Il faut au moins deux ou trois échéances régulières d’un même commerçant. Reviens après quelques semaines de synchro." />
        </Card>
      ) : (
        <>
          {subs.length > 0 && (
            <Reveal index={1}>
              <SectionTitle action={<span className="t-caption text-muted">{subs.length}</span>}>Abonnements</SectionTitle>
              <Group>{subs.map(row)}</Group>
            </Reveal>
          )}
          {charges.length > 0 && (
            <Reveal index={2}>
              <SectionTitle>Charges et versements réguliers</SectionTitle>
              <Group>{charges.map(row)}</Group>
            </Reveal>
          )}
          {incomes.length > 0 && (
            <Reveal index={3}>
              <SectionTitle>Revenus réguliers</SectionTitle>
              <Group>{incomes.map(row)}</Group>
            </Reveal>
          )}
          {ignored.length > 0 && (
            <div className="mt-4">
              <Button variant="ghost" size="sm" onClick={() => setShowIgnored(!showIgnored)}>
                {showIgnored ? 'Masquer' : 'Voir'} les {ignored.length} écarté{ignored.length > 1 ? 's' : ''}
              </Button>
              {showIgnored && <Group className="mt-2">{ignored.map(row)}</Group>}
            </div>
          )}
        </>
      )}

      <Sheet open={current !== null} onClose={() => setOpen(null)} title={shown?.label}>
        {shown && <RecurringDetail r={shown} onStatus={(s, label) => void setStatus(shown, s, label)} />}
      </Sheet>
    </Screen>
  );
}

function RecurringDetail({ r, onStatus }: { r: Recurring; onStatus: (s: 'confirmed' | 'ignored' | null, label?: string | null) => void }) {
  const [label, setLabel] = useState(r.label);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Metric label="Montant habituel" value={formatCents(r.amount, { sign: true })} tone={r.kind === 'income' ? 'success' : undefined} />
        <Metric label="Par mois" value={formatCents(r.monthly, { sign: true, compact: true })} />
        <Metric label="Rythme" value={CADENCE_LABEL[r.cadence]} />
        <Metric label="Prochaine fois" value={formatShort(r.nextDate)} hint={`dernière : ${formatShort(r.lastDate)}`} />
      </div>
      {r.priceChange && (
        <Badge tone={r.priceChange.to > r.priceChange.from ? 'warning' : 'success'} icon="warning">
          Prix passé de {formatCents(r.priceChange.from)} à {formatCents(r.priceChange.to)}
        </Badge>
      )}
      <p className="t-small text-secondary">Repéré sur {r.count} échéances. {r.status === 'confirmed' ? 'Tu l’as confirmé.' : r.status === 'ignored' ? 'Tu l’as écarté.' : 'Détection automatique.'}</p>
      <TextField label="Nom affiché" value={label} onChange={setLabel} />
      <div className="flex flex-wrap gap-2">
        {r.status !== 'confirmed' && (
          <Button icon="check" onClick={() => onStatus('confirmed', label !== r.label ? label : null)}>
            C’est bien récurrent
          </Button>
        )}
        {r.status === 'confirmed' && label !== r.label && <Button onClick={() => onStatus('confirmed', label)}>Renommer</Button>}
        {r.status !== 'ignored' ? (
          <Button variant="secondary" onClick={() => onStatus('ignored')}>
            Ce n’est pas récurrent
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => onStatus(null)}>
            Remettre
          </Button>
        )}
        <Button variant="ghost" to={`/operations?q=${encodeURIComponent(r.label)}&periode=all`}>
          Voir les opérations
        </Button>
      </div>
    </div>
  );
}
