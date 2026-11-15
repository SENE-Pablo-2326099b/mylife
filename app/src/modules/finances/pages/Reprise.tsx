import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Badge, Button, EmptyState, List, ListRow, ModuleCard, ModuleLabel, Notice, ScreenHeader, SectionTitle } from '@mylife/kit';
import { localToday } from '@mylife/lumen';
import { euros } from '../core/format';
import type { FinanceData } from '../core/model';
import { loadAll } from '../data/db';
import { importOld, lastImport } from '../data/importOld';
import { compute, netWorth } from '../engine/engine';
import { fromV3 } from '../engine/fromV3';
import { checkIntegrity } from '../engine/integrity';
import type { Role } from '../engine/schema';
import { useGlance } from '../../../legacy/glance';

/**
 * Étape M1 : « pourquoi ce chiffre ». Tes données de l'ancienne app, passées dans le moteur, avec chaque terme des
 * formules (docs/V5-MYFINANCES-MOTEUR.md). Écran de vérification, provisoire : les écrans définitifs viennent en M5.
 * Rien n'est modifié dans l'ancienne app ; rien n'est encore réglable ici (M2 à M4).
 */
const ROLE: Record<Role, string> = { CHECKING: 'Courant', PROVISION: 'Provision', SAVINGS: 'Épargne', INVESTMENT: 'Placement', CASH: 'Espèces', ASSET: 'Bien', LIABILITY: 'Dette' };
const KIND = { INCOME: 'Revenu', CHARGE: 'Charge', SAVING: 'Épargne', INSTALLMENT: 'Échéance' } as const;
const STATUS = { PAID: 'ok', DUE: 'warn', SKIPPED: 'neutral' } as const;
const STATUS_LABEL = { PAID: 'réglée', DUE: 'à venir', SKIPPED: 'sautée' } as const;
const day = (iso: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(`${iso}T12:00:00`));

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

export function ReprisePage() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [empty, setEmpty] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const old = useGlance('finances');

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await importOld();
      setData(r.data);
      setEmpty(r.empty && r.data.accounts.length === 0);
      if (!r.empty) setAt(r.at);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const when = await lastImport();
      if (when === null) return run();
      setAt(when);
      setData(await loadAll());
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [run]);

  const header = <ScreenHeader kicker="MyFinances V5 · moteur" title="Pourquoi ce chiffre" />;
  if (error)
    return (
      <>
        {header}
        <Notice tone="bad">La lecture de tes données a échoué : {error}</Notice>
        <Button onClick={() => void run()}>Réessayer</Button>
      </>
    );
  if (!data) return <>{header}<span className="t-small muted">Lecture de tes données…</span></>;
  if (empty)
    return (
      <>
        {header}
        <EmptyState title="Rien à reprendre ici" body="MyFinances n’a pas encore de données sur cet appareil. Ouvre-la une fois, puis reviens." action={<Button href="/finances/">Ouvrir MyFinances</Button>} />
      </>
    );

  const db = fromV3(data);
  const e = compute(db, localToday());
  const worth = netWorth(db);
  const integrity = checkIntegrity(db);
  const daily = db.accounts.filter((a) => a.includeInDailyCash && !a.archivedAt);
  const offPlan = e.envelopes.filter((x) => !x.envelope.inDailyBudget && x.budget === null && x.spent > 0);
  const dueCount = e.occurrences.filter((o) => o.status === 'DUE' && o.commitment.kind !== 'INCOME').length;

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

      {integrity.errors.length > 0 && <Notice tone="bad">Données incohérentes après reprise : {integrity.errors.slice(0, 3).join(' ; ')}</Notice>}
      {e.pendingIncomes.length > 0 && (
        <Notice tone="warn">
          {e.pendingIncomes.length} revenu{e.pendingIncomes.length > 1 ? 's' : ''} non prévu{e.pendingIncomes.length > 1 ? 's' : ''} ({euros(e.pendingIncomes.reduce((s, p) => s + p.amount, 0))}) : hors budget tant que tu n’as pas choisi entre budget et épargne.
        </Notice>
      )}
      {e.incomeFallback && <Notice tone="warn">Aucun revenu prévu : les revenus reçus dans le cycle servent de base.</Notice>}
      {e.unknownBalances.length > 0 && <Notice tone="warn">Solde inconnu pour {e.unknownBalances.join(', ')} : la trésorerie est sous-estimée.</Notice>}
      {offPlan.length > 0 && (
        <Notice>
          {euros(offPlan.reduce((s, x) => s + x.spent, 0))} de charges fixes payées ce cycle sans être au plan : elles ne comptent pas dans le budget théorique, seulement dans la trésorerie.
        </Notice>
      )}

      <SectionTitle>1 · Budget théorique</SectionTitle>
      <List>
        <Term label="Revenus du cycle" value={euros(e.revenus)} />
        <Term sign="−" label="Charges prévues" value={euros(e.charges)} />
        <Term sign="−" label="Épargne" detail="le plus grand du prévu et du déjà mis de côté" value={euros(e.epargne)} />
        {e.report !== 0 && <Term sign="+" label="Report du cycle précédent" value={euros(e.report)} />}
        <Term sign="=" label="Reste à vivre" value={euros(e.rav)} total />
        {e.reserve > 0 && <Term sign="−" label="Enveloppes hors quotidien" value={euros(e.reserve)} />}
        <Term sign="−" label="Déjà dépensé" detail={`du ${day(e.cycle.start)} à aujourd’hui`} value={euros(e.spent)} />
        <Term sign="=" label="Reste dans le budget" value={euros(e.resteEnveloppe)} total />
      </List>

      <SectionTitle>2 · Trésorerie réelle</SectionTitle>
      <List>
        <Term label="Comptes du quotidien" detail={daily.map((a) => a.name).join(', ') || 'aucun'} value={euros(e.cash)} />
        <Term sign="−" label="Poches verrouillées" value={euros(e.locked)} />
        <Term sign="−" label="À payer avant la paie" detail={`${dueCount} échéance${dueCount > 1 ? 's' : ''}${e.covered > 0 ? ` · ${euros(e.covered)} déjà en poche` : ''}`} value={euros(e.toPay)} />
        {e.offDaily > 0 && <Term sign="−" label="Reste des enveloppes hors quotidien" value={euros(e.offDaily)} />}
        <Term sign="=" label="Cash libre" value={euros(e.cashLibre)} total />
      </List>

      <SectionTitle>3 · Budget du jour</SectionTitle>
      <List>
        <Term label="Disponible à minuit" detail={e.mode === 'CASH' ? 'mode trésorerie : le cash libre' : `le plus petit des deux : ${e.limitedBy === 'cash' ? 'la trésorerie' : 'le budget'}`} value={euros(e.disponible)} />
        <Term sign="÷" label="Jours restants" value={String(e.daysLeft)} />
        <Term sign="=" label="Budget du jour" detail="gelé jusqu’à minuit" value={euros(e.budgetJour)} total />
        <Term sign="−" label="Dépensé aujourd’hui" value={euros(e.spentToday)} />
        <Term sign="=" label="Reste aujourd’hui" value={euros(e.resteAujourdhui)} total />
        <Term label="Demain, à ce rythme" value={`${euros(e.demain)} par jour`} />
      </List>

      <SectionTitle>Échéances du cycle : {e.occurrences.length}</SectionTitle>
      <List>
        {e.occurrences.length === 0 && <ListRow title="Aucune échéance prévue" detail="Ni revenu, ni charge, ni épargne dans l’ancienne app" />}
        {e.occurrences.map((o) => (
          <ListRow key={o.id} title={o.commitment.label} detail={`${KIND[o.commitment.kind]} · ${day(o.dueDate)}`} value={<span className="row" style={{ gap: 8 }}><Badge tone={STATUS[o.status]}>{STATUS_LABEL[o.status]}</Badge>{euros(o.actual ?? o.expected)}</span>} />
        ))}
      </List>

      <SectionTitle>Enveloppes</SectionTitle>
      <List>
        {e.envelopes.map((x) => (
          <ListRow key={x.envelope.id} title={x.envelope.name} detail={`${x.envelope.inDailyBudget ? 'dans le quotidien' : 'hors quotidien'}${x.budget !== null ? ` · plafond ${euros(x.budget)}` : ''}`} value={euros(x.spent)} />
        ))}
      </List>

      <SectionTitle>Comptes · patrimoine net {euros(worth.net, { round: true })}</SectionTitle>
      <List>
        {db.accounts
          .filter((a) => !a.archivedAt)
          .map((a) => (
            <ListRow key={a.id} title={a.name} detail={`${ROLE[a.role]}${a.includeInDailyCash ? ' · dans le cash quotidien' : ''}`} value={a.balance === null ? '?' : euros(a.role === 'LIABILITY' ? -a.balance : a.balance, { round: true })} />
          ))}
      </List>

      <Button block disabled={busy} onClick={() => void run()}>
        {busy ? 'Lecture en cours…' : 'Relire mes données'}
      </Button>
      {at && <span className="t-small muted" style={{ textAlign: 'center' }}>Dernière lecture : {new Date(at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}. L’ancienne app n’est pas modifiée.</span>}
    </>
  );
}
