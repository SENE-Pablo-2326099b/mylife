import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BudgetExplainer } from '../components/BudgetExplainer';
import { TxEditor } from '../components/TxEditor';
import { TxRow } from '../components/TxRow';
import { db, getMeta } from '../db/db';
import type { Transaction } from '../db/types';
import { computeDailyBudget, isVariable, type Status } from '../domain/budget';
import { useAlerts } from '../domain/useAlerts';
import { useAccounts, useCategories, useCategoryMap, useSettings } from '../hooks';
import { cycleFor, formatCycle, formatDay, todayISO } from '../lib/dates';
import { formatCents } from '../lib/money';
import { relativeTime } from '../lib/relative';
import { useSyncState } from '../sync/store';
import { Ring } from '../ui/charts';
import { Icon } from '../ui/icons';
import { Badge, Button, Card, EmptyState, Group, IconButton, Money, Reveal, SectionTitle, StatTile } from '../ui/index';
import { Screen } from '../ui/Screen';

const NO_TX: Transaction[] = [];

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
  const settings = useSettings();
  const categories = useCategories();
  const cats = useCategoryMap();
  const accounts = useAccounts();
  const today = todayISO();
  const cycle = cycleFor(today, settings.payday);
  const txs = useLiveQuery(() => db.transactions.where('date').between(cycle.start, cycle.end, true, true).toArray(), [cycle.start, cycle.end]) ?? NO_TX;
  const total = useLiveQuery(() => db.transactions.count(), []);
  const toClassify = useLiveQuery(() => db.transactions.filter((t) => t.categoryId === null).count(), []) ?? 0;
  const lastSync = useLiveQuery(() => getMeta<number>('lastSyncAt'), []);
  const alerts = useAlerts();
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [explain, setExplain] = useState(false);

  const b = useMemo(() => computeDailyBudget(txs, cats, settings, today), [txs, cats, settings, today]);
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

  const remaining = b.remainingToday;
  // Enveloppe déjà dépassée avant aujourd'hui : c'est le cycle qui est en dépassement, pas la journée.
  const cycleOver = b.envelope - b.spentBefore < 0;
  const heroLabel = cycleOver ? 'Cycle dépassé de' : remaining >= 0 ? 'Reste aujourd’hui' : 'Dépassement';
  const heroValue = cycleOver ? -b.remainingCycle : Math.abs(remaining);

  return (
    <Screen title="Aujourd’hui" kicker={formatDay(today)} mood="today" right={<HeaderActions />}>
      <Reveal index={0}>
        <Card level="raised" glow={b.status === 'good'} tone={b.status === 'bad' ? 'danger' : 'neutral'} className="p-5" onClick={() => setExplain(true)} label="Comment le budget du jour est calculé">
          <Ring value={b.usedPercent / 100} tone={status.tone} size={232} label={`${status.label} : ${b.usedPercent} % du budget du jour utilisé`}>
            <span className="t-label text-muted">{heroLabel}</span>
            <span className={`num mt-1 font-display text-[40px] font-bold leading-[46px] tracking-[-1.2px] ${remaining < 0 ? 'text-danger' : ''}`}>{formatCents(heroValue)}</span>
            <span className="mt-2">
              <Badge tone={status.tone} icon={status.icon}>
                {status.label}
              </Badge>
            </span>
          </Ring>
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
          <p className="t-caption mt-3 flex items-center justify-center gap-1 text-muted">
            <Icon name="info" size={14} />
            {cycleOver ? 'Pourquoi ? Touche pour voir le détail' : 'Comment c’est calculé'}
          </p>
        </Card>
      </Reveal>

      <Reveal index={1} className="mt-3 grid grid-cols-3 gap-2">
        <StatTile label="Reste du cycle" value={formatCents(b.remainingCycle, { short: true })} tone={b.remainingCycle < 0 ? 'danger' : undefined} to="/budget" />
        <StatTile label="Jours restants" value={b.daysLeft} />
        <StatTile label="Demain" value={formatCents(b.nextDailyBudget, { short: true })} hint="par jour" />
      </Reveal>

      {(toClassify > 0 || serious.length > 0) && (
        <Reveal index={2} className="mt-3 space-y-2">
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

      <Reveal index={3}>
        <SectionTitle action={<span className="t-caption text-muted">{formatCycle(cycle)}</span>}>Aujourd’hui</SectionTitle>
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
        Enveloppe vie courante <Money cents={b.envelope} compact className="text-secondary" /> · dépensé <Money cents={b.spentBefore + b.spentToday} compact className="text-secondary" /> · synchro {relativeTime(lastSync)}
      </p>
      <BudgetExplainer open={explain && !editing} onClose={() => setExplain(false)} b={b} settings={settings} txs={txs} cats={cats} accounts={accMap} onEdit={setEditing} />
      <TxEditor tx={editing} categories={categories} onClose={() => setEditing(null)} />
    </Screen>
  );
}
