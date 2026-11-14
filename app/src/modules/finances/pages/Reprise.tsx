import { useCallback, useEffect, useState } from 'react';
import { Button, EmptyState, List, ListRow, ModuleCard, ModuleLabel, Notice, Panel, ScreenHeader, SectionTitle } from '@mylife/kit';
import { localToday } from '@mylife/lumen';
import { dayBudget, netWorth, perCycle } from '../core/budget';
import { euros } from '../core/format';
import { toClassify } from '../core/merchants';
import { FAMILIES, NATURES, type FinanceData } from '../core/model';
import { loadAll } from '../data/db';
import { importOld, lastImport } from '../data/importOld';
import { useGlance } from '../../../legacy/glance';

/**
 * Étape 3.3 : tes données de l'ancienne app, relues dans le nouveau modèle (comptes, mouvements, marchands, prévu).
 * Écran de vérification, pas un écran définitif : les vrais écrans (Jour, Opérations, Plan, Patrimoine) le remplacent
 * aux étapes suivantes. Rien n'est modifié dans l'ancienne app.
 */
const KIND = { revenu: 'Revenu', charge: 'Charge', epargne: 'Épargne' } as const;
const RHYTHM = { weekly: 'par semaine', biweekly: 'toutes les 2 semaines', monthly: 'par mois' } as const;

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

  const header = <ScreenHeader kicker="MyFinances V5 · vérification" title="Tes données" />;
  if (error)
    return (
      <>
        {header}
        <Notice tone="bad">La reprise a échoué : {error}</Notice>
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

  const today = localToday();
  const b = dayBudget(data, today);
  const worth = netWorth(data);
  const groups = toClassify(data);
  const pending = groups.reduce((n, g) => n + g.movements.length, 0);
  const count = (nature: string | null) => data.movements.filter((m) => m.nature === nature).length;
  const classified = data.merchants.filter((m) => m.nature !== null).length;

  return (
    <>
      {header}
      <ModuleCard tone="finances">
        <div className="pad stack" style={{ gap: 8 }}>
          <ModuleLabel tone="finances">À dépenser aujourd’hui, nouveau calcul</ModuleLabel>
          <span className="t-hero">{euros(b.leftToday)}</span>
          <span className="t-small muted">
            {euros(b.spent)} dépensés sur {euros(b.plan.resteAVivre)} · {b.daysLeft} jour{b.daysLeft > 1 ? 's' : ''} avant la paie
          </span>
          {old && <span className="t-small muted">L’app actuelle affiche : {old.title}</span>}
        </div>
      </ModuleCard>

      <SectionTitle>Plan du cycle</SectionTitle>
      <List>
        <ListRow title="Revenus prévus" value={euros(b.plan.revenus)} />
        <ListRow title="Charges prévues" value={euros(-b.plan.charges)} />
        <ListRow title="Épargne prévue" value={euros(-b.plan.epargne)} />
        <ListRow title="Reste à vivre" value={euros(b.plan.resteAVivre)} />
      </List>
      <Panel title={`Prévu : ${data.planned.length} ligne${data.planned.length > 1 ? 's' : ''}`}>
        {data.planned.length === 0 && <span className="t-small muted">Aucune ligne de revenu, de charge ou d’épargne dans l’ancienne app.</span>}
        <div className="stack-0">
          {data.planned.map((p) => (
            <ListRow key={p.id} title={p.label} detail={`${KIND[p.kind]} · ${euros(p.amount)} ${RHYTHM[p.rhythm]}${p.active ? '' : ' · en pause'}`} value={euros(perCycle(p))} />
          ))}
        </div>
      </Panel>

      <SectionTitle>Patrimoine : {euros(worth.net, { round: true })} net</SectionTitle>
      <List>
        {FAMILIES.map((f) => {
          const n = data.accounts.filter((a) => a.family === f.id).length;
          return <ListRow key={f.id} title={f.name} detail={`${n} compte${n > 1 ? 's' : ''}`} value={euros(f.id === 'dettes' ? -worth.byFamily[f.id] : worth.byFamily[f.id], { round: true })} />;
        })}
      </List>

      <SectionTitle>Mouvements : {data.movements.length}</SectionTitle>
      <List>
        {NATURES.map((n) => (
          <ListRow key={n.id} title={`${n.name}s`} value={count(n.id)} />
        ))}
        <ListRow title="Nature inconnue" detail="rentrées d’argent pas encore classées" value={count(null)} />
      </List>

      <Panel title={`À classer : ${groups.length} marchand${groups.length > 1 ? 's' : ''}, ${pending} mouvement${pending > 1 ? 's' : ''}`}>
        <span className="t-small muted">
          {data.merchants.length} marchands reconnus, dont {classified} déjà classés d’après tes opérations passées.
        </span>
        <div className="stack-0">
          {groups.slice(0, 8).map((g) => (
            <ListRow key={g.merchantId ?? g.movements[0]!.id} title={g.name} detail={`${g.movements.length} mouvement${g.movements.length > 1 ? 's' : ''}`} value={euros(g.total)} />
          ))}
        </div>
      </Panel>

      <Button block disabled={busy} onClick={() => void run()}>
        {busy ? 'Reprise en cours…' : 'Reprendre à nouveau'}
      </Button>
      {at && <span className="t-small muted" style={{ textAlign: 'center' }}>Dernière reprise : {new Date(at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}. L’ancienne app n’est pas modifiée.</span>}
    </>
  );
}
