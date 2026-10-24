import { useState } from 'react';
import { useLatest } from '../../hooks';
import { db } from '../../db/db';
import { updateSettings } from '../../db/seed';
import { changeWithUndo } from '../../db/undo';
import { CADENCE_LABEL, type Recurring } from '../../domain/recurring';
import type { RecurringItem, RecurringKind } from '../../domain/recurringList';
import { setRecurringSkip } from '../../domain/useBudget';
import { useRecurringList } from '../../domain/useInsights';
import { useCategoryMap, useSettings } from '../../hooks';
import { formatShort } from '../../lib/dates';
import { formatCents } from '../../ui/money';
import { Badge, Button, Card, EmptyState, Group, Metric, Money, Reveal, Row, SectionTitle, Sheet, TextField, toast } from '../../ui/index';
import { Screen } from '../../ui/Screen';

const SECTIONS: { kind: RecurringKind; title: string }[] = [
  { kind: 'income', title: 'Revenus' },
  { kind: 'charge', title: 'Charges' },
  { kind: 'subscription', title: 'Abonnements' },
  { kind: 'savings', title: 'Épargne et investissements' },
];

const rhythm = (i: RecurringItem) => (i.cadence === 'monthly' && i.day ? `le ${i.day} de chaque mois` : CADENCE_LABEL[i.cadence]);
const origin = (i: RecurringItem) =>
  i.source === 'settings' ? (i.detected ? 'Réglages · vu à la banque' : 'Réglages') : i.source === 'plan' ? (i.detected ? 'Plan · vu à la banque' : 'Plan programmé') : i.confirmed ? 'Détecté · confirmé' : 'Détecté · à confirmer';

/**
 * Une seule liste de récurrents (refonte, étape 3) : revenus et charges des réglages, investissements programmés et
 * ce qui a été détecté dans les opérations, rapprochés (un même flux n'apparaît qu'une fois).
 */
export default function RecurringPage() {
  const { items, detected, cycle, loaded } = useRecurringList();
  const cats = useCategoryMap();
  const settings = useSettings();
  const [open, setOpen] = useState<string | null>(null);
  const [ignoredOpen, setIgnoredOpen] = useState<string | null>(null);
  const current = items.find((i) => i.id === open) ?? null;
  const shown = useLatest(current);
  const ignoredCurrent = detected.find((r) => r.key === ignoredOpen) ?? null;
  const ignoredShown = useLatest(ignoredCurrent);
  const [showIgnored, setShowIgnored] = useState(false);

  const ignored = detected.filter((r) => r.status === 'ignored');
  const subs = items.filter((i) => i.kind === 'subscription');
  const monthlySubs = subs.reduce((s, i) => s + i.monthly, 0);
  const monthlyIncome = items.filter((i) => i.kind === 'income').reduce((s, i) => s + i.monthly, 0);
  const changes = subs.filter((i) => i.detected?.priceChange && i.detected.priceChange.to > i.detected.priceChange.from);
  const toConfirm = items.filter((i) => !i.confirmed).length;

  const setStatus = async (r: Recurring, status: 'confirmed' | 'ignored' | null, label?: string | null) => {
    setOpen(null);
    setIgnoredOpen(null);
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

  const setDay = async (item: RecurringItem, day: number) => {
    if (!item.lineId) return;
    const patch = (lines: typeof settings.fixedCharges) => lines.map((l) => (l.id === item.lineId ? { ...l, day } : l));
    await updateSettings(item.kind === 'income' ? { incomes: patch(settings.incomes) } : { fixedCharges: patch(settings.fixedCharges) });
    toast({ message: `${item.label} : le ${day} de chaque mois` });
  };

  const skip = async (item: RecurringItem, on: boolean) => {
    await setRecurringSkip(cycle.start, { id: item.id, kind: item.kind, amount: item.monthly }, on);
    toast({ message: on ? `${item.label} sauté jusqu’au ${formatShort(cycle.end)}` : `${item.label} attendu de nouveau ce mois` });
  };

  const row = (i: RecurringItem) => {
    const c = i.categoryId ? cats.get(i.categoryId) : undefined;
    const price = i.detected?.priceChange;
    return (
      <Row
        key={i.id}
        emoji={c?.emoji ?? (i.kind === 'savings' ? '💰' : i.kind === 'income' ? '💶' : '🔁')}
        title={i.label}
        subtitle={
          <>
            {i.skipped ? 'Sauté ce mois' : i.paid ? `Passé le ${formatShort(i.paid.date)}` : i.nextDate ? `Prochain ${formatShort(i.nextDate)}` : 'Jour inconnu'}
            {' · '}
            <span className={i.confirmed ? '' : 'text-warning'}>{origin(i)}</span>
            {price && price.to !== price.from && <span className={price.to > price.from ? ' text-warning' : ' text-success'}> · {price.to > price.from ? 'hausse' : 'baisse'} de prix</span>}
          </>
        }
        onClick={() => setOpen(i.id)}
        right={
          <span className={`text-right ${i.skipped ? 'opacity-50' : ''}`}>
            <Money cents={i.kind === 'income' ? i.amount : -i.amount} sign tone={i.kind === 'income' ? 'success' : undefined} />
            {i.cadence !== 'monthly' && <span className="t-caption block text-muted">{formatCents(i.monthly, { compact: true })}/mois</span>}
          </span>
        }
      />
    );
  };

  return (
    <Screen stack title="Abonnements et récurrents" kicker="Réglages, plans et opérations" mood="budget" back="/budget">
      <Reveal index={0}>
        <Card level="raised" glow>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Abonnements / mois" value={formatCents(monthlySubs, { short: true })} hint={`soit ${formatCents(monthlySubs * 12, { short: true })} par an`} />
            <Metric label="Revenus / mois" value={formatCents(monthlyIncome, { short: true })} tone="success" />
          </div>
          {changes.length > 0 && (
            <p className="t-small mt-3 text-warning">
              {changes.length} abonnement{changes.length > 1 ? 's ont' : ' a'} augmenté : {changes.map((i) => `${i.label} (${formatCents(i.detected!.priceChange!.from)} → ${formatCents(i.detected!.priceChange!.to)})`).join(', ')}.
            </p>
          )}
          {toConfirm > 0 && <p className="t-small mt-3 text-secondary">{toConfirm} détecté{toConfirm > 1 ? 's' : ''} dans tes opérations à confirmer : touche-les pour dire si c’est bien récurrent.</p>}
        </Card>
      </Reveal>

      {loaded && items.length === 0 ? (
        <Card className="mt-4">
          <EmptyState icon="repeat" title="Rien de récurrent pour l’instant" body="Ajoute ta paie et tes charges dans les réglages du budget, ou reviens après quelques semaines de synchro : il faut deux ou trois échéances régulières d’un même commerçant." />
        </Card>
      ) : (
        SECTIONS.map(({ kind, title }, n) => {
          const list = items.filter((i) => i.kind === kind);
          return list.length ? (
            <Reveal key={kind} index={n + 1}>
              <SectionTitle action={<span className="t-caption text-muted">{list.length}</span>}>{title}</SectionTitle>
              <Group>{list.map(row)}</Group>
            </Reveal>
          ) : null;
        })
      )}
      {ignored.length > 0 && (
        <div className="mt-4">
          <Button variant="ghost" size="sm" onClick={() => setShowIgnored(!showIgnored)}>
            {showIgnored ? 'Masquer' : 'Voir'} les {ignored.length} écarté{ignored.length > 1 ? 's' : ''}
          </Button>
          {showIgnored && (
            <Group className="mt-2">
              {ignored.map((r) => (
                <Row key={r.key} emoji="🔁" title={r.label} subtitle={CADENCE_LABEL[r.cadence]} onClick={() => setIgnoredOpen(r.key)} right={<Money cents={r.amount} sign />} />
              ))}
            </Group>
          )}
        </div>
      )}

      <Sheet open={current !== null} onClose={() => setOpen(null)} title={shown?.label}>
        {shown && (
          <ItemDetail
            item={shown}
            cycleEnd={cycle.end}
            onStatus={(s, label) => shown.detected && void setStatus(shown.detected, s, label)}
            onDay={(d) => void setDay(shown, d)}
            onSkip={(on) => void skip(shown, on)}
          />
        )}
      </Sheet>
      <Sheet open={ignoredCurrent !== null} onClose={() => setIgnoredOpen(null)} title={ignoredShown?.label}>
        {ignoredShown && <RecurringDetail r={ignoredShown} onStatus={(s, label) => void setStatus(ignoredShown, s, label)} />}
      </Sheet>
    </Screen>
  );
}

function ItemDetail({
  item,
  cycleEnd,
  onStatus,
  onDay,
  onSkip,
}: {
  item: RecurringItem;
  cycleEnd: string;
  onStatus: (s: 'confirmed' | 'ignored' | null, label?: string | null) => void;
  onDay: (day: number) => void;
  onSkip: (on: boolean) => void;
}) {
  const [day, setDay] = useState(item.day ? String(item.day) : '');
  const typed = Number(day);
  const validDay = Number.isInteger(typed) && typed >= 1 && typed <= 31;
  const lineWithoutDay = item.source === 'settings' && item.lineId && !item.direct && (item.detected?.dayOfMonth == null || item.day !== item.detected.dayOfMonth);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Metric label="Montant" value={formatCents(item.kind === 'income' ? item.amount : -item.amount, { sign: true })} tone={item.kind === 'income' ? 'success' : undefined} />
        <Metric label="Par mois" value={formatCents(item.monthly, { compact: true })} />
        <Metric label="Rythme" value={rhythm(item)} />
        <Metric label="Ce cycle" value={item.skipped ? 'Sauté' : item.paid ? `Passé le ${formatShort(item.paid.date)}` : item.nextDate ? formatShort(item.nextDate) : 'Jour inconnu'} />
      </div>
      <p className="t-small text-secondary">
        {item.source === 'settings'
          ? item.detected
            ? `Saisi dans tes réglages et retrouvé à la banque (« ${item.detected.label} », ${item.detected.count} échéances) : c’est la même chose, comptée une seule fois.`
            : item.direct
              ? 'Saisi dans tes réglages, versé directement à un tiers : il compte dans le budget sans arriver sur ton compte.'
              : 'Saisi dans tes réglages, pas encore retrouvé dans tes opérations.'
          : item.source === 'plan'
            ? item.detected
              ? `Investissement programmé, retrouvé à la banque (« ${item.detected.label} ») : le virement et le plan ne font qu’un.`
              : 'Investissement programmé (onglet Patrimoine).'
            : `Détecté sur ${item.detected?.count ?? 0} échéances. ${item.confirmed ? 'Tu l’as confirmé.' : 'Confirme-le pour qu’il compte comme récurrent.'}`}
      </p>

      {lineWithoutDay && (
        <div className="space-y-2">
          {item.detected?.dayOfMonth ? (
            <Button variant="secondary" onClick={() => onDay(item.detected!.dayOfMonth!)}>
              Prendre le jour constaté : le {item.detected.dayOfMonth}
            </Button>
          ) : (
            <>
              <TextField label="Jour de prélèvement" inputMode="numeric" value={day} onChange={setDay} placeholder="1 à 31" hint="Sert à la prévision : le jour du mois où il passe." />
              <Button variant="secondary" disabled={!validDay} onClick={() => onDay(typed)}>
                Enregistrer le jour
              </Button>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {item.kind !== 'income' && !item.paid && (
          <Button variant={item.skipped ? 'secondary' : 'primary'} onClick={() => onSkip(!item.skipped)}>
            {item.skipped ? 'Reprendre ce mois' : `Sauter ce mois (jusqu’au ${formatShort(cycleEnd)})`}
          </Button>
        )}
        {item.source === 'detected' && item.detected && !item.confirmed && (
          <Button icon="check" onClick={() => onStatus('confirmed')}>
            C’est bien récurrent
          </Button>
        )}
        {item.source === 'detected' && (
          <Button variant="secondary" onClick={() => onStatus('ignored')}>
            Ce n’est pas récurrent
          </Button>
        )}
        {item.source === 'settings' && (
          <Button variant="ghost" to="/reglages/budget">
            Modifier dans les réglages
          </Button>
        )}
        {item.source === 'plan' && (
          <Button variant="ghost" to="/patrimoine?vue=placements">
            Voir le plan
          </Button>
        )}
        {item.detected && (
          <Button variant="ghost" to={`/operations?q=${encodeURIComponent(item.detected.label)}&periode=all`}>
            Voir les opérations
          </Button>
        )}
      </div>
    </div>
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
