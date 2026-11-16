import { useState } from 'react';
import { Button, Glass, List, ListRow, Segmented } from '@mylife/kit';
import { position } from '../core/budget';
import { addDays } from '../core/dates';
import { euros } from '../core/format';
import { useEngine } from '../data/engineStore';
import { netWorth } from '../engine/engine';
import type { Account } from '../engine/schema';
import { addAccount, patchAccount } from '../engine/state';
import { project } from '../engine/views';
import { AreaChart, ConeChart, MiniRing } from './charts';
import { Screen, Sec } from './common';
import { AccountSheet } from './sheets';

/**
 * Patrimoine : « combien j'ai, et ça progresse ? ». Le total net et sa courbe, la répartition en blocs
 * proportionnels, les comptes par famille, les placements et leur plus-value, les objectifs, et une projection
 * « à ce rythme » dans 1, 5 et 10 ans.
 */
const RANGES = [
  { id: '90', label: '3 mois' },
  { id: '365', label: '1 an' },
  { id: '1825', label: '5 ans' },
  { id: '0', label: 'Tout' },
] as const;
const RATES = [
  { id: '300', label: '3 %' },
  { id: '500', label: '5 %' },
  { id: '700', label: '7 %' },
] as const;
const FAMILIES = [
  { id: 'placements', name: 'Placements', color: 'linear-gradient(135deg,#9bf0b7,#2fb36a)', dot: '#6fe0a0' },
  { id: 'epargne', name: 'Épargne', color: 'linear-gradient(135deg,#7fe6f7,#1da6cc)', dot: '#5ccbe6' },
  { id: 'biens', name: 'Biens', color: 'linear-gradient(135deg,#ffb07a,#f0601c)', dot: '#ff9a62' },
  { id: 'quotidien', name: 'Quotidien', color: 'linear-gradient(135deg,#cdbeff,#7b5cff)', dot: '#a58bff' },
] as const;
type Family = (typeof FAMILIES)[number]['id'] | 'dettes';
const familyOf = (a: Account): Family => (a.role === 'LIABILITY' ? 'dettes' : a.includeInDailyCash ? 'quotidien' : a.role === 'INVESTMENT' ? 'placements' : a.role === 'ASSET' ? 'biens' : 'epargne');
const short = (v: number) => euros(v, { round: true });
const kilo = (v: number) => (Math.abs(v) >= 1000000 ? `${Math.round(v / 100000)} k€` : short(v));

export function PatrimoinePage() {
  const engine = useEngine();
  const [range, setRange] = useState<(typeof RANGES)[number]['id']>('365');
  const [account, setAccount] = useState<string | 'new' | null>(null);
  return (
    <Screen engine={engine} tone="worth" title="Patrimoine" kicker="Tous tes comptes, moins tes dettes" right={<Button onClick={() => setAccount('new')}>Ajouter</Button>}>
      {({ db, state, data, e, today, update }) => {
        const worth = netWorth(db, today);
        const accounts = db.accounts.filter((a) => !a.archivedAt && a.includeInNetWorth);
        const value = (a: Account) => Math.round((a.balance ?? 0) * a.ownershipRatio);
        const sums = Object.fromEntries(['placements', 'epargne', 'biens', 'quotidien', 'dettes'].map((f) => [f, accounts.filter((a) => familyOf(a) === f).reduce((s, a) => s + value(a), 0)])) as Record<Family, number>;
        const gross = sums.placements + sums.epargne + sums.biens + sums.quotidien;
        // L'historique : une photo par jour, prise par l'ancienne app ; aujourd'hui s'y ajoute.
        const history = [...data.snapshots].sort((a, b) => a.date.localeCompare(b.date)).map((s) => ({ date: s.date, net: s.cash + s.investments + s.other - s.debts }));
        const since = range === '0' ? '0000-00-00' : addDays(today, -Number(range));
        const series = [...history.filter((h) => h.date >= since && h.date < today), { date: today, net: worth.net }];
        const delta = (days: number) => {
          const ref = [...history].reverse().find((h) => h.date <= addDays(today, -days));
          return ref ? worth.net - ref.net : null;
        };
        const month = delta(30);
        const year = delta(365);
        const blocks = FAMILIES.map((f) => ({ ...f, value: sums[f.id] })).filter((b) => b.value > 0).sort((a, b) => b.value - a.value);
        const pct = (v: number) => Math.round((v / (gross || 1)) * 100);
        // Les placements : la valeur de leurs lignes, et ce qu'elles ont rapporté.
        const placements = accounts.filter((a) => a.role === 'INVESTMENT').map((a) => {
          const lines = data.holdings.filter((h) => h.accountId === a.id).map((h) => position(h, data.investmentOps));
          const invested = lines.reduce((s, p) => s + p.invested, 0);
          const gain = lines.reduce((s, p) => s + p.gain, 0);
          const planned = db.commitments.filter((c) => c.kind === 'SAVING' && !c.paused && c.counterAccountId === a.id).reduce((s, c) => s + (c.rhythm === 'WEEKLY' ? Math.round((c.amount * 52) / 12) : c.rhythm === 'BIWEEKLY' ? Math.round((c.amount * 26) / 12) : c.amount), 0);
          return { account: a, lines: lines.length, invested, gain, planned };
        });
        const totalGain = placements.reduce((s, p) => s + p.gain, 0);
        const totalInvested = placements.reduce((s, p) => s + p.invested, 0);
        const goals = data.goals.filter((g) => !g.achievedAt).map((g) => {
          const have = g.accountId ? value(db.accounts.find((a) => a.id === g.accountId) ?? ({ balance: 0, ownershipRatio: 1 } as Account)) : data.goalMoves.filter((m) => m.goalId === g.id).reduce((s, m) => s + m.amount, 0);
          return { goal: g, have, fraction: g.target > 0 ? have / g.target : 0 };
        });
        // « À ce rythme » : ce que le plan met de côté par cycle, au rendement choisi sur ce qui est placé.
        const rate = state.projectionRateBp ?? 500;
        const monthly = e.occurrences.filter((o) => o.commitment.kind === 'SAVING').reduce((s, o) => s + (o.status === 'SKIPPED' ? 0 : o.expected), 0);
        const at = (years: number, bp = rate) => project(worth.net, sums.placements, monthly, bp, years);
        const edited: Account | 'new' | null = account === 'new' ? 'new' : (db.accounts.find((a) => a.id === account) ?? null);
        return (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="fin-num" style={{ fontSize: 48, lineHeight: 1.05 }}>{short(worth.net)}</span>
              <span className="t-small">
                {month !== null ? <span className={month >= 0 ? 'c-ok' : ''} style={{ fontWeight: 600, color: month < 0 ? 'var(--warn)' : undefined }}>{euros(month, { round: true, sign: true })} en 30 jours</span> : <span className="muted">Net, dettes déduites</span>}
                {year !== null && <span className="muted"> · {euros(year, { round: true, sign: true })} sur un an</span>}
              </span>
            </div>
            {series.length >= 2 ? (
              <>
                <AreaChart values={series.map((s) => s.net)} label={`Évolution du patrimoine net, de ${short(series[0]!.net)} à ${short(worth.net)}`} />
                <Segmented label="Période" value={range} options={RANGES} onChange={setRange} />
              </>
            ) : (
              <span className="t-small muted">La courbe se dessinera au fil des jours : il faut au moins deux relevés.</span>
            )}

            {blocks.length > 0 && (
              <>
                <Sec action={sums.dettes > 0 ? <span style={{ color: 'var(--bad)' }}>Dettes {short(-sums.dettes)}</span> : undefined}>Répartition</Sec>
                <div className="fin-tree" role="img" aria-label={`Répartition : ${blocks.map((b) => `${b.name} ${pct(b.value)} %`).join(', ')}`}>
                  <div className="fin-tm" style={{ flex: blocks[0]!.value, background: blocks[0]!.color }}>
                    <span>{blocks[0]!.name} · {pct(blocks[0]!.value)} %</span>
                    <b>{kilo(blocks[0]!.value)}</b>
                  </div>
                  {blocks.length > 1 && (
                    <div className="fin-tree-col" style={{ flex: gross - blocks[0]!.value }}>
                      <div className="fin-tm" style={{ flex: blocks[1]!.value, background: blocks[1]!.color }}>
                        <span>{blocks[1]!.name} · {pct(blocks[1]!.value)} %</span>
                        <b>{kilo(blocks[1]!.value)}</b>
                      </div>
                      {blocks.length > 2 && (
                        <div className="fin-tree-row" style={{ flex: blocks.slice(2).reduce((s, b) => s + b.value, 0) }}>
                          {blocks.slice(2).map((b) => (
                            <div key={b.id} className="fin-tm" style={{ flex: b.value, background: b.color, padding: 8 }} title={`${b.name} : ${short(b.value)}`}>
                              {/* Un bloc trop étroit garde sa couleur ; son montant est dans la liste des comptes. */}
                              {pct(b.value) >= 7 && (
                                <>
                                  <span>{b.name}</span>
                                  <b style={{ fontSize: 13 }}>{kilo(b.value)}</b>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {placements.length > 0 && (
              <>
                <Sec action={totalInvested > 0 ? <span className={totalGain >= 0 ? 'c-ok' : ''}>{euros(totalGain, { round: true, sign: true })} · {((totalGain / totalInvested) * 100).toFixed(1).replace('.', ',')} %</span> : undefined}>Placements</Sec>
                <List>
                  {placements.map((p) => (
                    <ListRow
                      key={p.account.id}
                      title={p.account.name}
                      detail={[p.lines ? `${p.lines} ligne${p.lines > 1 ? 's' : ''}` : null, p.planned ? `${short(p.planned)} par mois` : null].filter(Boolean).join(' · ') || undefined}
                      value={
                        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                          <span>{short(value(p.account))}</span>
                          {p.invested > 0 && <span className={`t-small ${p.gain >= 0 ? 'c-ok' : ''}`} style={{ fontWeight: 500, color: p.gain < 0 ? 'var(--warn)' : undefined }}>{((p.gain / p.invested) * 100).toFixed(1).replace('.', ',')} %</span>}
                        </span>
                      }
                      onClick={() => setAccount(p.account.id)}
                    />
                  ))}
                </List>
              </>
            )}

            <Sec>Comptes</Sec>
            <List>
              {[...FAMILIES.map((f) => ({ id: f.id as Family, name: f.name, dot: f.dot })), { id: 'dettes' as Family, name: 'Dettes', dot: '#ffb8b8' }]
                .filter((f) => accounts.some((a) => familyOf(a) === f.id))
                .flatMap((f) =>
                  accounts
                    .filter((a) => familyOf(a) === f.id)
                    .map((a) => (
                      <ListRow key={a.id} lead={<span className="fin-dot" style={{ background: f.dot, borderRadius: 999 }} />} title={a.name} detail={[f.name, a.provider || null, a.source === 'manual' && (a.role === 'CASH' || a.role === 'CHECKING') ? 'tenu à la main' : null].filter(Boolean).join(' · ')} value={a.balance === null ? '?' : short(f.id === 'dettes' ? -value(a) : value(a))} onClick={() => setAccount(a.id)} />
                    )),
                )}
              {worth.receivables > 0 && <ListRow title="Avances à récupérer" detail="Ce qu’on te doit" value={short(worth.receivables)} />}
              {worth.installments > 0 && <ListRow title="Paiements en plusieurs fois" detail="Ce qu’il reste à payer" value={short(-worth.installments)} />}
            </List>

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

            <Sec action={`${short(monthly)} mis de côté par cycle`}>À ce rythme</Sec>
            <Glass style={{ padding: '16px 16px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ConeChart now={worth.net} marks={[1, 5, 10].map((years) => ({ years, value: at(years) }))} low={at(10, Math.max(0, rate - 200))} high={at(10, rate + 200)} format={kilo} />
              <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
                <span className="t-small muted grow">Rendement annuel supposé de ce qui est placé</span>
                <div style={{ minWidth: 190 }}>
                  <Segmented label="Rendement annuel supposé" value={String(rate) as (typeof RATES)[number]['id']} options={RATES} onChange={(v) => update((s) => ({ ...s, projectionRateBp: Number(v) }))} />
                </div>
              </div>
              <span className="t-small muted">Une hypothèse, pas une promesse : le cône montre deux points de rendement en plus ou en moins.</span>
            </Glass>

            <AccountSheet
              value={edited}
              onClose={() => setAccount(null)}
              onPatch={(id, patch) => update((s) => patchAccount(s, id, patch))}
              onCreate={(a) => {
                update((s) => addAccount(s, a));
                setAccount(null);
              }}
            />
          </>
        );
      }}
    </Screen>
  );
}
