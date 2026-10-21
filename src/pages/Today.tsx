import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BudgetExplainer } from '../components/BudgetExplainer';
import { HeaderActions } from '../components/HeaderActions';
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
import { runSync, useSyncState } from '../sync/store';
import { Ring } from '../ui/charts';
import { Icon } from '../ui/icons';
import { Badge, Button, Card, EmptyState, Group, Money, Reveal, Row, SectionTitle, StatTile } from '../ui/index';
import { Screen } from '../ui/Screen';
import { useBreakpoint } from '../ui/responsive';

const STATUS: Record<Status, { label: string; tone: 'success' | 'warning' | 'danger'; icon: 'check-circle' | 'warning' }> = {
  good: { label: 'Dans le budget', tone: 'success', icon: 'check-circle' },
  warn: { label: 'Presque atteint', tone: 'warning', icon: 'warning' },
  bad: { label: 'Dépassé', tone: 'danger', icon: 'warning' },
};

export { HeaderActions };

export default function TodayPage() {
  const wide = useBreakpoint() === 'expanded';
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
  const sync = useSyncState();
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
      {/* Grand écran : l'anneau du jour à gauche, les chiffres du cycle empilés à droite. */}
      <div className={wide ? 'grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-stretch gap-3' : ''}>
      <Reveal index={0} className={wide ? 'flex [&>*]:flex-1' : ''}>
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

      <div className={wide ? 'flex flex-col gap-3' : ''}>
      <Reveal index={1} className={wide ? 'grid grid-cols-1 gap-3 min-[1180px]:grid-cols-3' : 'mt-3 grid grid-cols-3 gap-2'}>
        <StatTile label="Reste du cycle" value={formatCents(b.remainingCycle, { short: true })} tone={b.remainingCycle < 0 ? 'danger' : undefined} to="/budget" />
        <StatTile label="Jours restants" value={b.daysLeft} />
        <StatTile label="Demain" value={formatCents(b.nextDailyBudget, { short: true })} hint="par jour" />
      </Reveal>

      {b.cycle.earlyBy > 0 && (
        <p className="t-small mt-2 flex items-center gap-1.5 px-1 text-secondary">
          <Icon name="calendar" size={15} className="text-accent" />
          Paie arrivée {b.cycle.earlyBy} jour{b.cycle.earlyBy > 1 ? 's' : ''} en avance : nouveau cycle depuis le {formatShort(b.cycle.start)}.
        </p>
      )}

      {b.daysElapsed > 0 && (
        <Reveal index={2} className={wide ? '' : 'mt-3'}>
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
      </div>
      </div>

      {(toClassify > 0 || serious.length > 0 || b.unallocated > 0) && (
        <Reveal index={3}>
          {/* Un seul bloc « à faire » : ce qui attend une action, du plus utile au plus urgent à traiter. */}
          <SectionTitle action={<Badge tone="accent">{[toClassify > 0, serious.length > 0, b.unallocated > 0].filter(Boolean).length}</Badge>}>À faire</SectionTitle>
          <Group>
            {b.unallocated > 0 && <Row icon="sparkles" iconTone="accent" title={<>Revenu exceptionnel : {formatCents(b.unallocated)}</>} subtitle="À affecter : budget, épargne ou objectif" onClick={() => setExceptional(true)} />}
            {toClassify > 0 && <Row icon="tag" iconTone="warning" title={`${toClassify} opération${toClassify > 1 ? 's' : ''} à classer`} subtitle="Pour un budget juste" to="/a-classer" />}
            {serious.length > 0 && <Row icon="warning" iconTone="danger" title={`${serious.length} alerte${serious.length > 1 ? 's' : ''}`} subtitle={serious[0]?.title} to="/alertes" />}
          </Group>
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
        Enveloppe vie courante <Money cents={b.envelope.total} compact className="text-secondary" /> · dépensé <Money cents={b.spentBefore + b.spentToday} compact className="text-secondary" />
      </p>
      {/* Les achats du jour n'arrivent qu'après une synchro : l'heure de la dernière et de quoi relancer. */}
      <div className="mt-1 flex items-center justify-center gap-1">
        <span className="t-caption text-muted">Banques synchronisées {relativeTime(lastSync)}</span>
        <Button variant="ghost" size="sm" icon="sync" disabled={sync.syncing} onClick={() => void runSync()}>
          {sync.syncing ? 'En cours…' : 'Actualiser'}
        </Button>
      </div>
      <BudgetExplainer open={explain && !editing} onClose={() => setExplain(false)} b={b} txs={txs} cats={cats} accounts={accMap} onEdit={setEditing} />
      <ExceptionalSheet open={exceptional} onClose={() => setExceptional(false)} items={b.exceptional} accounts={accMap} />
      <TxEditor tx={editing} categories={categories} onClose={() => setEditing(null)} />
    </Screen>
  );
}
