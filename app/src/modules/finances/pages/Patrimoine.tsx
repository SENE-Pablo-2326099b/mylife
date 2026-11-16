import { useEffect, useState } from 'react';
import { Button, Field, Glass, List, ListRow } from '@mylife/kit';
import { position } from '../core/budget';
import { addDays } from '../core/dates';
import { euros } from '../core/format';
import { useEngine } from '../data/engineStore';
import { netWorth } from '../engine/engine';
import type { Account } from '../engine/schema';
import { addAccount, patchAccount } from '../engine/state';
import { project } from '../engine/views';
import { ConeChart, MiniRing, WorthChart } from './charts';
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
const dated = (iso: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-FR', options).format(new Date(`${iso}T12:00:00`));

/** Un nombre saisi au clavier (virgule ou point), enregistré dès qu'il est valide ; il suit la valeur venue d'ailleurs. */
function Amount({ id, label, value, unit, max, onChange }: { id: string; label: string; value: number; unit: string; max: number; onChange: (v: number) => void }) {
  const show = (v: number) => String(v).replace('.', ',');
  const [text, setText] = useState(show(value));
  useEffect(() => {
    setText((t) => (Number(t.replace(',', '.')) === value ? t : show(value)));
  }, [value]);
  return (
    <Field id={id} label={`${label} (${unit})`}>
      <input
        id={id}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value.replace(/\s/g, '').replace(',', '.'));
          if (e.target.value.trim() && Number.isFinite(n) && n >= 0 && n <= max) onChange(n);
        }}
      />
    </Field>
  );
}
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
  const [range, setRange] = useState<(typeof RANGES)[number]['id'] | null>(null);
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
        // Une période n'a de sens que si l'historique remonte plus loin que la période plus courte.
        const oldest = history[0]?.date ?? today;
        const useful = (id: string) => id === '90' || id === '0' || oldest < addDays(today, id === '365' ? -90 : -365);
        const chosen = range && useful(range) ? range : useful('365') ? '365' : '90';
        const since = chosen === '0' ? '0000-00-00' : addDays(today, -Number(chosen));
        const series = [...history.filter((h) => h.date >= since && h.date < today), { date: today, net: worth.net }];
        const first = series[0]!;
        const change = worth.net - first.net;
        const delta = (days: number) => {
          const ref = [...history].reverse().find((h) => h.date <= addDays(today, -days));
          return ref ? worth.net - ref.net : null;
        };
        const month = delta(30);
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
        const planned = e.occurrences.filter((o) => o.commitment.kind === 'SAVING').reduce((s, o) => s + (o.status === 'SKIPPED' ? 0 : o.expected), 0);
        const monthly = state.projectionMonthly ?? planned;
        const at = (years: number, bp = rate) => project(worth.net, sums.placements, monthly, bp, years);
        const edited: Account | 'new' | null = account === 'new' ? 'new' : (db.accounts.find((a) => a.id === account) ?? null);
        return (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="fin-num" style={{ fontSize: 48, lineHeight: 1.05 }}>{short(worth.net)}</span>
              <span className="t-small">
                {month !== null ? <span className={month >= 0 ? 'c-ok' : ''} style={{ fontWeight: 600, color: month < 0 ? 'var(--warn)' : undefined }}>{euros(month, { round: true, sign: true })} en 30 jours</span> : <span className="muted">Net, dettes déduites</span>}
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

            {blocks.length > 0 && (
              <>
                <Sec action={`${short(gross)} d’avoirs${sums.dettes > 0 ? ` · dettes ${short(-sums.dettes)}` : ''}`}>Répartition</Sec>
                <Glass className="list" style={{ padding: '16px 16px 4px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="fin-split" role="img" aria-label={`Répartition : ${blocks.map((b) => `${b.name} ${pct(b.value)} %`).join(', ')}`}>
                    {blocks.map((b) => (
                      <span key={b.id} style={{ flex: b.value, background: b.color }} />
                    ))}
                  </div>
                  <div>
                    {blocks.map((b) => (
                      <div key={b.id} className="list-row">
                        <span className="fin-dot" style={{ background: b.dot, width: 12, height: 12 }} />
                        <span className="grow t-strong">{b.name}</span>
                        <span className="t-small muted">{pct(b.value)} %</span>
                        <span className="t-strong" style={{ minWidth: 84, textAlign: 'right' }}>{short(b.value)}</span>
                      </div>
                    ))}
                  </div>
                </Glass>
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

            <Sec action={state.projectionMonthly != null && state.projectionMonthly !== planned ? `Revenir au plan (${short(planned)})` : `ton plan prévoit ${short(planned)} par mois`} onAction={state.projectionMonthly != null && state.projectionMonthly !== planned ? () => update((s) => ({ ...s, projectionMonthly: null })) : undefined}>À ce rythme</Sec>
            <Glass style={{ padding: '16px 16px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="grid-2">
                <Amount id="proj-monthly" label="Je place chaque mois" unit="€" max={1000000} value={monthly / 100} onChange={(v) => update((s) => ({ ...s, projectionMonthly: Math.round(v * 100) }))} />
                <Amount id="proj-rate" label="Rendement annuel" unit="%" max={30} value={rate / 100} onChange={(v) => update((s) => ({ ...s, projectionRateBp: Math.round(v * 100) }))} />
              </div>
              <ConeChart now={worth.net} marks={[1, 5, 10].map((years) => ({ years, value: at(years) }))} low={at(10, Math.max(0, rate - 200))} high={at(10, rate + 200)} format={kilo} />
              <div className="fin-proj">
                <span>
                  <span className="t-small muted">Versé en 10 ans</span>
                  <span className="fin-num" style={{ fontSize: 17 }}>{short(monthly * 120)}</span>
                </span>
                <span>
                  <span className="t-small muted">Gagné par le rendement</span>
                  <span className="fin-num c-ok" style={{ fontSize: 17 }}>{short(Math.max(0, at(10) - worth.net - monthly * 120))}</span>
                </span>
              </div>
              <span className="t-small muted">Une hypothèse, pas une promesse : le rendement s’applique à ce qui est placé, et le cône montre deux points en plus ou en moins.</span>
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
