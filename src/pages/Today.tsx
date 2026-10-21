import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BudgetExplainer } from '../components/BudgetExplainer';
import { ExceptionalSheet } from '../components/ExceptionalSheet';
import { TxEditor } from '../components/TxEditor';
import { TxRow } from '../components/TxRow';
import { db, getMeta } from '../db/db';
import type { Transaction } from '../db/types';
import { isVariable, type Status } from '../domain/budget';
import { useBudget } from '../domain/useBudget';
import { useAlerts } from '../domain/useAlerts';
import { useAccounts, useCategories, useCategoryMap } from '../hooks';
import { formatCycle, formatDay, formatShort, todayISO } from '../lib/dates';
import { formatCents } from '../lib/money';
import { relativeTime } from '../lib/relative';
import { useSyncState } from '../sync/store';
import { Ring } from '../ui/charts';
import { Icon } from '../ui/icons';
import { Badge, Button, Card, EmptyState, Group, IconButton, Money, Reveal, SectionTitle, StatTile } from '../ui/index';
import { Screen } from '../ui/Screen';

const STATUS: Record<Status, { label: string; tone: 'success' | 'warning' | 'danger'; icon: 'check-circle' | 'warning' }> = {
  good: { label: 'Dans le budget', tone: 'success', icon: 'check-circle' },
  warn: { label: 'Presque atteint', tone: 'warning', icon: 'warning' },
  bad: { label: 'Dépassé', tone: 'danger', icon: 'warning' },
};

/** Actions de l'en-tête des écrans principaux : alertes et synchro. */
export function HeaderActions() {
  const alerts = useAlerts();
  const sync = useSyncState();
  const serious = alerts.filter((a) => a.level !== 'info').length;
  return (
    <>
      <IconButton
        icon="bell"
        label={serious ? `Alertes (${serious})` : 'Alertes'}
        to="/alertes"
        glass
        badge={serious > 0 ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full" style={{ background: 'var(--danger)', boxShadow: '0 0 8px var(--danger)' }} /> : undefined}
      />
      <IconButton icon="sync" label="Synchronisation bancaire" to="/synchro" glass className={sync.syncing ? '[&>svg]:animate-spin' : ''} />
    </>
  );
}

export default function TodayPage() {
  const categories = useCategories();
  const cats = useCategoryMap();
  const accounts = useAccounts();
  const today = todayISO();
  const { state: b, txs: windowTxs } = useBudget(today);
  const txs = windowTxs.filter((t) => t.date >= b.cycle.start && t.date <= b.cycle.end);
  const total = useLiveQuery(() => db.transactions.count(), []);
  const toClassify = useLiveQuery(() => db.transactions.filter((t) => t.categoryId === null).count(), []) ?? 0;
  const lastSync = useLiveQuery(() => getMeta<number>('lastSyncAt'), []);
  const alerts = useAlerts();
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [explain, setExplain] = useState(false);
  const [exceptional, setExceptional] = useState(false);

  const todayTxs = txs.filter((t) => t.date === today).sort((x, y) => x.amount - y.amount);
  const accMap = new Map(accounts.map((a) => [a.id, a]));
  const serious = alerts.filter((a) => a.level !== 'info');
  const status = STATUS[b.status];

  if (total === 0) {
    return (
      <Screen title="Bienvenue" kicker="Aujourd’hui" mood="today">
        <Reveal>
          <Card level="raised" glow>
            <EmptyState
              icon="sparkles"
              title="Aucune opération pour l’instant"
              body="Connecte ta banque via Enable Banking pour suivre tes dépenses au jour près, ou essaie l’app avec des données fictives."
              action={
                <>
                  <Button to="/synchro" icon="bank">
                    Connecter ma banque
                  </Button>
                  <Button to="/reglages/donnees" variant="secondary">
                    Essayer la démo
                  </Button>
                </>
              }
            />
          </Card>
        </Reveal>
      </Screen>
    );
  }

  // Enveloppe dépassée : on montre le déficit, jamais un budget du jour négatif.
  const over = b.overrun;
  const heroLabel = over ? (b.limitedBy === 'cash' ? 'Manque d’ici la paie' : 'Déficit du cycle') : b.remainingToday >= 0 ? 'Reste aujourd’hui' : 'Dépassé aujourd’hui';
  const heroValue = over ? over.deficit : Math.abs(b.remainingToday);
  const p = b.projection;

  return (
    <Screen title="Aujourd’hui" kicker={formatDay(today)} mood="today" right={<HeaderActions />}>
      <Reveal index={0}>
        <Card level="raised" glow={b.status === 'good'} tone={b.status === 'bad' ? 'danger' : 'neutral'} className="p-5" onClick={() => setExplain(true)} label="Comment le budget du jour est calculé">
          <Ring value={b.usedPercent / 100} tone={status.tone} size={232} label={`${status.label} : ${b.usedPercent} % du budget du jour utilisé`}>
            <span className="t-label text-muted">{heroLabel}</span>
            <span className={`num mt-1 font-display text-[40px] font-bold leading-[46px] tracking-[-1.2px] ${over || b.remainingToday < 0 ? 'text-danger' : ''}`}>{formatCents(heroValue)}</span>
            <span className="mt-2">
              <Badge tone={status.tone} icon={status.icon}>
                {over ? 'Enveloppe dépassée' : status.label}
              </Badge>
            </span>
          </Ring>
          {over ? (
            <p className="t-body mt-4 text-center text-secondary">
              Pour ne pas l’aggraver : <strong className="text-ink">{formatCents(over.maxPerDay)} par jour</strong> d’ici le {formatShort(b.cycle.end)}.
              {b.spentToday > 0 && <> Aujourd’hui : {formatCents(b.spentToday)}.</>}
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3 text-center">
              <div>
                <p className="t-label text-muted">Budget du jour</p>
                <Money cents={b.dailyBudget} className="text-[18px]" />
              </div>
              <div>
                <p className="t-label text-muted">Dépensé</p>
                <Money cents={b.spentToday} className="text-[18px]" />
              </div>
            </div>
          )}
          {b.limitedBy === 'cash' && !over && <p className="t-caption mt-3 text-center text-warning">Plafonné par l’argent réellement libre sur tes comptes</p>}
          <p className="t-caption mt-3 flex items-center justify-center gap-1 text-muted">
            <Icon name="info" size={14} />
            {over ? 'Pourquoi ? Touche pour voir le détail' : 'Comment c’est calculé'}
          </p>
        </Card>
      </Reveal>

      <Reveal index={1} className="mt-3 grid grid-cols-3 gap-2">
        <StatTile label="Reste du cycle" value={formatCents(b.remainingCycle, { short: true })} tone={b.remainingCycle < 0 ? 'danger' : undefined} to="/budget" />
        <StatTile label="Jours restants" value={b.daysLeft} />
        <StatTile label="Demain" value={formatCents(b.nextDailyBudget, { short: true })} hint="par jour" />
      </Reveal>

      {b.daysElapsed > 0 && (
        <Reveal index={2} className="mt-3">
          <Card className="flex items-center gap-3">
            <Icon name={p.projectedEnd >= 0 ? 'trend-up' : 'trend-down'} className={p.projectedEnd >= 0 ? 'text-success' : 'text-danger'} />
            <span className="min-w-0 flex-1">
              <span className="t-body block">
                À ce rythme, fin de cycle à <strong className={`font-semibold ${p.projectedEnd >= 0 ? 'text-success' : 'text-danger'}`}>{formatCents(p.projectedEnd, { sign: true })}</strong>
              </span>
              <span className="t-small block text-secondary">
                {formatCents(p.pace)} par jour en moyenne · {p.gap >= 0 ? `${formatCents(p.gap)} d’avance` : `${formatCents(-p.gap)} de retard`} sur la trajectoire
              </span>
            </span>
          </Card>
        </Reveal>
      )}

      {(toClassify > 0 || serious.length > 0 || b.unallocated > 0 || b.cycle.earlyBy > 0) && (
        <Reveal index={3} className="mt-3 space-y-2">
          {b.unallocated > 0 && (
            <Card tone="accent" className="flex items-center gap-3" onClick={() => setExceptional(true)}>
              <Icon name="sparkles" className="text-accent" />
              <span className="t-body min-w-0 flex-1">
                Revenu exceptionnel : <strong className="font-semibold">{formatCents(b.unallocated)}</strong> à affecter
              </span>
              <Icon name="chevron-forward" size={17} className="text-muted" />
            </Card>
          )}
          {b.cycle.earlyBy > 0 && (
            <Card className="flex items-center gap-3">
              <Icon name="calendar" className="text-accent" />
              <span className="t-small min-w-0 flex-1 text-secondary">
                Paie arrivée {b.cycle.earlyBy} jour{b.cycle.earlyBy > 1 ? 's' : ''} en avance : nouveau cycle depuis le {formatShort(b.cycle.start)}.
              </span>
            </Card>
          )}
          {toClassify > 0 && (
            <Card to="/a-classer" tone="warning" className="flex items-center gap-3">
              <Icon name="tag" className="text-warning" />
              <span className="t-body min-w-0 flex-1">
                <strong className="font-semibold">{toClassify}</strong> opération{toClassify > 1 ? 's' : ''} à classer
              </span>
              <Icon name="chevron-forward" size={17} className="text-muted" />
            </Card>
          )}
          {serious.length > 0 && (
            <Card to="/alertes" tone="danger" className="flex items-center gap-3">
              <Icon name="warning" className="text-danger" />
              <span className="t-body min-w-0 flex-1 truncate">
                <strong className="font-semibold">{serious.length}</strong> alerte{serious.length > 1 ? 's' : ''} · {serious[0]?.title}
              </span>
              <Icon name="chevron-forward" size={17} className="text-muted" />
            </Card>
          )}
        </Reveal>
      )}

      <Reveal index={4}>
        <SectionTitle action={<span className="t-caption text-muted">{formatCycle(b.cycle)}</span>}>Aujourd’hui</SectionTitle>
        {todayTxs.length === 0 ? (
          <Card>
            <p className="t-body text-secondary">Aucune dépense aujourd’hui.</p>
          </Card>
        ) : (
          <Group>
            {todayTxs.map((t) => (
              <TxRow key={t.id} tx={t} category={t.categoryId ? cats.get(t.categoryId) : undefined} account={accMap.get(t.accountId)} onClick={() => setEditing(t)} showDate={false} />
            ))}
          </Group>
        )}
        {todayTxs.some((t) => !isVariable(t, cats)) && <p className="t-caption mt-2 px-1 text-muted">Les transferts, l’épargne et les charges fixes ne comptent pas dans le budget du jour.</p>}
      </Reveal>

      <p className="t-caption mt-6 text-center text-muted">
        Enveloppe vie courante <Money cents={b.envelope.total} compact className="text-secondary" /> · dépensé <Money cents={b.spentBefore + b.spentToday} compact className="text-secondary" /> · synchro {relativeTime(lastSync)}
      </p>
      <BudgetExplainer open={explain && !editing} onClose={() => setExplain(false)} b={b} txs={txs} cats={cats} accounts={accMap} onEdit={setEditing} />
      <ExceptionalSheet open={exceptional} onClose={() => setExceptional(false)} items={b.exceptional} accounts={accMap} />
      <TxEditor tx={editing} categories={categories} onClose={() => setEditing(null)} />
    </Screen>
  );
}
