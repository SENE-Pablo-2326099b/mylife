import { useEffect, useState } from 'react';
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
import { OVERRUN_LABEL, overrunKind } from '../domain/budgetEngine';
import { useAlerts } from '../domain/useAlerts';
import { useAccounts, useCategories, useCategoryMap } from '../hooks';
import { formatCycle, formatDay, formatShort, todayISO } from '../lib/dates';
import { formatCents } from '../ui/money';
import { relativeTime } from '../ui/relative';
import { runSync, useSyncState } from '../sync/store';
import { Ring } from '../ui/charts';
import { Icon } from '../ui/icons';
import { Badge, Button, Card, EmptyState, Group, Money, Reveal, Rolling, Row, SectionTitle, StatTile } from '../ui/index';
import { Screen } from '../ui/Screen';
import { Tilt } from '../ui/Tilt';
import { Pending } from '../ui/extras';
import { setAmbient } from '../ui/mood';
import { setGlance } from '../ui/glance';
import { writeCopilotCard } from '../vendor/lumen';
import { BackupReminder } from '../ui/BackupReminder';
import { downloadBackup } from '../domain/backupDownload';
import { useTabActive } from '../ui/tabActive';
import { useBreakpoint } from '../ui/responsive';
import { useToClassifyCount } from '../domain/unclassified';
import { refreshEverything } from '../sync/refresh';

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
  const { state: b, txs: windowTxs, loading } = useBudget(today);
  const txs = windowTxs.filter((t) => t.date >= b.cycle.start && t.date <= b.cycle.end);
  const total = useLiveQuery(() => db.transactions.count(), []);
  const toClassify = useToClassifyCount();
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
  // Le champ de lumière prend la couleur du budget du jour tant que cet écran est ouvert.
  const active = useTabActive();
  // Enveloppe dépassée mais couverte par l'argent libre : orange, jamais rouge (une seule règle : overrunKind).
  const kind = overrunKind(b);
  const realDeficit = kind === 'shortage' || kind === 'over';
  const ambientTone = total && active ? (realDeficit ? 'danger' : status.tone) : null;
  useEffect(() => {
    setAmbient(ambientTone);
    return () => setAmbient(null);
  }, [ambientTone]);

  // Aperçu pour l'accueil MyLife et les Espaces (sur l'appareil seulement), valable jusqu'à minuit.
  const ready = total !== undefined && !loading && total > 0;
  const glanceTitle = !ready
    ? null
    : b.overrun && kind
      ? kind === 'covered'
        ? `Au-delà de l’enveloppe · ${formatCents(b.overrun.covered ?? 0)} d’argent libre`
        : `${OVERRUN_LABEL[kind]} : ${formatCents(b.overrun.deficit)}`
      : b.remainingToday >= 0
        ? `${formatCents(b.remainingToday)} à dépenser aujourd’hui`
        : `${formatCents(-b.remainingToday)} de trop aujourd’hui`;
  const glanceTone = !ready ? undefined : realDeficit || (!b.overrun && b.remainingToday < 0) ? 'danger' : status.tone;
  useEffect(() => {
    if (!glanceTitle) return;
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    setGlance('finances', { title: glanceTitle, detail: `${status.label} · ${b.usedPercent} % du budget du jour`, tone: glanceTone, until: midnight.getTime() });
  }, [glanceTitle, glanceTone, status.label, b.usedPercent]);

  // Fiche de contexte pour Copilot (accueil MyLife) : sur l'appareil seulement, en euros.
  useEffect(() => {
    if (!ready) return;
    const eur = (c: number) => Math.round(c) / 100;
    writeCopilotCard('finances', {
      day: today,
      remainingToday: eur(b.remainingToday),
      dailyBudget: eur(b.dailyBudget),
      nextDailyBudget: eur(b.nextDailyBudget),
      status: b.status,
      cycle: { start: b.cycle.start, end: b.cycle.end, daysLeft: b.daysLeft, daysElapsed: b.daysElapsed },
      envelope: eur(b.envelope.total),
      spentThisCycle: eur(b.spentBefore + b.spentToday),
      remainingCycle: eur(b.remainingCycle),
      projectedEndOfCycle: eur(b.projection.projectedEnd),
      plannedSavings: eur(b.envelope.savingsDetail.planned),
      savedThisCycle: eur(b.envelope.savingsDetail.done),
      savingsLeftThisCycle: eur(b.envelope.savingsDetail.left),
      overrun: b.overrun ? eur(b.overrun.deficit) : null,
      overrunCoveredByFreeMoney: b.overrun?.covered != null,
      realFree: b.realFree === null ? null : eur(b.realFree),
      upcoming: b.upcoming.slice(0, 6).map((u) => ({ date: u.date, label: u.label, amount: eur(u.amount) })),
    });
  }, [ready, b, today]);

  // Données pas encore lues : ni faux chiffres ni faux « bienvenue ».
  if (total === undefined || loading) {
    return (
      <Screen title="Aujourd’hui" kicker={formatDay(today)} mood="today" right={<HeaderActions />}>
        <Pending />
      </Screen>
    );
  }

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

  // Enveloppe dépassée : on montre le dépassement, jamais un budget du jour négatif. Si l'argent réellement libre le
  // couvre, ce n'est pas un déficit : l'enveloppe reste le repère, sans rouge.
  const over = b.overrun;
  const covered = over?.covered ?? null;
  const heroLabel = kind ? OVERRUN_LABEL[kind] : b.remainingToday >= 0 ? 'Reste aujourd’hui' : 'Dépassé aujourd’hui';
  const heroValue = over ? over.deficit : Math.abs(b.remainingToday);
  const p = b.projection;

  return (
    <Screen title="Aujourd’hui" kicker={formatDay(today)} mood="today" right={<HeaderActions />} onRefresh={refreshEverything}>
      {/* Grand écran : l'anneau du jour à gauche, les chiffres du cycle empilés à droite. */}
      <Reveal index={0} className="mb-3 empty:hidden">
        <BackupReminder app="finances" hasData onBackup={async () => void (await downloadBackup())} />
      </Reveal>
      <div className={wide ? 'grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-stretch gap-3' : ''}>
      <Reveal index={0} className={wide ? 'flex [&>*]:flex-1' : ''}>
        <Tilt className="h-full">
        <Card level="raised" glow={b.status === 'good'} tone={b.status === 'bad' ? 'danger' : 'neutral'} className="p-5" onClick={() => setExplain(true)} label="Comment le budget du jour est calculé">
          <Ring value={b.usedPercent / 100} tone={status.tone} size={232} label={`${status.label} : ${b.usedPercent} % du budget du jour utilisé`}>
            <span className="t-label text-muted">{heroLabel}</span>
            <span className={`num mt-1 font-display text-[40px] font-bold leading-[46px] tracking-[-1.2px] ${realDeficit || (!over && b.remainingToday < 0) ? 'text-danger' : ''}`}>
              <Rolling mount text={formatCents(heroValue)} />
            </span>
            <span className="mt-2">
              <Badge tone={status.tone} icon={status.icon}>
                {kind ? OVERRUN_LABEL[kind] : status.label}
              </Badge>
            </span>
          </Ring>
          {over && covered !== null ? (
            <p className="t-body mt-4 text-center text-secondary">
              Il te reste <strong className="text-ink">{formatCents(covered)} d’argent libre</strong> d’ici le {formatShort(b.cycle.end)}, charges et épargne mises de côté.
              {b.spentToday > 0 && <> Aujourd’hui : {formatCents(b.spentToday)}.</>}
            </p>
          ) : over ? (
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
          {b.limitedBy === 'cash' && !over && <p className="t-caption mt-3 text-center text-warning">Plafonné par l’argent libre sur tes comptes</p>}
          <p className="t-caption mt-3 flex items-center justify-center gap-1 text-muted">
            <Icon name="info" size={14} />
            {over ? 'Pourquoi ? Touche pour voir le détail' : 'Comment c’est calculé'}
          </p>
        </Card>
        </Tilt>
      </Reveal>

      <div className={wide ? 'flex flex-col gap-3' : ''}>
      <Reveal index={1} className={wide ? 'grid grid-cols-1 gap-3 min-[1180px]:grid-cols-3' : 'mt-3 grid grid-cols-3 gap-2'}>
        <StatTile label="Reste du cycle" value={formatCents(b.remainingCycle, { short: true })} tone={b.remainingCycle < 0 ? (realDeficit ? 'danger' : 'warning') : undefined} to="/budget" />
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
            <Icon name={p.projectedEnd >= 0 ? 'trend-up' : 'trend-down'} className={p.projectedEnd >= 0 ? 'text-success' : 'text-warning'} />
            <span className="min-w-0 flex-1">
              <span className="t-body block">
                À ce rythme, fin de cycle à <strong className={`font-semibold ${p.projectedEnd >= 0 ? 'text-success' : 'text-warning'}`}>{formatCents(p.projectedEnd, { sign: true })}</strong>
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
