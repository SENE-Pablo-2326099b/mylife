import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Glass, Icon } from '@mylife/kit';
import { position } from '../core/budget';
import { addDays } from '../core/dates';
import { euros } from '../core/format';
import { useEngine } from '../data/engineStore';
import { netWorth } from '../engine/engine';
import type { Account } from '../engine/schema';
import { addAccount, patchAccount } from '../engine/state';
import { project, projectAccounts } from '../engine/views';
import { ConeChart, MiniRing, WorthChart } from './charts';
import { Screen, Sec } from './common';
import { Amount } from './fields';
import { AccountSheet } from './sheets';
import { FAMILIES, canSimulate, familyChange, familyOf, simulationOf, valueOf, type Family } from './worth';

/**
 * Patrimoine : « combien j'ai, et ça progresse ? ». Le total net et sa courbe ; puis les comptes, du général au
 * détail : d'abord les familles (total, poids, variation), une famille se déplie sur ses comptes, et un compte ouvre
 * sa fiche (`/argent/patrimoine/compte/<id>` : caractéristiques, performance, simulation, historique). Enfin les
 * objectifs et la projection « à ce rythme », qui suit les simulations des placements dès qu'il y en a.
 */
const RANGES = [
  { id: '90', label: '3 mois' },
  { id: '365', label: '1 an' },
  { id: '1825', label: '5 ans' },
  { id: '0', label: 'Tout' },
] as const;
const dated = (iso: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-FR', options).format(new Date(`${iso}T12:00:00`));
const short = (v: number) => euros(v, { round: true });
const kilo = (v: number) => (Math.abs(v) >= 1000000 ? `${Math.round(v / 100000)} k€` : short(v));

export function PatrimoinePage() {
  const engine = useEngine();
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useState<(typeof RANGES)[number]['id'] | null>(null);
  const [open, setOpen] = useState<Family | null>(null);
  const adding = params.get('ajouter') === '1';
  const stopAdding = () => {
    params.delete('ajouter');
    setParams(params, { replace: true });
  };
  return (
    <Screen engine={engine} tone="worth" title="Patrimoine" kicker="Net, dettes déduites">
      {({ db, state, data, e, today, update }) => {
        const worth = netWorth(db, today);
        const accounts = db.accounts.filter((a) => !a.archivedAt && a.includeInNetWorth);
        const sums = Object.fromEntries(FAMILIES.map((f) => [f.id, accounts.filter((a) => familyOf(a) === f.id).reduce((s, a) => s + valueOf(a), 0)])) as Record<Family, number>;
        const gross = sums.placements + sums.epargne + sums.biens + sums.quotidien;
        // L'historique : une photo par jour ; aujourd'hui s'y ajoute.
        const history = [...data.snapshots].sort((a, b) => a.date.localeCompare(b.date)).map((s) => ({ date: s.date, net: s.cash + s.investments + s.other - s.debts }));
        // Une période n'a de sens que si l'historique remonte plus loin que la période plus courte.
        const oldest = history[0]?.date ?? today;
        const useful = (id: string) => id === '90' || id === '0' || oldest < addDays(today, id === '365' ? -90 : -365);
        const chosen = range && useful(range) ? range : useful('365') ? '365' : '90';
        const since = chosen === '0' ? '0000-00-00' : addDays(today, -Number(chosen));
        const series = [...history.filter((h) => h.date >= since && h.date < today), { date: today, net: worth.net }];
        const first = series[0]!;
        const change = worth.net - first.net;
        const ref = [...history].reverse().find((h) => h.date <= addDays(today, -30));
        const month = ref ? worth.net - ref.net : null;
        const families = FAMILIES.map((f) => ({ ...f, value: sums[f.id], accounts: accounts.filter((a) => familyOf(a) === f.id) })).filter((f) => f.accounts.length > 0);
        const blocks = families.filter((f) => f.id !== 'dettes' && f.value > 0).sort((a, b) => b.value - a.value);
        const pct = (v: number) => Math.round((v / (gross || 1)) * 100);
        const gainOf = (a: Account) => {
          const lines = data.holdings.filter((h) => h.accountId === a.id).map((h) => position(h, data.investmentOps));
          const invested = lines.reduce((s, p) => s + p.invested, 0);
          return invested > 0 ? lines.reduce((s, p) => s + p.gain, 0) / invested : null;
        };
        const goals = data.goals.filter((g) => !g.achievedAt).map((g) => {
          const have = g.accountId ? valueOf(db.accounts.find((a) => a.id === g.accountId) ?? ({ balance: 0, ownershipRatio: 1 } as Account)) : data.goalMoves.filter((m) => m.goalId === g.id).reduce((s, m) => s + m.amount, 0);
          return { goal: g, have, fraction: g.target > 0 ? have / g.target : 0 };
        });
        // « À ce rythme ». Dès qu'un placement a sa propre simulation, la projection additionne celles des comptes
        // qui rapportent (les leurs, ou les valeurs par défaut) ; sinon, une seule hypothèse pour tout ce qui est placé.
        const rate = state.projectionRateBp ?? 500;
        const planned = e.occurrences.filter((o) => o.commitment.kind === 'SAVING').reduce((s, o) => s + (o.status === 'SKIPPED' ? 0 : o.expected), 0);
        const monthly = state.projectionMonthly ?? planned;
        const earning = accounts.filter(canSimulate).map((a) => ({ value: valueOf(a), sim: simulationOf(db, state, a) }));
        const detailed = accounts.some((a) => canSimulate(a) && state.simulations?.[a.id]);
        const at = (years: number, shift = 0) => (detailed ? projectAccounts(worth.net, earning, years, shift) : project(worth.net, sums.placements, monthly, Math.max(0, rate + shift), years));
        const paidMonthly = detailed ? earning.reduce((s, a) => s + a.sim.monthly, 0) : monthly;
        const custom = state.projectionMonthly != null && state.projectionMonthly !== planned;
        return (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="fin-num" style={{ fontSize: 48, lineHeight: 1.05 }}>{short(worth.net)}</span>
              <span className="t-small">
                {month !== null ? <span className={month >= 0 ? 'c-ok' : ''} style={{ fontWeight: 600, color: month < 0 ? 'var(--warn)' : undefined }}>{euros(month, { round: true, sign: true })} en 30 jours</span> : <span className="muted">Tous tes comptes, moins tes dettes</span>}
              </span>
            </div>
            {series.length >= 2 ? (
              <Glass style={{ padding: '12px 12px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="segmented" role="group" aria-label="Période">
                  {RANGES.map((r) => (
                    <button key={r.id} type="button" aria-pressed={chosen === r.id} disabled={!useful(r.id)} title={useful(r.id) ? undefined : 'Ton historique ne remonte pas encore aussi loin'} onClick={() => setRange(r.id)}>
                      {r.label}
                    </button>
                  ))}
                </div>
                <div className="row" style={{ justifyContent: 'space-between', padding: '0 4px', flexWrap: 'wrap', gap: 4 }}>
                  <span className="t-small muted">{dated(first.date, { day: 'numeric', month: 'short', year: 'numeric' })} → aujourd’hui</span>
                  <span className={`t-small ${change >= 0 ? 'c-ok' : ''}`} style={{ fontWeight: 700, color: change < 0 ? 'var(--warn)' : undefined }}>
                    {euros(change, { round: true, sign: true })}
                    {first.net > 0 ? ` · ${((change / first.net) * 100).toFixed(1).replace('.', ',')} %` : ''}
                  </span>
                </div>
                <WorthChart
                  points={series.map((x) => ({ date: x.date, value: x.net }))}
                  format={kilo}
                  dayLabel={(d) => dated(d, { day: 'numeric', month: 'short', year: d.slice(0, 4) === today.slice(0, 4) ? undefined : '2-digit' })}
                  tickLabel={(d) => dated(d, chosen === '90' ? { day: 'numeric', month: 'short' } : { month: 'short', year: '2-digit' })}
                  label={`Évolution du patrimoine net, de ${short(first.net)} le ${dated(first.date, { day: 'numeric', month: 'long', year: 'numeric' })} à ${short(worth.net)} aujourd’hui`}
                />
                <span className="t-small muted" style={{ padding: '0 4px' }}>Glisse le doigt sur la courbe pour lire une date.</span>
              </Glass>
            ) : (
              <span className="t-small muted">La courbe se dessinera au fil des jours : il faut au moins deux relevés.</span>
            )}

            <Sec action={families.length ? `${short(gross)} d’avoirs${sums.dettes > 0 ? ` · dettes ${short(-sums.dettes)}` : ''}` : undefined}>Tes comptes</Sec>
            {families.length === 0 ? (
              <Glass style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span className="t-card">Aucun compte pour l’instant</span>
                <span className="t-small muted">Relie ta banque, ou ajoute un compte tenu à la main : un livret, un placement, un bien, une dette.</span>
              </Glass>
            ) : (
              <Glass className="list" style={{ padding: '16px 16px 4px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {blocks.length > 0 && (
                  <div className="fin-split" role="img" aria-label={`Répartition : ${blocks.map((b) => `${b.name} ${pct(b.value)} %`).join(', ')}`}>
                    {blocks.map((b) => (
                      <span key={b.id} style={{ flex: b.value, background: b.color }} />
                    ))}
                  </div>
                )}
                <div>
                  {families.map((f) => {
                    const delta = familyChange(db, data, f.id, f.value, today);
                    // Pour une dette, baisser est une bonne nouvelle.
                    const good = delta !== null && (f.id === 'dettes' ? delta <= 0 : delta >= 0);
                    const shown = open === f.id;
                    return (
                      <div key={f.id} className="fin-family" data-open={shown}>
                        <button type="button" className="list-row" aria-expanded={shown} onClick={() => setOpen(shown ? null : f.id)}>
                          <span className="fin-dot" style={{ background: f.dot, width: 12, height: 12 }} />
                          <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
                            <span className="t-strong">{f.name}</span>
                            <span className="t-small muted">
                              {f.accounts.length} compte{f.accounts.length > 1 ? 's' : ''}
                              {f.id !== 'dettes' && gross > 0 ? ` · ${pct(f.value)} %` : ''}
                            </span>
                          </span>
                          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                            <span className="t-strong">{short(f.id === 'dettes' ? -f.value : f.value)}</span>
                            {delta !== null && delta !== 0 && <span className={`t-small ${good ? 'c-ok' : ''}`} style={{ fontWeight: 600, color: good ? undefined : 'var(--warn)' }}>{euros(delta, { round: true, sign: true })} en 30 j</span>}
                          </span>
                          <span className="fin-chevron"><Icon name="chevron" size={16} /></span>
                        </button>
                        <div className="fin-fold">
                          <div>
                            {f.accounts.map((a) => {
                              const gain = gainOf(a);
                              return (
                                <Link key={a.id} to={`/argent/patrimoine/compte/${encodeURIComponent(a.id)}`} className="list-row fin-account" tabIndex={shown ? 0 : -1}>
                                  <span className="grow" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                    <span className="t-body" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                                    <span className="t-small muted">{[a.provider || null, a.source === 'manual' ? 'tenu à la main' : null, gain !== null ? `${gain >= 0 ? '+' : ''}${(gain * 100).toFixed(1).replace('.', ',')} %` : null].filter(Boolean).join(' · ') || 'Voir la fiche'}</span>
                                  </span>
                                  <span className="t-strong">{a.balance === null ? '?' : short(f.id === 'dettes' ? -valueOf(a) : valueOf(a))}</span>
                                  <Icon name="chevron" size={14} />
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {worth.receivables > 0 && (
                    <div className="list-row">
                      <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}><span className="t-strong">Avances à récupérer</span><span className="t-small muted">Ce qu’on te doit</span></span>
                      <span className="t-strong">{short(worth.receivables)}</span>
                    </div>
                  )}
                  {worth.installments > 0 && (
                    <div className="list-row">
                      <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}><span className="t-strong">Paiements en plusieurs fois</span><span className="t-small muted">Ce qu’il reste à payer</span></span>
                      <span className="t-strong">{short(-worth.installments)}</span>
                    </div>
                  )}
                </div>
              </Glass>
            )}
            <Button block icon="plus" onClick={() => setParams({ ajouter: '1' }, { replace: true })}>Ajouter un compte</Button>

            {goals.length > 0 && (
              <>
                <Sec>Objectifs</Sec>
                {goals.map(({ goal, have, fraction }) => (
                  <Glass key={goal.id} className="row" style={{ padding: '12px 16px' }}>
                    <MiniRing fraction={fraction} color="#5ccbe6" size={56} label={`${goal.name} : ${Math.round(fraction * 100)} % atteint`} />
                    <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
                      <span className="t-strong">{goal.name}</span>
                      <span className="t-small muted">
                        {short(have)} sur {short(goal.target)}
                        {goal.deadline ? ` · ${new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(`${goal.deadline}T12:00:00`))}` : ''}
                      </span>
                    </span>
                  </Glass>
                ))}
              </>
            )}

            <Sec action={detailed ? `${short(paidMonthly)} par mois, selon tes placements` : custom ? `Revenir au plan (${short(planned)})` : `ton plan prévoit ${short(planned)} par mois`} onAction={!detailed && custom ? () => update((s) => ({ ...s, projectionMonthly: null })) : undefined}>À ce rythme</Sec>
            <Glass style={{ padding: '16px 16px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {detailed ? (
                <span className="t-small muted">La projection additionne la simulation de chaque compte qui rapporte (versement, rendement, frais) : ouvre un compte pour régler la sienne.</span>
              ) : (
                <div className="grid-2">
                  <Amount id="proj-monthly" label="Je place chaque mois" unit="€" max={1000000} value={monthly / 100} onChange={(v) => update((s) => ({ ...s, projectionMonthly: Math.round(v * 100) }))} />
                  <Amount id="proj-rate" label="Rendement annuel" unit="%" max={30} value={rate / 100} onChange={(v) => update((s) => ({ ...s, projectionRateBp: Math.round(v * 100) }))} />
                </div>
              )}
              <ConeChart now={worth.net} marks={[1, 5, 10].map((years) => ({ years, value: at(years) }))} low={at(10, -200)} high={at(10, 200)} format={kilo} />
              <div className="fin-proj">
                <span>
                  <span className="t-small muted">Versé en 10 ans</span>
                  <span className="fin-num" style={{ fontSize: 17 }}>{short(paidMonthly * 120)}</span>
                </span>
                <span>
                  <span className="t-small muted">Gagné par le rendement</span>
                  <span className="fin-num c-ok" style={{ fontSize: 17 }}>{short(Math.max(0, at(10) - worth.net - paidMonthly * 120))}</span>
                </span>
              </div>
              <span className="t-small muted">Une hypothèse, pas une promesse : le cône montre deux points de rendement en plus ou en moins.</span>
            </Glass>

            <AccountSheet
              value={adding ? 'new' : null}
              onClose={stopAdding}
              onPatch={(id, patch) => update((s) => patchAccount(s, id, patch))}
              onCreate={(a) => {
                update((s) => addAccount(s, a));
                stopAdding();
              }}
            />
          </>
        );
      }}
    </Screen>
  );
}
