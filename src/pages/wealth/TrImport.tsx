import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { getSettings } from '../../db/seed';
import { FREQUENCY_LABEL } from '../../domain/plans';
import { parseTrStatement, type TrStatement } from '../../domain/tradeRepublic';
import { applyTrImport, cleanName, planKey, planTrImport, resolveQuotes } from '../../domain/trImport';
import { recordSnapshot, refreshPlannedSavings, refreshQuotes } from '../../domain/wealthDb';
import { formatShort } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { pdfPages } from '../../lib/pdfText';
import { canUseRelay, EbClient } from '../../sync/ebClient';
import { Badge, Button, Card, EmptyState, Group, Money, Reveal, Row, SectionTitle, ToggleRow, undoable } from '../../ui/index';
import { Screen } from '../../ui/Screen';

const qty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 6 });

export default function TrImportPage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [st, setSt] = useState<TrStatement | null>(null);
  const [fileName, setFileName] = useState('');
  const [createPlans, setCreatePlans] = useState(true);
  const [activePlans, setActivePlans] = useState<Record<string, boolean>>({});

  const read = async (file: File) => {
    setError(null);
    setSt(null);
    setBusy('Lecture du relevé…');
    try {
      const parsed = parseTrStatement(await pdfPages(file));
      if (parsed.trades.length === 0) {
        setError('Aucun achat, vente ou dividende trouvé. Vérifie qu’il s’agit bien du « Relevé de compte » Trade Republic (Profil → Activité → Relevés), au format PDF.');
        return;
      }
      setFileName(file.name);
      setSt(parsed);
      setActivePlans(Object.fromEntries(parsed.plans.map((p) => [planKey(p), p.active])));
    } catch {
      setError('Impossible de lire ce PDF. S’il est protégé par un mot de passe, exporte-le à nouveau depuis l’app Trade Republic.');
    } finally {
      setBusy(null);
    }
  };

  const doImport = async () => {
    if (!st) return;
    setBusy('Import…');
    try {
      const [portfolios, holdings, ops, plans] = await Promise.all([db.portfolios.toArray(), db.holdings.toArray(), db.investmentOps.toArray(), db.plans.toArray()]);
      const plan = planTrImport(st, { portfolios, holdings, ops, plans }, { createPlans, activePlans });
      const settings = await getSettings();
      if (canUseRelay(settings) && plan.holdings.length) {
        setBusy('Recherche des cours…');
        const client = new EbClient(settings.bridgePassword);
        await resolveQuotes(plan, (q) => client.searchAsset(q));
      }
      const created = plan.ops.length;
      let revert: (() => Promise<void>) | null = null;
      await undoable(
        created ? `${created} opération${created > 1 ? 's' : ''} importée${created > 1 ? 's' : ''}` : 'Déjà à jour : rien de nouveau',
        async () => {
          revert = await applyTrImport(plan);
        },
        async () => {
          await revert?.();
          await refreshPlannedSavings();
        },
      );
      await refreshPlannedSavings();
      void refreshQuotes({ force: true }).then(() => recordSnapshot());
      const target = Object.values(plan.portfolioOf)[0];
      navigate(target ? `/patrimoine/placement/${target.id}` : '/patrimoine', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // Aperçu : quantités et montants par ligne, par compte.
  const byLine = new Map<string, { account: string; isin: string; name: string; quantity: number; invested: number; count: number; dividends: number }>();
  for (const t of st?.trades ?? []) {
    const k = planKey(t);
    const l = byLine.get(k) ?? { account: t.account, isin: t.isin, name: t.name, quantity: 0, invested: 0, count: 0, dividends: 0 };
    if (t.kind === 'buy') {
      l.quantity += t.quantity;
      l.invested += t.amount;
    } else if (t.kind === 'sell') {
      l.quantity -= t.quantity;
      l.invested -= t.amount;
    } else l.dividends += t.amount;
    l.count++;
    byLine.set(k, l);
  }
  const accounts = [...new Set([...byLine.values()].map((l) => l.account))];

  return (
    <Screen title="Importer un relevé" kicker="Trade Republic" mood="wealth" stack back="/patrimoine">
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void read(f);
          e.target.value = '';
        }}
      />
      {!st && (
        <Reveal>
          <Card level="raised" glow>
            <EmptyState
              icon="receipt"
              title="Ton relevé Trade Republic en PDF"
              body="Dans l’app Trade Republic : Profil → Activité → Relevés de compte → choisis la période (depuis l’ouverture). L’app lit le PDF sur ton téléphone, rien n’est envoyé."
              action={
                <Button icon="upload" onClick={() => fileRef.current?.click()} disabled={!!busy}>
                  {busy ?? 'Choisir le PDF'}
                </Button>
              }
            />
          </Card>
          {error && (
            <Card tone="danger" className="mt-3">
              <p className="t-body text-danger">{error}</p>
            </Card>
          )}
          <p className="t-small mt-4 px-1 text-muted">
            Sont importés : achats, ventes, exécutions de plan d’épargne et dividendes, rangés dans un portefeuille « Trade Republic PEA » ou « Trade Republic CTO ». Les paiements par carte et virements arrivent par la synchro bancaire. Tu peux réimporter un relevé plus récent : rien ne sera compté deux fois.
          </p>
        </Reveal>
      )}

      {st && (
        <>
          <Reveal index={0}>
            <Card>
              <p className="t-body-strong">{fileName}</p>
              <p className="t-small mt-0.5 text-secondary">
                {st.period ? `Du ${formatShort(st.period.from)} au ${formatShort(st.period.to)} · ` : ''}
                {st.trades.length} opération{st.trades.length > 1 ? 's' : ''} de placement
              </p>
            </Card>
          </Reveal>

          {accounts.map((account, i) => (
            <Reveal key={account} index={i + 1}>
              <SectionTitle>{account === 'PEA' ? 'Trade Republic PEA' : 'Trade Republic CTO (compte-titres)'}</SectionTitle>
              <Group>
                {[...byLine.values()]
                  .filter((l) => l.account === account)
                  .map((l) => (
                    <Row
                      key={l.isin}
                      icon="trend-up"
                      iconTone="accent"
                      title={cleanName(l.name)}
                      subtitle={`${qty(l.quantity)} part${l.quantity > 1 ? 's' : ''} · ${l.count} opération${l.count > 1 ? 's' : ''}${l.dividends ? ` · dividendes ${formatCents(l.dividends)}` : ''}`}
                      right={<Money cents={l.invested} compact />}
                    />
                  ))}
              </Group>
            </Reveal>
          ))}

          {st.splits.length > 0 && (
            <Reveal index={accounts.length + 1}>
              <Card tone="warning" className="mt-3">
                {st.splits.map((s) => (
                  <p key={s.isin + s.date} className="t-small text-secondary">
                    <strong className="text-ink">Division détectée ×{s.ratio}</strong> sur {cleanName(s.name)} avant le {formatShort(s.date)} : le prix par part a chuté d’un coup. Les quantités antérieures sont multipliées par {s.ratio} pour rester comparables au cours actuel.
                  </p>
                ))}
              </Card>
            </Reveal>
          )}

          {st.plans.length > 0 && (
            <Reveal index={accounts.length + 2}>
              <SectionTitle>Investissements programmés détectés</SectionTitle>
              <Card>
                <ToggleRow label="Les ajouter" hint="Les prochaines échéances s’ajouteront toutes seules (quantité estimée au dernier cours, corrigée au prochain import)." checked={createPlans} onChange={setCreatePlans} />
                {createPlans &&
                  st.plans.map((p) => (
                    <ToggleRow
                      key={planKey(p)}
                      label={
                        <>
                          {cleanName(p.name)} <Badge tone={p.active ? 'success' : 'warning'}>{p.active ? 'en cours' : 'semble arrêté'}</Badge>
                        </>
                      }
                      hint={`${formatCents(p.amount)} · ${FREQUENCY_LABEL[p.frequency].toLowerCase()} · dernière exécution le ${formatShort(p.last)}`}
                      checked={activePlans[planKey(p)] ?? p.active}
                      onChange={(v) => setActivePlans((a) => ({ ...a, [planKey(p)]: v }))}
                    />
                  ))}
              </Card>
            </Reveal>
          )}

          {error && (
            <Card tone="danger" className="mt-3">
              <p className="t-body text-danger">{error}</p>
            </Card>
          )}

          <div className="mt-5 flex flex-col gap-2">
            <Button size="lg" icon="check" onClick={() => void doImport()} disabled={!!busy}>
              {busy ?? 'Importer'}
            </Button>
            <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={!!busy}>
              Choisir un autre PDF
            </Button>
          </div>
        </>
      )}
    </Screen>
  );
}
