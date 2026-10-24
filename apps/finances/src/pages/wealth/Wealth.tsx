import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLatest } from '../../hooks';
import { db } from '../../db/db';
import { changeWithUndo } from '../../db/undo';
import type { Goal, ManualAsset, Transaction } from '../../db/types';
import { computeFire } from '../../domain/fire';
import { useRecentTransactions } from '../../domain/recentTransactions';
import { ASSET_CLASS_LABEL, cashHistory, wealthHistory, type GoalProgress } from '../../domain/wealth';
import { deleteGoal, recordSnapshot } from '../../domain/wealthDb';
import { useWealth } from '../../domain/useWealth';
import { useCategoryMap, useSettings } from '../../hooks';
import { addDays, formatLong, formatShort, todayISO } from '../../lib/dates';
import { formatCents } from '../../ui/money';
import { AllocationBar, LineChart, Ring } from '../../ui/charts';
import { OrbFlash } from '../../ui/extras';
import { Badge, Button, Card, EmptyState, Group, Icon, IconBubble, Money, ProgressBar, Reveal, Row, SectionTitle, Segmented, Sheet, StatTile, Tap, toast, useTheme } from '../../ui/index';
import { Screen } from '../../ui/Screen';
import { Tilt } from '../../ui/Tilt';
import { Pending } from '../../ui/extras';
import { seriesColors } from '../../ui/themes';
import { HeaderActions } from '../../components/HeaderActions';
import { AssetForm, GoalForm, GoalMoveForm, PortfolioForm } from './forms';
import { refreshEverything } from '../../sync/refresh';
import { plannedSavings } from '../../domain/defaults';

const NO_TX: Transaction[] = [];
const RANGES = [
  { value: '90', label: '3 mois' },
  { value: '180', label: '6 mois' },
  { value: '365', label: '1 an' },
] as const;

function GoalCard({ gp, onOpen }: { gp: GoalProgress; onOpen: () => void }) {
  const g = gp.goal;
  const tone = gp.achieved ? 'gold' : gp.status === 'behind' ? 'warning' : 'accent';
  const sub = gp.achieved
    ? 'Objectif atteint'
    : gp.status === 'behind'
      ? `Il faudrait ${formatCents(gp.requiredMonthly ?? 0, { compact: true })}/mois pour tenir l’échéance`
      : gp.projectedDate
        ? `Atteint vers ${formatLong(gp.projectedDate).replace(/^\d+ /, '')} au rythme prévu`
        : 'Ajoute un versement mensuel pour avancer';
  return (
    <Card onClick={onOpen} tone={gp.achieved ? 'gold' : 'neutral'} glow={false} className="space-y-2">
      <div className="flex items-center gap-3">
        <IconBubble emoji={g.emoji} tone={gp.achieved ? 'gold' : undefined} />
        <div className="min-w-0 flex-1">
          <p className="t-body-strong truncate">{g.name}</p>
          <p className={`t-caption truncate ${gp.achieved ? 'text-gold' : gp.status === 'behind' ? 'text-warning' : 'text-muted'}`}>{sub}</p>
        </div>
        <span className="text-right">
          <Money cents={gp.saved} compact className={gp.achieved ? 'text-gold' : ''} />
          <span className="t-caption block text-muted">/ {formatCents(g.target, { compact: true })}</span>
        </span>
      </div>
      <ProgressBar value={gp.saved} max={g.target} tone={tone} height={6} label={`${Math.round(gp.ratio * 100)} % de ${g.name}`} />
    </Card>
  );
}

const VIEWS = [
  { value: 'apercu', label: 'Aperçu' },
  { value: 'placements', label: 'Placements' },
  { value: 'objectifs', label: 'Objectifs' },
  { value: 'biens', label: 'Biens' },
] as const;
type View = (typeof VIEWS)[number]['value'];

function FireCard({ fire }: { fire: { target: number; current: number; months: number | null } }) {
  const ratio = fire.target > 0 ? fire.current / fire.target : 0;
  const year = fire.months === null ? null : new Date().getFullYear() + Math.ceil(fire.months / 12);
  const status = fire.months === 0 ? 'Atteinte' : year === null ? 'Hors de portée au rythme actuel' : `En ${year} au rythme actuel`;
  return (
    <Card to="/independance" className="flex items-center gap-4">
      <Ring value={ratio} size={72} stroke={7} tone="gold" label={`${Math.round(ratio * 100)} % de l’objectif`}>
        <span className="num whitespace-nowrap font-display text-[15px] font-semibold">{Math.min(100, Math.round(ratio * 100))} %</span>
      </Ring>
      <span className="min-w-0 flex-1">
        <span className="t-body-strong block">{status}</span>
        <span className="t-small block text-secondary">Capital nécessaire {formatCents(fire.target, { compact: true })} · simulateur</span>
      </span>
      <Icon name="chevron-forward" size={17} className="text-muted" />
    </Card>
  );
}

export default function WealthPage() {
  const w = useWealth();
  const t = useTheme();
  const navigate = useNavigate();
  const settings = useSettings();
  const cats = useCategoryMap();
  const today = todayISO();
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>('180');
  const from = addDays(today, -Number(range) + 1);
  const txs = useRecentTransactions() ?? NO_TX;
  // Onglet gardé dans l'adresse : le retour arrière y ramène.
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.find((v) => v.value === params.get('vue'))?.value ?? 'apercu') as View;
  const setView = (v: View) => setParams(v === 'apercu' ? {} : { vue: v }, { replace: true });
  // « + » de l'en-tête : …&ajouter=1 ouvre directement le formulaire de l'onglet.
  const adding = params.get('ajouter') === '1';
  useEffect(() => {
    if (!adding) return;
    if (view === 'placements') setPortfolioSheet(true);
    else if (view === 'objectifs') setGoalEdit('new');
    else if (view === 'biens') setAssetEdit('new');
    setParams(view === 'apercu' ? {} : { vue: view }, { replace: true });
  }, [adding, view, setParams]);

  const [portfolioSheet, setPortfolioSheet] = useState(false);
  const [goalEdit, setGoalEdit] = useState<Goal | 'new' | null>(null);
  const [goalOpen, setGoalOpen] = useState<string | null>(null);
  const [moveFor, setMoveFor] = useState<Goal | null>(null);
  const [assetEdit, setAssetEdit] = useState<ManualAsset | 'new' | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const goalShown = useLatest(goalEdit);
  const moveShown = useLatest(moveFor);
  const assetShown = useLatest(assetEdit);
  const openGoal = w.goalsProgress.find((g) => g.goal.id === goalOpen) ?? null;
  const openShown = useLatest(openGoal);

  const history = useMemo(() => {
    const cash = cashHistory(w.accounts, txs, from, today);
    return wealthHistory({ from, to: today, snapshots: w.snapshots, cash, ops: w.ops, worth: w.worth });
  }, [w.accounts, w.snapshots, w.ops, w.worth, txs, from, today]);

  const first = history[0]?.total ?? w.worth.total;
  const delta = w.worth.total - first;
  const allocation = useMemo(() => {
    const colors = seriesColors(t);
    const items: { label: string; value: number; color: string }[] = [];
    if (w.worth.cash > 0) items.push({ label: 'Liquidités', value: w.worth.cash, color: colors[0] as string });
    const byClass = new Map<string, number>();
    for (const s of w.summaries) for (const p of s.positions) byClass.set(p.holding.assetClass, (byClass.get(p.holding.assetClass) ?? 0) + (p.value ?? p.invested));
    [...byClass.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v], i) => items.push({ label: ASSET_CLASS_LABEL[k as keyof typeof ASSET_CLASS_LABEL], value: v, color: colors[(i + 1) % colors.length] as string }));
    if (w.worth.other > 0) items.push({ label: 'Autres actifs', value: w.worth.other, color: colors[(items.length + 1) % colors.length] as string });
    return items;
  }, [w.worth, w.summaries, t]);

  // Même calcul que l'écran Indépendance financière (exclusions, impôts, frais) : même date affichée.
  const fire = useMemo(() => {
    const monthly = plannedSavings(settings);
    const r = computeFire({ summaries: w.summaries, savingsAccounts: w.accounts.filter((a) => a.kind === 'savings' && !a.hidden), txs, cats, settings, today, monthly });
    return { target: r.target, current: r.current, months: r.months };
  }, [txs, cats, settings, today, w.summaries, w.accounts]);

  const empty = w.loaded && w.accounts.length === 0 && w.portfolios.length === 0 && w.assets.length === 0 && w.goals.length === 0;
  const totalInvest = w.summaries.reduce((s, p) => s + p.value, 0);
  const totalGain = w.summaries.reduce((s, p) => s + p.gain, 0);
  const investedSum = w.summaries.reduce((s, p) => s + p.invested, 0);

  const deleteAsset = async (a: ManualAsset) => {
    setAssetEdit(null);
    await changeWithUndo(`${a.name} supprimé`, async () => ({ manualAssets: [a] }), async () => {
      await db.manualAssets.delete(a.id);
      await recordSnapshot();
    });
  };

  if (!w.loaded) {
    return (
      <Screen title="Patrimoine" kicker="Tout ce que tu possèdes" mood="wealth" right={<HeaderActions />}>
        <Pending />
      </Screen>
    );
  }

  return (
    <Screen title="Patrimoine" kicker="Tout ce que tu possèdes" mood="wealth" right={<HeaderActions />} onRefresh={refreshEverything}>
      {empty ? (
        <Reveal>
          <Card level="raised" glow>
            <EmptyState
              icon="diamond"
              title="Ton patrimoine, au même endroit"
              body="Comptes bancaires synchronisés, placements (Trade Republic, Bitstack, PEA, assurance vie…), objectifs d’épargne, biens et dettes."
              action={
                <>
                  <Button icon="add" onClick={() => setPortfolioSheet(true)}>
                    Ajouter un placement
                  </Button>
                  <Button variant="secondary" icon="upload" to="/patrimoine/import">
                    Importer un relevé Trade Republic
                  </Button>
                  <Button variant="ghost" onClick={() => setGoalEdit('new')}>
                    Créer un objectif
                  </Button>
                </>
              }
            />
          </Card>
        </Reveal>
      ) : (
        <Reveal index={0} className="mb-3">
          <Segmented options={VIEWS} value={view} onChange={setView} label="Partie du patrimoine" />
        </Reveal>
      )}

      {!empty && view === 'apercu' && (
        <>
          <Reveal index={0}>
            <Tilt>
            <Card level="raised" glow>
              <p className="t-label text-muted">Patrimoine net</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
                <Money roll cents={w.worth.total} className="text-[40px] leading-[46px] tracking-[-1.2px]" />
                {history.length > 1 && (
                  <span className={`t-body-strong ${delta >= 0 ? 'text-success' : 'text-danger'}`}>
                    {formatCents(delta, { sign: true, compact: true })} <span className="t-small text-muted">en {RANGES.find((r) => r.value === range)?.label}</span>
                  </span>
                )}
              </div>
              {history.length > 1 && (
                <div className="mt-3">
                  <LineChart
                    series={[{ id: 'w', label: 'Patrimoine net', values: history.map((h) => h.total), look: 'primary' }]}
                    xLabels={history.map((h) => formatShort(h.date))}
                    formatY={(v) => formatCents(v, { short: true })}
                    zero={false}
                    height={170}
                    ariaLabel={`Patrimoine net : ${formatCents(first)} il y a ${range} jours, ${formatCents(w.worth.total)} aujourd’hui.`}
                  />
                  <div className="mt-3">
                    <Segmented options={RANGES} value={range} onChange={setRange} label="Période" />
                  </div>
                  {history.some((h) => h.estimated) && <p className="t-caption mt-2 text-muted">Avant tes premières ouvertures de l’app, la courbe est estimée (soldes reconstitués + capital investi).</p>}
                </div>
              )}
            </Card>
            </Tilt>
          </Reveal>

          <Reveal index={1} className="mt-3 grid grid-cols-2 gap-2">
            <StatTile label="Liquidités" value={formatCents(w.worth.cash, { compact: true })} to="/synchro" />
            <StatTile
              label="Placements"
              value={formatCents(totalInvest, { compact: true })}
              hint={investedSum > 0 ? <span className={totalGain >= 0 ? 'text-success' : 'text-danger'}>{formatCents(totalGain, { sign: true, compact: true })} ({((totalGain * 100) / investedSum).toFixed(1).replace('.', ',')} %)</span> : undefined}
            />
            {w.worth.other > 0 && <StatTile label="Autres actifs" value={formatCents(w.worth.other, { compact: true })} />}
            {w.worth.debts > 0 && <StatTile label="Dettes" value={formatCents(-w.worth.debts, { compact: true })} tone="danger" />}
          </Reveal>

          {allocation.length > 1 && (
            <Reveal index={2}>
              <SectionTitle>Répartition</SectionTitle>
              <Card>
                <AllocationBar items={allocation} format={(v) => formatCents(v, { compact: true })} label="Répartition du patrimoine" />
              </Card>
            </Reveal>
          )}
        </>
      )}

      {view === 'apercu' && !empty && (
        <Reveal index={3}>
          <SectionTitle>Indépendance financière</SectionTitle>
          <FireCard fire={fire} />
        </Reveal>
      )}

      {view === 'apercu' && w.accounts.length > 0 && (
        <Reveal index={4}>
          <SectionTitle action={<Button variant="ghost" size="sm" to="/synchro">Banques</Button>}>Comptes</SectionTitle>
          <Group>
            {w.accounts
              .filter((a) => !a.hidden)
              .map((a) => (
                <Row key={a.id} icon={a.kind === 'savings' ? 'leaf' : 'card'} title={a.nickname ?? a.name} subtitle={`${a.bank}${a.kind === 'savings' ? ' · épargne' : ''}`} right={a.balance !== null ? <Money cents={a.balance} /> : <Badge>solde inconnu</Badge>} />
              ))}
          </Group>
        </Reveal>
      )}

      {view === 'placements' && (
      <Reveal index={1}>
        <SectionTitle action={<Button variant="ghost" size="sm" icon="add" onClick={() => setPortfolioSheet(true)}>Ajouter</Button>}>Placements</SectionTitle>
        {w.summaries.length === 0 ? (
          <p className="t-small px-0.5 text-muted">Trade Republic, Bitstack, PEA, assurance vie, livrets… Les cours se mettent à jour tout seuls.</p>
        ) : (
          <Group>
            {w.summaries.map((s) => (
              <Row
                key={s.portfolio.id}
                icon={s.portfolio.kind === 'crypto' ? 'sparkles' : s.portfolio.kind === 'savings' ? 'leaf' : 'trend-up'}
                iconTone="accent"
                title={s.portfolio.name}
                subtitle={`${s.portfolio.provider || 'Placement'} · ${s.portfolio.wrapper} · ${s.positions.length} ligne${s.positions.length > 1 ? 's' : ''}`}
                to={`/patrimoine/placement/${s.portfolio.id}`}
                right={
                  <span className="text-right">
                    <Money cents={s.value} compact />
                    {s.gainPercent !== null && (
                      <span className={`t-caption block ${s.gain >= 0 ? 'text-success' : 'text-danger'}`}>
                        {s.gain >= 0 ? '+' : ''}
                        {String(s.gainPercent).replace('.', ',')} %
                      </span>
                    )}
                  </span>
                }
              />
            ))}
          </Group>
        )}
        <Card to="/patrimoine/import" className="mt-2 flex items-center gap-3">
          <IconBubble icon="upload" tone="accent" />
          <span className="min-w-0 flex-1">
            <span className="t-body-strong block">Importer un relevé Trade Republic</span>
            <span className="t-small block text-secondary">PDF : achats, plans d’épargne et dividendes rangés tout seuls</span>
          </span>
          <Icon name="chevron-forward" size={17} className="text-muted" />
        </Card>
      </Reveal>
      )}

      {view === 'objectifs' && (
      <Reveal index={1}>
        <SectionTitle action={<Button variant="ghost" size="sm" icon="add" onClick={() => setGoalEdit('new')}>Ajouter</Button>}>Objectifs</SectionTitle>
        {w.goalsProgress.length === 0 ? (
          <p className="t-small px-0.5 text-muted">Fonds d’urgence, voyage, permis, apport… Un montant, une date : l’app calcule le versement mensuel.</p>
        ) : (
          <div className="space-y-2">
            {w.goalsProgress.map((gp) => (
              <GoalCard key={gp.goal.id} gp={gp} onOpen={() => setGoalOpen(gp.goal.id)} />
            ))}
          </div>
        )}
      </Reveal>
      )}

      {view === 'biens' && (
      <Reveal index={1}>
        <SectionTitle action={<Button variant="ghost" size="sm" icon="add" onClick={() => setAssetEdit('new')}>Ajouter</Button>}>Biens et dettes</SectionTitle>
        {w.assets.length === 0 ? (
          <p className="t-small px-0.5 text-muted">Logement, véhicule, prêt étudiant… pour un patrimoine net complet.</p>
        ) : (
          <Group>
            {w.assets.map((a) => (
              <Row key={a.id} emoji={a.emoji} title={a.name} subtitle={a.kind === 'debt' ? 'Dette' : 'Bien'} onClick={() => setAssetEdit(a)} right={<Money cents={a.kind === 'debt' ? -a.value : a.value} tone={a.kind === 'debt' ? 'danger' : undefined} />} />
            ))}
          </Group>
        )}
      </Reveal>

      )}

      <Sheet open={portfolioSheet} onClose={() => setPortfolioSheet(false)} title="Nouveau placement">
        {portfolioSheet && (
          <Button variant="secondary" icon="upload" to="/patrimoine/import" className="mb-4 w-full" onClick={() => setPortfolioSheet(false)}>
            Trade Republic : importer le relevé PDF
          </Button>
        )}
        {portfolioSheet && (
          <PortfolioForm
            initial={null}
            onDone={(id) => {
              setPortfolioSheet(false);
              if (id) navigate(`/patrimoine/placement/${id}`);
            }}
          />
        )}
      </Sheet>

      <Sheet open={goalEdit !== null} onClose={() => setGoalEdit(null)} title={goalShown === 'new' ? 'Nouvel objectif' : 'Modifier l’objectif'}>
        {goalShown && <GoalForm key={goalShown === 'new' ? 'new' : goalShown.id} initial={goalShown === 'new' ? null : goalShown} accounts={w.accounts.filter((a) => !a.hidden)} portfolios={w.portfolios} onDone={() => setGoalEdit(null)} />}
      </Sheet>

      <Sheet open={openGoal !== null} onClose={() => setGoalOpen(null)} title={openShown ? `${openShown.goal.emoji} ${openShown.goal.name}` : ''}>
        {openShown && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Ring value={openShown.ratio} size={96} stroke={9} tone={openShown.achieved ? 'gold' : 'accent'} label={`${Math.round(openShown.ratio * 100)} %`}>
                <span className="num font-display text-[18px] font-semibold">{Math.round(openShown.ratio * 100)} %</span>
              </Ring>
              <div className="min-w-0 flex-1 space-y-0.5">
                <Money cents={openShown.saved} className={`block text-[24px] ${openShown.achieved ? 'text-gold' : ''}`} />
                <p className="t-small text-secondary">sur {formatCents(openShown.goal.target)} · reste {formatCents(openShown.remaining)}</p>
                {openShown.goal.deadline && <p className="t-small text-secondary">échéance {formatLong(openShown.goal.deadline)}</p>}
                {openShown.requiredMonthly !== null && !openShown.achieved && (
                  <p className={`t-small ${openShown.status === 'behind' ? 'text-warning' : 'text-success'}`}>
                    {formatCents(openShown.requiredMonthly)}/mois nécessaires · prévu {formatCents(openShown.goal.monthly)}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {openShown.goal.linkKind === 'manual' && (
                <Button icon="add" onClick={() => setMoveFor(openShown.goal)}>
                  Versement
                </Button>
              )}
              <Button
                variant="secondary"
                icon="edit"
                onClick={() => {
                  setGoalOpen(null);
                  setGoalEdit(openShown.goal);
                }}
              >
                Modifier
              </Button>
              <Button
                variant="danger"
                icon="trash"
                onClick={() => {
                  setGoalOpen(null);
                  void deleteGoal(openShown.goal.id);
                }}
              >
                Supprimer
              </Button>
            </div>
            {openShown.goal.linkKind === 'manual' && (
              <div>
                <p className="t-label mb-2 text-muted">Versements</p>
                <GoalMoves goalId={openShown.goal.id} />
              </div>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={moveFor !== null} onClose={() => setMoveFor(null)} title={moveShown ? `${moveShown.emoji} ${moveShown.name}` : ''}>
        {moveShown && (
          <GoalMoveForm
            goal={moveShown}
            onDone={(amount) => {
              setMoveFor(null);
              const gp = w.goalsProgress.find((g) => g.goal.id === moveShown.id);
              if (gp && !gp.achieved && gp.saved + amount >= moveShown.target) {
                void db.goals.update(moveShown.id, { achievedAt: Date.now() });
                setFlash(moveShown.name);
                setTimeout(() => setFlash(null), 1600);
                toast({ message: `Objectif « ${moveShown.name} » atteint !`, tone: 'gold' });
              } else toast({ message: `${formatCents(Math.abs(amount))} ${amount >= 0 ? 'versés' : 'retirés'}` });
            }}
          />
        )}
      </Sheet>

      <Sheet open={assetEdit !== null} onClose={() => setAssetEdit(null)} title={assetShown === 'new' ? 'Bien ou dette' : 'Modifier'}>
        {assetShown && (
          <div className="space-y-3">
            <AssetForm key={assetShown === 'new' ? 'new' : assetShown.id} initial={assetShown === 'new' ? null : assetShown} onDone={() => setAssetEdit(null)} />
            {assetShown !== 'new' && (
              <Button variant="danger" icon="trash" className="w-full" onClick={() => void deleteAsset(assetShown)}>
                Supprimer
              </Button>
            )}
          </div>
        )}
      </Sheet>
      <OrbFlash show={flash !== null} gold message={flash ? `${flash} : atteint` : undefined} />
    </Screen>
  );
}

function GoalMoves({ goalId }: { goalId: string }) {
  const moves = useLiveQuery(() => db.goalMoves.where('goalId').equals(goalId).reverse().sortBy('date'), [goalId]) ?? [];
  if (moves.length === 0) return <p className="t-small text-muted">Aucun versement pour l’instant.</p>;
  return (
    <Group>
      {moves.slice(0, 12).map((m) => (
        <Tap
          key={m.id}
          scaleTo={0.985}
          onClick={() => void changeWithUndo('Versement supprimé', async () => ({ goalMoves: [m] }), () => db.goalMoves.delete(m.id))}
          label="Supprimer ce versement"
          className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left"
        >
          <span className="t-small flex-1 text-secondary">
            {formatShort(m.date)}
            {m.note ? ` · ${m.note}` : ''}
          </span>
          <Money cents={m.amount} sign tone={m.amount >= 0 ? 'success' : 'danger'} />
          <Icon name="trash" size={16} className="text-muted" />
        </Tap>
      ))}
    </Group>
  );
}
