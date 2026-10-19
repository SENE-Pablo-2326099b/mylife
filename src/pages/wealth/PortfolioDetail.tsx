import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLatest } from '../../hooks';
import { db } from '../../db/db';
import { changeWithUndo } from '../../db/undo';
import type { Holding, InvestmentOp, InvestmentPlan } from '../../db/types';
import { FREQUENCY_LABEL, monthlyEquivalent, nextOccurrence } from '../../domain/plans';
import { ASSET_CLASS_LABEL, OP_LABEL, type Position } from '../../domain/wealth';
import { deleteHolding, deletePortfolio, recordSnapshot, refreshPlannedSavings, refreshQuotes } from '../../domain/wealthDb';
import { useWealth } from '../../domain/useWealth';
import { formatShort, todayISO } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { relativeTime } from '../../lib/relative';
import { Badge, Button, Card, EmptyState, Group, IconButton, Metric, Money, Reveal, Row, SectionTitle, Sheet, Tap, toast, ActionList } from '../../ui/index';
import { NotFoundScreen, Screen } from '../../ui/Screen';
import { HoldingForm, OpForm, PlanForm, PortfolioForm } from './forms';

const qty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 8 });
const pct = (gain: number, base: number) => (base > 0 ? `${gain >= 0 ? '+' : ''}${((gain * 100) / base).toFixed(1).replace('.', ',')} %` : '');

type Panel = { kind: 'holding'; holding: Holding | null } | { kind: 'position'; id: string } | { kind: 'op'; holding: Holding; op: InvestmentOp | null } | { kind: 'plan'; holding: Holding; plan: InvestmentPlan | null } | { kind: 'edit' } | { kind: 'menu' };

export default function PortfolioDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const w = useWealth();
  const [panel, setPanel] = useState<Panel | null>(null);
  const shown = useLatest(panel);
  const [refreshing, setRefreshing] = useState(false);
  const summary = w.summaries.find((s) => s.portfolio.id === id);

  if (!w.loaded) return <Screen stack title="" mood="wealth" back="/patrimoine">{null}</Screen>;
  if (!summary) return <NotFoundScreen title="Placement introuvable" back="/patrimoine" />;
  const p = summary.portfolio;
  const hIds = new Set(summary.positions.map((x) => x.holding.id));
  const plans = w.plans.filter((pl) => hIds.has(pl.holdingId));
  const position = shown?.kind === 'position' ? summary.positions.find((x) => x.holding.id === shown.id) : undefined;
  const lastQuote = Math.max(0, ...summary.positions.map((x) => x.holding.priceAt ?? 0));

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await refreshQuotes({ force: true });
      await recordSnapshot();
      toast({ message: r.skipped ?? (r.errors.length ? `${r.updated} cours à jour · ${r.errors[0]}` : `${r.updated} cours mis à jour`), tone: r.errors.length ? 'danger' : 'default' });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'danger' });
    } finally {
      setRefreshing(false);
    }
  };

  const deleteOp = (op: InvestmentOp) =>
    void changeWithUndo(`${OP_LABEL[op.type]} du ${formatShort(op.date)} supprimé`, async () => ({ investmentOps: [op] }), async () => {
      await db.investmentOps.delete(op.id);
      await recordSnapshot();
    });

  const deletePlan = (plan: InvestmentPlan) =>
    void changeWithUndo(
      'Investissement programmé supprimé',
      async () => ({ plans: [plan] }),
      async () => {
        await db.plans.delete(plan.id);
        await refreshPlannedSavings();
      },
      refreshPlannedSavings,
    );

  const title = shown?.kind === 'holding' ? (shown.holding ? 'Modifier la ligne' : 'Nouvelle ligne') : shown?.kind === 'op' ? 'Mouvement' : shown?.kind === 'plan' ? 'Investissement programmé' : shown?.kind === 'edit' ? 'Modifier le placement' : shown?.kind === 'position' ? (position?.holding.name ?? '') : p.name;

  return (
    <Screen
      stack
      title={p.name}
      kicker={`${p.provider || 'Placement'} · ${p.wrapper}`}
      mood="wealth"
      back="/patrimoine"
      right={<IconButton icon="more" label="Actions" onClick={() => setPanel({ kind: 'menu' })} />}
      footer={
        <Button size="lg" icon="add" className="w-full" onClick={() => setPanel({ kind: 'holding', holding: null })}>
          Ajouter une ligne
        </Button>
      }
    >
      <Reveal index={0}>
        <Card level="raised" glow={summary.gain >= 0 && summary.invested > 0}>
          <p className="t-label text-muted">Valeur</p>
          <Money cents={summary.value} className="mt-1 block text-[34px] tracking-[-1px]" />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Metric label="Investi" value={formatCents(summary.invested, { compact: true })} />
            <Metric label="Plus-value latente" value={formatCents(summary.gain, { sign: true, compact: true })} tone={summary.gain >= 0 ? 'success' : 'danger'} hint={pct(summary.gain, summary.invested)} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {summary.missingPrices > 0 && <Badge tone="warning">{summary.missingPrices} ligne(s) sans cours : comptées au prix de revient</Badge>}
            <span className="t-caption text-muted">Cours {lastQuote ? relativeTime(lastQuote) : 'jamais mis à jour'}</span>
            <Button variant="ghost" size="sm" icon="sync" disabled={refreshing} onClick={() => void refresh()}>
              {refreshing ? 'Mise à jour…' : 'Actualiser'}
            </Button>
          </div>
        </Card>
      </Reveal>

      <Reveal index={1}>
        <SectionTitle>Lignes</SectionTitle>
        {summary.positions.length === 0 ? (
          <Card>
            <EmptyState icon="layers" title="Aucune ligne" body="Ajoute ce que tu détiens : un ETF, une action, du bitcoin, un fonds euros… Cherche-le par nom ou ISIN pour suivre son cours." />
          </Card>
        ) : (
          <Group>
            {summary.positions.map((x: Position) => (
              <Row
                key={x.holding.id}
                icon={x.holding.assetClass === 'crypto' ? 'sparkles' : x.holding.assetClass === 'cash' ? 'leaf' : 'trend-up'}
                title={x.holding.name}
                subtitle={x.holding.assetClass === 'cash' ? 'Liquidités' : `${qty(x.quantity)} × ${x.holding.price !== null ? formatCents(Math.round(x.holding.price)) : 'cours ?'}${x.averageCost ? ` · PRU ${formatCents(x.averageCost)}` : ''}`}
                onClick={() => setPanel({ kind: 'position', id: x.holding.id })}
                right={
                  <span className="text-right">
                    <Money cents={x.value ?? x.invested} compact />
                    {x.gain !== null && x.invested > 0 && <span className={`t-caption block ${x.gain >= 0 ? 'text-success' : 'text-danger'}`}>{pct(x.gain, x.invested)}</span>}
                  </span>
                }
              />
            ))}
          </Group>
        )}
      </Reveal>

      {plans.length > 0 && (
        <Reveal index={2}>
          <SectionTitle action={<span className="t-caption text-muted">{formatCents(plans.reduce((s, pl) => s + monthlyEquivalent(pl), 0))}/mois</span>}>Investissements programmés</SectionTitle>
          <Group>
            {plans.map((pl) => {
              const h = summary.positions.find((x) => x.holding.id === pl.holdingId)?.holding;
              const next = nextOccurrence(pl, todayISO());
              return (
                <Row
                  key={pl.id}
                  icon="repeat"
                  iconTone={pl.active ? 'accent' : undefined}
                  title={`${formatCents(pl.amount)} · ${h?.name ?? ''}`}
                  subtitle={`${FREQUENCY_LABEL[pl.frequency]}${pl.active && next ? ` · prochain le ${formatShort(next)}` : pl.active ? '' : ' · en pause'}`}
                  onClick={() => h && setPanel({ kind: 'plan', holding: h, plan: pl })}
                />
              );
            })}
          </Group>
        </Reveal>
      )}

      <Sheet open={panel !== null} onClose={() => setPanel(null)} title={title}>
        {shown?.kind === 'menu' && (
          <ActionList
            onClose={() => setPanel(null)}
            actions={[
              { label: 'Modifier le placement', icon: 'edit', onClick: () => setTimeout(() => setPanel({ kind: 'edit' }), 50) },
              { label: 'Actualiser les cours', icon: 'sync', onClick: () => void refresh() },
              {
                label: 'Supprimer le placement',
                icon: 'trash',
                destructive: true,
                onClick: () => {
                  navigate('/patrimoine', { replace: true });
                  void deletePortfolio(p.id);
                },
              },
            ]}
          />
        )}
        {shown?.kind === 'edit' && <PortfolioForm initial={p} onDone={() => setPanel(null)} />}
        {shown?.kind === 'holding' && <HoldingForm key={shown.holding?.id ?? 'new'} portfolio={p} initial={shown.holding} onDone={() => setPanel(null)} />}
        {shown?.kind === 'op' && <OpForm key={shown.op?.id ?? 'new'} holding={shown.holding} initial={shown.op} onDone={() => setPanel(null)} />}
        {shown?.kind === 'plan' && (
          <div className="space-y-3">
            <PlanForm key={shown.plan?.id ?? 'new'} holding={shown.holding} initial={shown.plan} onDone={() => setPanel(null)} />
            {shown.plan && (
              <Button
                variant="danger"
                icon="trash"
                className="w-full"
                onClick={() => {
                  setPanel(null);
                  if (shown.plan) deletePlan(shown.plan);
                }}
              >
                Supprimer le plan
              </Button>
            )}
          </div>
        )}
        {shown?.kind === 'position' && position && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Valeur" value={formatCents(position.value ?? position.invested, { compact: true })} />
              <Metric label="Plus-value" value={position.gain === null ? '—' : formatCents(position.gain, { sign: true, compact: true })} tone={position.gain !== null && position.gain < 0 ? 'danger' : 'success'} hint={position.gain !== null ? pct(position.gain, position.invested) : undefined} />
              {position.holding.assetClass !== 'cash' && <Metric label="Quantité" value={qty(position.quantity)} />}
              {position.averageCost !== null && <Metric label="Prix de revient" value={formatCents(position.averageCost)} />}
              {position.income !== 0 && <Metric label="Dividendes nets" value={formatCents(position.income, { sign: true, compact: true })} tone="success" />}
            </div>
            <p className="t-caption text-muted">
              {ASSET_CLASS_LABEL[position.holding.assetClass]}
              {position.holding.symbol ? ` · ${position.holding.symbol}` : ''} · cours {position.holding.quoteSource === 'manual' ? 'saisi à la main' : position.holding.quoteSource === 'yahoo' ? 'Yahoo Finance' : 'CoinGecko'}
              {position.holding.priceAt ? `, ${relativeTime(position.holding.priceAt)}` : ''}
            </p>
            {position.estimated && <Badge tone="warning">Quantités estimées par un plan programmé : vérifie-les avec ton relevé</Badge>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon="add" onClick={() => setPanel({ kind: 'op', holding: position.holding, op: null })}>
                Mouvement
              </Button>
              <Button size="sm" variant="secondary" icon="repeat" onClick={() => setPanel({ kind: 'plan', holding: position.holding, plan: null })}>
                Programmer
              </Button>
              <Button size="sm" variant="secondary" icon="edit" onClick={() => setPanel({ kind: 'holding', holding: position.holding })}>
                Modifier
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon="trash"
                onClick={() => {
                  setPanel(null);
                  void deleteHolding(position.holding.id);
                }}
              >
                Supprimer
              </Button>
            </div>
            <div>
              <p className="t-label mb-2 text-muted">Mouvements</p>
              <Group>
                {w.ops
                  .filter((o) => o.holdingId === position.holding.id)
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .slice(0, 30)
                  .map((o) => (
                    <div key={o.id} className="flex min-h-[54px] items-center gap-2 pl-4 pr-1">
                      <Tap onClick={() => setPanel({ kind: 'op', holding: position.holding, op: o })} scaleTo={0.985} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left">
                        <span className="min-w-0 flex-1">
                          <span className="t-body-strong block truncate">
                            {OP_LABEL[o.type]}
                            {o.estimated && <span className="text-warning"> · estimé</span>}
                          </span>
                          <span className="t-caption block truncate text-muted">
                            {formatShort(o.date)}
                            {o.quantity ? ` · ${qty(o.quantity)}` : ''}
                            {o.note ? ` · ${o.note}` : ''}
                          </span>
                        </span>
                        <Money cents={o.type === 'buy' || o.type === 'fee' ? -o.amount : o.amount} sign tone={o.type === 'dividend' || o.type === 'interest' ? 'success' : undefined} />
                      </Tap>
                      <IconButton icon="trash" size={17} label="Supprimer ce mouvement" onClick={() => deleteOp(o)} tone="muted" />
                    </div>
                  ))}
              </Group>
            </div>
          </div>
        )}
      </Sheet>
    </Screen>
  );
}
