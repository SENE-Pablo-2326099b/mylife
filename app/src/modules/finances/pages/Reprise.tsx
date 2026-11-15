import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Badge, Button, EmptyState, Field, List, ListRow, ModuleCard, ModuleLabel, Notice, ScreenHeader, SectionTitle, Sheet } from '@mylife/kit';
import { localToday } from '@mylife/lumen';
import { euros } from '../core/format';
import type { FinanceData } from '../core/model';
import { loadAll, loadOverrides, saveOverrides } from '../data/db';
import { importOld, lastImport } from '../data/importOld';
import { compute, netWorth } from '../engine/engine';
import { fromV3 } from '../engine/fromV3';
import { checkIntegrity } from '../engine/integrity';
import type { Occurrence } from '../engine/occurrences';
import type { OccurrenceOverride, Role } from '../engine/schema';
import { useGlance } from '../../../legacy/glance';

/**
 * Étape M1 : « pourquoi ce chiffre ». Tes données de l'ancienne app, passées dans le moteur, avec chaque terme des
 * formules (docs/V5-MYFINANCES-MOTEUR.md). Écran de vérification, provisoire : les écrans définitifs viennent en M5.
 * Rien n'est modifié dans l'ancienne app ; rien n'est encore réglable ici (M2 à M4).
 */
const ROLE: Record<Role, string> = { CHECKING: 'Courant', PROVISION: 'Provision', SAVINGS: 'Épargne', INVESTMENT: 'Placement', CASH: 'Espèces', ASSET: 'Bien', LIABILITY: 'Dette' };
const KIND = { INCOME: 'Revenu', CHARGE: 'Charge', SAVING: 'Épargne', INSTALLMENT: 'Échéance' } as const;
const STATUS = { PAID: 'ok', PARTIAL: 'warn', DUE: 'warn', SKIPPED: 'neutral' } as const;
const STATUS_LABEL = { PAID: 'réglée', PARTIAL: 'en partie', DUE: 'à venir', SKIPPED: 'sautée' } as const;
/** « 300 » ou « 300,50 » → centimes ; null si ce n'est pas un montant. */
const cents = (text: string) => {
  const n = Number(text.replace(/\s/g, '').replace(',', '.'));
  return text.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
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

/** Décider d'une échéance : déjà versé en partie, réglée, sautée, ou laisser le moteur chercher. */
function OccurrenceSheet({ o, onClose, onDecide }: { o: Occurrence | null; onClose: () => void; onDecide: (id: string, decision: OccurrenceOverride | null) => void }) {
  const [paid, setPaid] = useState('');
  useEffect(() => setPaid(o && o.status === 'PARTIAL' ? String(o.paid / 100).replace('.', ',') : ''), [o]);
  if (!o) return null;
  const amount = cents(paid);
  const tooMuch = amount !== null && amount > o.expected;
  return (
    <Sheet open title={o.commitment.label} onClose={onClose}>
      <div className="stack">
        <span className="t-small muted">
          {KIND[o.commitment.kind]} de {euros(o.expected)}, le {day(o.dueDate)}. {o.status === 'PARTIAL' ? `${euros(o.paid)} déjà versés, reste ${euros(o.remaining)}.` : ''}
        </span>
        <Field id="occ-paid" label="Déjà versé" hint="Ce qui est déjà sorti de ton compte pour cette échéance : seul le reste sera compté à payer." error={tooMuch ? 'Plus que l’échéance : marque-la plutôt réglée.' : null}>
          <input id="occ-paid" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="0" />
        </Field>
        <Button variant="action" block disabled={amount === null || amount === 0 || tooMuch} onClick={() => onDecide(o.id, { id: o.id, status: 'PARTIAL', transactionId: null, paid: amount ?? 0 })}>
          Enregistrer
        </Button>
        <div className="grid-2">
          <Button onClick={() => onDecide(o.id, { id: o.id, status: 'PAID', transactionId: null })}>Déjà réglée</Button>
          <Button onClick={() => onDecide(o.id, { id: o.id, status: 'SKIPPED', transactionId: null })}>Sauter ce cycle</Button>
        </div>
        <Button variant="quiet" onClick={() => onDecide(o.id, null)}>
          Laisser le calcul décider
        </Button>
      </div>
    </Sheet>
  );
}

export function ReprisePage() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [empty, setEmpty] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<OccurrenceOverride[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
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
      setOverrides(await loadOverrides());
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

  const db = { ...fromV3(data), occurrenceOverrides: overrides };
  const decide = (id: string, decision: OccurrenceOverride | null) => {
    const next = [...overrides.filter((x) => x.id !== id), ...(decision ? [decision] : [])];
    setOverrides(next);
    setEditing(null);
    void saveOverrides(next);
  };
  const e = compute(db, localToday());
  const worth = netWorth(db);
  const integrity = checkIntegrity(db);
  const daily = db.accounts.filter((a) => a.includeInDailyCash && !a.archivedAt);
  const dueCount = e.occurrences.filter((o) => (o.status === 'DUE' || o.status === 'PARTIAL') && o.commitment.kind !== 'INCOME').length;

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

      <SectionTitle>1 · Budget théorique</SectionTitle>
      <List>
        <Term label="Revenus du cycle" value={euros(e.revenus)} />
        <Term sign="−" label="Charges prévues" value={euros(e.charges)} />
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

      <SectionTitle>Échéances du cycle : {e.occurrences.length} · touche une charge pour la corriger</SectionTitle>
      <List>
        {e.occurrences.length === 0 && <ListRow title="Aucune échéance prévue" detail="Ni revenu, ni charge, ni épargne dans l’ancienne app" />}
        {e.occurrences.map((o) => (
          <ListRow
            key={o.id}
            title={o.commitment.label}
            detail={`${KIND[o.commitment.kind]} · ${day(o.dueDate)}${o.status === 'PARTIAL' ? ` · ${euros(o.paid)} versés, reste ${euros(o.remaining)}` : ''}`}
            value={<span className="row" style={{ gap: 8 }}><Badge tone={STATUS[o.status]}>{STATUS_LABEL[o.status]}</Badge>{euros(o.actual ?? o.expected)}</span>}
            onClick={o.commitment.kind === 'INCOME' ? undefined : () => setEditing(o.id)}
          />
        ))}
      </List>

      <OccurrenceSheet o={e.occurrences.find((o) => o.id === editing) ?? null} onClose={() => setEditing(null)} onDecide={decide} />

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
