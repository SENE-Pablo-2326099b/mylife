import { useState, type ReactNode } from 'react';
import { Badge, Button, EmptyState, List, ListRow, ModuleCard, ModuleLabel, Notice, ScreenHeader, SectionTitle, Segmented } from '@mylife/kit';
import { euros } from '../core/format';
import { useEngine } from '../data/engineStore';
import { envelopeOf, netWorth, weight } from '../engine/engine';
import { checkIntegrity } from '../engine/integrity';
import { isProvisioned } from '../engine/occurrences';
import type { Commitment, Envelope, Provision, Role } from '../engine/schema';
import { addInstallmentPlan, decideOccurrence, patchAllocation, removeCommitment, removeEnvelope, removeInstallmentPlan, removeProvision, resetCarry, saveCommitment, saveEnvelope, saveProvision } from '../engine/state';
import { useGlance } from '../../../legacy/glance';
import { day, END, KIND, RHYTHM } from './labels';
import { CommitmentSheet, EnvelopeSheet, ExpenseSheet, InstallmentSheet, OccurrenceSheet, ProvisionSheet, type ExpenseLine } from './sheets';

/**
 * Étapes M1 et M2 : « pourquoi ce chiffre », et de quoi régler le plan. Les trois blocs de la formule avec tes
 * montants (docs/V5-MYFINANCES-MOTEUR.md), puis les échéances, le prévu, les poches, les dépenses du cycle, les
 * enveloppes et la fin de cycle, tous modifiables. Écran de travail, provisoire : les écrans définitifs viennent en M5.
 * Les opérations viennent de l'ancienne app, qui n'est jamais modifiée ; tes réglages sont gardés sur l'appareil.
 */
const ROLE: Record<Role, string> = { CHECKING: 'Courant', PROVISION: 'Provision', SAVINGS: 'Épargne', INVESTMENT: 'Placement', CASH: 'Espèces', ASSET: 'Bien', LIABILITY: 'Dette' };
const STATUS = { PAID: 'ok', PARTIAL: 'warn', DUE: 'warn', SKIPPED: 'neutral' } as const;
const STATUS_LABEL = { PAID: 'réglée', PARTIAL: 'en partie', DUE: 'à venir', SKIPPED: 'sautée' } as const;
const END_OPTIONS = [
  { id: 'RESET', label: 'Remis à zéro' },
  { id: 'ROLLOVER', label: 'Reporté' },
  { id: 'AUTO_SAVE', label: 'Épargné' },
] as const;

/** Une ligne de formule : le signe, le terme, sa valeur ; la ligne de résultat est en gras. */
function Term({ sign, label, detail, value, total }: { sign?: '−' | '+' | '=' | '÷'; label: string; detail?: ReactNode; value: string; total?: boolean }) {
  return (
    <div className="list-row">
      <span className="muted" style={{ width: 14, textAlign: 'center', fontWeight: 700 }}>{sign ?? ''}</span>
      <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="t-body" style={{ fontWeight: total ? 700 : 500 }}>{label}</span>
        {detail && <span className="t-small muted">{detail}</span>}
      </span>
      <span className={total ? 't-card' : 't-strong'}>{value}</span>
    </div>
  );
}

function Head({ children, action, onAction }: { children: ReactNode; action?: string; onAction?: () => void }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 }}>
      <SectionTitle>{children}</SectionTitle>
      {action && (
        <button type="button" className="link t-small" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

export function ReprisePage() {
  const engine = useEngine();
  const old = useGlance('finances');
  const [occurrence, setOccurrence] = useState<string | null>(null);
  const [commitment, setCommitment] = useState<Commitment | 'new' | null>(null);
  const [installment, setInstallment] = useState(false);
  const [provision, setProvision] = useState<Provision | 'new' | null>(null);
  const [expense, setExpense] = useState<string | null>(null);
  const [envelope, setEnvelope] = useState<Envelope | 'new' | null>(null);

  const header = <ScreenHeader kicker="MyFinances V5 · moteur" title="Pourquoi ce chiffre" />;
  if (engine.status === 'error')
    return (
      <>
        {header}
        <Notice tone="bad">La lecture de tes données a échoué : {engine.error}</Notice>
        <Button onClick={engine.reload}>Réessayer</Button>
      </>
    );
  if (engine.status === 'empty')
    return (
      <>
        {header}
        <EmptyState title="Rien à reprendre ici" body="MyFinances n’a pas encore de données sur cet appareil. Ouvre-la une fois, puis reviens." action={<Button href="/finances/">Ouvrir MyFinances</Button>} />
      </>
    );
  const { db, state, explanation: e, update, today } = engine;
  if (!db || !state || !e) return <>{header}<span className="t-small muted">Lecture de tes données…</span></>;

  const worth = netWorth(db, today);
  const integrity = checkIntegrity(db);
  const daily = db.accounts.filter((a) => a.includeInDailyCash && !a.archivedAt);
  const reserved = (c: Commitment) => c.kind !== 'INCOME' && (c.reserveInCash ?? db.settings.reserveDue[c.kind]);
  const dueReserved = e.occurrences.filter((o) => (o.status === 'DUE' || o.status === 'PARTIAL') && reserved(o.commitment)).length;
  const txById = new Map(db.transactions.map((t) => [t.id, t]));
  const settled = new Set(e.occurrences.flatMap((o) => o.transactionIds));
  // Les dépenses du cycle qui pèsent (ou pèseraient) dans le budget quotidien, les plus récentes d'abord.
  const expenses: ExpenseLine[] = db.allocations
    .flatMap((a) => {
      const t = txById.get(a.transactionId);
      if (!t || t.date < e.cycle.start || t.date > today || !envelopeOf(db, a.categoryId).inDailyBudget) return [];
      const pesante = weight({ ...a, fundedBySavings: false }, settled) > 0;
      return pesante ? [{ allocationId: a.id, label: t.rawLabel, date: t.date, amount: a.amount, smoothed: a.smoothed === true, fundedBySavings: a.fundedBySavings === true }] : [];
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.amount - b.amount);
  const lastClosed = state.closedCycles[0];
  const carried = state.carryIn.global !== 0 || Object.keys(state.carryIn.envelopes).length > 0;

  return (
    <>
      {header}
      <ModuleCard tone="finances">
        <div className="pad stack" style={{ gap: 8 }}>
          <ModuleLabel tone="finances">Reste aujourd’hui</ModuleLabel>
          <span className="t-hero">{euros(e.resteAujourdhui)}</span>
          <span className="t-small muted">
            Budget du jour {euros(e.budgetJour)} · {euros(e.spentToday)} dépensés aujourd’hui · {e.daysLeft} jour{e.daysLeft > 1 ? 's' : ''} avant la paie
          </span>
          <span className="t-small" style={{ fontWeight: 600 }}>
            {e.deficit > 0 ? `Plus rien de disponible : il manque ${euros(e.deficit)}.` : e.limitedBy === 'cash' ? `Limité par ta trésorerie : ${euros(-e.marge)} de moins que ton budget.` : `Dans ton budget. Marge de trésorerie : ${euros(e.marge)}.`}
          </span>
          {old && <span className="t-small muted">L’app actuelle affiche : {old.title}</span>}
        </div>
      </ModuleCard>

      {integrity.errors.length > 0 && <Notice tone="bad">Données incohérentes : {integrity.errors.slice(0, 3).join(' ; ')}</Notice>}
      {integrity.warnings.map((w) => (
        <Notice key={w} tone="warn">{w}</Notice>
      ))}
      {e.incomeFallback && <Notice tone="warn">Aucun revenu prévu : les revenus reçus dans le cycle servent de base.</Notice>}
      {e.unknownBalances.length > 0 && <Notice tone="warn">Solde inconnu pour {e.unknownBalances.join(', ')} : la trésorerie est sous-estimée.</Notice>}

      {e.pendingIncomes.length > 0 && (
        <>
          <Head>Revenus en attente de décision : {e.pendingIncomes.length}</Head>
          <List>
            {e.pendingIncomes.map((p) => (
              <div key={p.transactionId} className="list-row" style={{ flexWrap: 'wrap' }}>
                <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="t-body" style={{ fontWeight: 500 }}>{txById.get(p.transactionId)?.rawLabel ?? 'Revenu'}</span>
                  <span className="t-small muted">{euros(p.amount)} · hors budget tant que tu n’as pas choisi</span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <Button onClick={() => update((s) => patchAllocation(s, `${p.transactionId}#0`, { incomeUse: 'BUDGET' }))}>Au budget</Button>
                  <Button onClick={() => update((s) => patchAllocation(s, `${p.transactionId}#0`, { incomeUse: 'SAVINGS' }))}>À l’épargne</Button>
                </span>
              </div>
            ))}
          </List>
        </>
      )}

      <SectionTitle>1 · Budget théorique</SectionTitle>
      <List>
        <Term label="Revenus du cycle" value={euros(e.revenus)} />
        <Term sign="−" label="Charges prévues" detail={e.provisioning > 0 ? `dont ${euros(e.provisioning)} de provisions` : undefined} value={euros(e.charges)} />
        <Term sign="−" label="Épargne" detail="le plus grand du prévu et du déjà mis de côté" value={euros(e.epargne)} />
        {e.report !== 0 && <Term sign="+" label="Report du cycle précédent" value={euros(e.report)} />}
        <Term sign="=" label="Reste à vivre" value={euros(e.rav)} total />
        {e.offPlanPaid > 0 && <Term sign="−" label="Charges fixes réglées" detail="payées ce cycle sans être au plan" value={euros(e.offPlanPaid)} />}
        {e.reserve > 0 && <Term sign="−" label="Enveloppes hors quotidien" value={euros(e.reserve)} />}
        <Term sign="−" label="Déjà dépensé" detail={`du ${day(e.cycle.start)} à aujourd’hui`} value={euros(e.spent)} />
        <Term sign="=" label="Reste dans le budget" value={euros(e.resteEnveloppe)} total />
      </List>

      <SectionTitle>2 · Trésorerie réelle</SectionTitle>
      <List>
        <Term label="Comptes du quotidien" detail={daily.map((a) => a.name).join(', ') || 'aucun'} value={euros(e.cash)} />
        <Term sign="−" label="Poches verrouillées" value={euros(e.locked)} />
        <Term sign="−" label="Échéances réservées" detail={`${dueReserved} à venir${e.covered > 0 ? ` · ${euros(e.covered)} déjà en poche` : ''}`} value={euros(e.toPay)} />
        {e.offDaily > 0 && <Term sign="−" label="Reste des enveloppes hors quotidien" value={euros(e.offDaily)} />}
        <Term sign="=" label="Cash libre" value={euros(e.cashLibre)} total />
      </List>

      <SectionTitle>3 · Budget du jour</SectionTitle>
      <List>
        <Term label="Disponible à minuit" detail={e.mode === 'CASH' ? 'mode trésorerie : le cash libre' : `le plus petit des deux : ${e.limitedBy === 'cash' ? 'la trésorerie' : 'le budget'}`} value={euros(e.disponible)} />
        <Term sign="÷" label="Jours restants" value={String(e.daysLeft)} />
        <Term sign="=" label="Budget du jour" detail={e.smoothedToday > 0 ? `gelé jusqu’à minuit · ${euros(e.smoothedToday)} lissés aujourd’hui` : 'gelé jusqu’à minuit'} value={euros(e.budgetJour)} total />
        <Term sign="−" label="Dépensé aujourd’hui" value={euros(e.spentToday)} />
        <Term sign="=" label="Reste aujourd’hui" value={euros(e.resteAujourdhui)} total />
        <Term label="Demain, à ce rythme" value={`${euros(e.demain)} par jour`} />
      </List>

      <Head>Échéances du cycle : {e.occurrences.length}</Head>
      <List>
        {e.occurrences.length === 0 && <ListRow title="Aucune échéance ce cycle" />}
        {e.occurrences.map((o) => (
          <ListRow
            key={o.id}
            title={o.commitment.label}
            detail={`${KIND[o.commitment.kind]} · ${day(o.dueDate)}${o.status === 'PARTIAL' ? ` · ${euros(o.paid)} versés, reste ${euros(o.remaining)}` : ''}${isProvisioned(o.commitment) ? ' · payée par sa provision' : reserved(o.commitment) && o.status !== 'PAID' && o.status !== 'SKIPPED' ? ' · réservée' : ''}`}
            value={<span className="row" style={{ gap: 8 }}><Badge tone={STATUS[o.status]}>{STATUS_LABEL[o.status]}</Badge>{euros(o.actual ?? o.expected)}</span>}
            onClick={o.commitment.kind === 'INCOME' ? () => setCommitment(o.commitment) : () => setOccurrence(o.id)}
          />
        ))}
      </List>

      <Head action="Ajouter" onAction={() => setCommitment('new')}>Prévu : {db.commitments.length} engagement{db.commitments.length > 1 ? 's' : ''}</Head>
      <List>
        {db.commitments.length === 0 && <ListRow title="Rien de prévu" detail="Ajoute ton salaire, ton loyer, ton épargne" />}
        {db.commitments.map((c) => (
          <ListRow
            key={c.id}
            title={c.label}
            detail={[KIND[c.kind], `${euros(c.amount)} ${RHYTHM[c.rhythm]}`, c.paused ? 'en pause' : null, reserved(c) ? 'réservé' : null, isProvisioned(c) ? 'provisionné' : null, db.settings.openingCommitmentId === c.id ? 'ouvre le cycle' : null].filter(Boolean).join(' · ')}
            onClick={() => setCommitment(c)}
          />
        ))}
      </List>
      <Button block onClick={() => setInstallment(true)}>
        Paiement en plusieurs fois
      </Button>

      <Head action="Ajouter" onAction={() => setProvision('new')}>Poches : {euros(db.provisions.reduce((s, p) => s + p.amount, 0))} verrouillés</Head>
      <List>
        {db.provisions.length === 0 && <ListRow title="Aucune poche" detail="Verrouille de l’argent sur un compte pour une échéance à venir" />}
        {db.provisions.map((p) => (
          <ListRow
            key={p.id}
            title={p.label}
            detail={[db.accounts.find((a) => a.id === p.accountId)?.name, p.auto ? 'provision automatique' : p.commitmentId ? `couvre « ${db.commitments.find((c) => c.id === p.commitmentId)?.label ?? '?'} »` : 'poche libre'].filter(Boolean).join(' · ')}
            value={euros(p.amount)}
            onClick={() => setProvision(p)}
          />
        ))}
      </List>

      <Head>Dépenses du cycle · touche-en une pour la lisser</Head>
      <List>
        {expenses.length === 0 && <ListRow title="Aucune dépense ce cycle" />}
        {expenses.slice(0, 12).map((x) => (
          <ListRow key={x.allocationId} title={x.label} detail={[day(x.date), x.smoothed ? 'lissée' : null, x.fundedBySavings ? 'financée par l’épargne' : null].filter(Boolean).join(' · ')} value={euros(x.amount)} onClick={() => setExpense(x.allocationId)} />
        ))}
      </List>

      <Head action="Ajouter" onAction={() => setEnvelope('new')}>Enveloppes</Head>
      <List>
        {e.envelopes.map((x) => (
          <ListRow
            key={x.envelope.id}
            title={x.envelope.name}
            detail={`${x.envelope.inDailyBudget ? 'dans le quotidien' : 'hors quotidien'}${x.budget !== null ? ` · ${euros(x.spent)} sur ${euros(x.budget)}` : ''}`}
            value={x.budget !== null ? euros(x.budget - x.spent) : euros(x.spent)}
            onClick={() => setEnvelope(x.envelope)}
          />
        ))}
      </List>

      <SectionTitle>Fin de cycle · le {day(e.cycle.end)}</SectionTitle>
      <span className="t-small muted">Que devient ce qu’il reste du budget du quotidien ?</span>
      <Segmented label="Excédent en fin de cycle" value={db.settings.endPolicy} options={END_OPTIONS} onChange={(endPolicy) => update((s) => ({ ...s, settings: { ...s.settings, endPolicy } }))} />
      <span className="t-small muted">{END.find(([id]) => id === db.settings.endPolicy)?.[1]}. Un dépassement est déduit du cycle suivant.</span>
      {(carried || lastClosed) && (
        <List>
          {lastClosed && <ListRow title={`Cycle clos le ${day(lastClosed.end)}`} detail={lastClosed.result >= 0 ? `Excédent de ${euros(lastClosed.result)}${lastClosed.toSave > 0 ? ` · ${euros(lastClosed.toSave)} à envoyer vers l’épargne ?` : ''}` : `Dépassement de ${euros(-lastClosed.result)}`} value={euros(lastClosed.spent)} />}
          {carried && <ListRow title="Report en cours" detail="Remettre les compteurs à zéro" value={euros(state.carryIn.global, { sign: true })} onClick={() => update(resetCarry)} />}
        </List>
      )}

      <SectionTitle>Comptes · patrimoine net {euros(worth.net, { round: true })}</SectionTitle>
      <List>
        {db.accounts
          .filter((a) => !a.archivedAt)
          .map((a) => (
            <ListRow key={a.id} title={a.name} detail={`${ROLE[a.role]}${a.includeInDailyCash ? ' · dans le cash quotidien' : ''}`} value={a.balance === null ? '?' : euros(a.role === 'LIABILITY' ? -a.balance : a.balance, { round: true })} />
          ))}
        {worth.installments > 0 && <ListRow title="Paiements fractionnés restants" detail="Déduits du patrimoine" value={euros(-worth.installments, { round: true })} />}
      </List>

      <Button block disabled={engine.busy} onClick={engine.reload}>
        {engine.busy ? 'Lecture en cours…' : 'Relire mes données'}
      </Button>
      {engine.at && <span className="t-small muted" style={{ textAlign: 'center' }}>Dernière lecture : {new Date(engine.at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}. L’ancienne app n’est pas modifiée.</span>}

      <OccurrenceSheet
        o={e.occurrences.find((o) => o.id === occurrence) ?? null}
        onClose={() => setOccurrence(null)}
        onDecide={(id, decision) => {
          update((s) => decideOccurrence(s, id, decision));
          setOccurrence(null);
        }}
        onEdit={(c) => {
          setOccurrence(null);
          setCommitment(c);
        }}
      />
      <CommitmentSheet
        value={commitment}
        db={db}
        onClose={() => setCommitment(null)}
        onSave={(c, opens) => {
          update((s) => {
            const next = saveCommitment(s, c);
            const opening = opens ? c.id : next.settings.openingCommitmentId === c.id ? null : next.settings.openingCommitmentId;
            return { ...next, settings: { ...next.settings, openingCommitmentId: opening } };
          });
          setCommitment(null);
        }}
        onRemove={(id) => {
          const plan = db.commitments.find((c) => c.id === id)?.installmentPlanId;
          update((s) => (plan ? removeInstallmentPlan(s, plan) : removeCommitment(s, id)));
          setCommitment(null);
        }}
      />
      <InstallmentSheet
        open={installment}
        today={today}
        accounts={daily}
        onClose={() => setInstallment(false)}
        onSave={(input) => {
          update((s) => addInstallmentPlan(s, input));
          setInstallment(false);
        }}
      />
      <ProvisionSheet
        value={provision}
        db={db}
        onClose={() => setProvision(null)}
        onSave={(p) => {
          update((s) => saveProvision(s, p));
          setProvision(null);
        }}
        onRemove={(id) => {
          update((s) => removeProvision(s, id));
          setProvision(null);
        }}
      />
      <ExpenseSheet line={expenses.find((x) => x.allocationId === expense) ?? null} onClose={() => setExpense(null)} onPatch={(id, patch) => update((s) => patchAllocation(s, id, patch))} />
      <EnvelopeSheet
        value={envelope}
        categories={db.categories.filter((c) => !c.archivedAt && !c.mergedIntoId)}
        envelopes={db.envelopes}
        onClose={() => setEnvelope(null)}
        onSave={(env) => {
          update((s) => saveEnvelope(s, env));
          setEnvelope(null);
        }}
        onRemove={(id) => {
          update((s) => removeEnvelope(s, id));
          setEnvelope(null);
        }}
      />
    </>
  );
}
