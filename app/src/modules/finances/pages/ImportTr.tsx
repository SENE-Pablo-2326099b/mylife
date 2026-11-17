import { useRef, useState } from 'react';
import { Button, Glass, List, ListRow, Notice } from '@mylife/kit';
import { euros } from '../core/format';
import { refreshQuotes } from '../data/upkeep';
import { pdfPages } from '../data/pdfText';
import { parseTrStatement, type TrStatement } from '../data/tradeRepublic';
import { applyTrImport, existingWealth, planKey, planTrImport, resolveQuotes } from '../data/trImport';
import { searchAsset } from '../data/wealth';
import { useEngine } from '../data/engineStore';
import { Toggle } from './controls';
import { Screen, Sec } from './common';
import { day } from './labels';

/**
 * Importer un relevé Trade Republic (PDF) : lu sur l'appareil (pdf.js), jamais envoyé. Un placement par compte (PEA,
 * CTO), une ligne par titre, un mouvement par exécution. Rejouable sans double, et annulable juste après.
 */
const RHYTHM = { weekly: 'chaque semaine', biweekly: 'toutes les deux semaines', monthly: 'chaque mois' } as const;
const qty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 6 });

export function ImportTrPage() {
  const engine = useEngine();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [st, setSt] = useState<TrStatement | null>(null);
  const [createPlans, setCreatePlans] = useState(true);
  const [done, setDone] = useState<{ ops: number; lines: number; undo: () => Promise<void> } | null>(null);

  const read = async (f: File) => {
    setError(null);
    setSt(null);
    setDone(null);
    setBusy('Lecture du relevé…');
    try {
      const parsed = parseTrStatement(await pdfPages(f));
      if (parsed.trades.length === 0) setError('Aucun achat, vente ou dividende trouvé. Il faut le « Relevé de compte » de Trade Republic (Profil → Activité → Relevés), en PDF.');
      else setSt(parsed);
    } catch {
      setError('Impossible de lire ce PDF. S’il est protégé par un mot de passe, exporte-le à nouveau depuis l’app Trade Republic.');
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    if (!st) return;
    setBusy('Import…');
    try {
      const plan = planTrImport(st, await existingWealth(), { createPlans, activePlans: Object.fromEntries(st.plans.map((p) => [planKey(p), p.active])) });
      if (plan.holdings.length) {
        setBusy('Recherche des cours…');
        await resolveQuotes(plan, (q) => searchAsset(q)).catch(() => 0);
      }
      const undo = await applyTrImport(plan);
      await refreshQuotes({ force: true }).catch(() => undefined);
      setDone({ ops: plan.ops.length, lines: plan.holdings.length, undo });
      setSt(null);
    } catch (e) {
      setError(`L’import a échoué : ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen engine={engine} tone="worth" title="Relevé Trade Republic" kicker="Patrimoine" back="/argent/patrimoine">
      {() => (
        <>
          <span className="t-small muted">Le PDF est lu sur ton appareil : il n’est envoyé nulle part. Tu peux importer le même relevé, ou un relevé qui en chevauche un autre, sans rien compter deux fois.</span>
          <input ref={file} type="file" accept="application/pdf" hidden aria-label="Relevé PDF" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
          <Button variant={st ? 'secondary' : 'action'} block icon="plus" disabled={!!busy} onClick={() => file.current?.click()}>
            {st ? 'Choisir un autre relevé' : 'Choisir le relevé (PDF)'}
          </Button>
          {busy && <span className="t-small muted">{busy}</span>}
          {error && <Notice tone="bad">{error}</Notice>}
          {done && (
            <Glass className="pad stack">
              <span className="t-card">{done.ops ? `${done.ops} mouvement${done.ops > 1 ? 's' : ''} importé${done.ops > 1 ? 's' : ''}` : 'Rien de nouveau'}</span>
              <span className="t-small muted">{done.lines ? `${done.lines} ligne${done.lines > 1 ? 's' : ''} créée${done.lines > 1 ? 's' : ''}. ` : ''}Tout le reste était déjà là.</span>
              <div className="grid-2">
                <Button href="/argent/patrimoine">Voir le patrimoine</Button>
                <Button
                  variant="quiet"
                  onClick={async () => {
                    await done.undo();
                    setDone(null);
                  }}
                >
                  Annuler l’import
                </Button>
              </div>
            </Glass>
          )}
          {st && (
            <>
              <Sec action={st.period ? `du ${day(st.period.from)} au ${day(st.period.to)}` : undefined}>Ce que contient le relevé</Sec>
              <List>
                {[...new Map(st.trades.map((t) => [`${t.account}|${t.isin}`, t])).values()].map((t) => {
                  const mine = st.trades.filter((x) => x.account === t.account && x.isin === t.isin);
                  const q = mine.reduce((s, x) => s + (x.kind === 'buy' ? x.quantity : x.kind === 'sell' ? -x.quantity : 0), 0);
                  const invested = mine.reduce((s, x) => s + (x.kind === 'buy' ? x.amount : x.kind === 'sell' ? -x.amount : 0), 0);
                  return <ListRow key={`${t.account}|${t.isin}`} title={t.name} detail={`${t.account} · ${mine.length} mouvement${mine.length > 1 ? 's' : ''} · ${qty(q)} parts`} value={euros(invested, { round: true })} />;
                })}
              </List>
              {st.splits.length > 0 && <Notice tone="warn">Division repérée ({st.splits.map((s) => `${s.name}, ×${s.ratio}`).join(' ; ')}) : les quantités antérieures sont ramenées à l’échelle actuelle.</Notice>}
              {st.plans.length > 0 && (
                <>
                  <Sec>Plans d’épargne repérés</Sec>
                  <List>
                    {st.plans.map((p) => (
                      <ListRow key={planKey(p)} title={p.name} detail={`${euros(p.amount)} ${RHYTHM[p.frequency]}${p.active ? '' : ' · arrêté'}`} />
                    ))}
                  </List>
                  <Toggle label="Les reprendre" detail="Les prochaines échéances s’ajouteront toutes seules, corrigées au prochain import." checked={createPlans} onChange={setCreatePlans} />
                </>
              )}
              <Button variant="action" block disabled={!!busy} onClick={() => void run()}>
                Importer {st.trades.length} mouvement{st.trades.length > 1 ? 's' : ''}
              </Button>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
