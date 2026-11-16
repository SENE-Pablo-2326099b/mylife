import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Button, Glass, List, ListRow } from '@mylife/kit';
import { position } from '../core/budget';
import { euros } from '../core/format';
import { useEngine } from '../data/engineStore';
import { patchAccount, type EngineState } from '../engine/state';
import { simulate, type Simulation } from '../engine/views';
import { SimChart } from './charts';
import { Avatar, Screen, Sec } from './common';
import { Amount } from './fields';
import { day, ROLE } from './labels';
import { opViews } from './opViews';
import { AccountSheet } from './sheets';
import { FAMILIES, canSimulate, familyOf, plannedMonthly, simulationOf, valueOf } from './worth';

/**
 * La fiche d'un compte : ce qu'il vaut, ses caractéristiques, sa performance (lignes d'un placement), sa simulation
 * (versement mensuel, rendement, horizon, frais : intérêts composés nets de frais), et ses dernières opérations.
 */
const short = (v: number) => euros(v, { round: true });
const kilo = (v: number) => (Math.abs(v) >= 1000000 ? `${Math.round(v / 100000)} k€` : short(v));
const OPS = { buy: 'Achat', sell: 'Vente', adjust: 'Recalage', dividend: 'Dividende' } as Record<string, string>;

export function ComptePage() {
  const engine = useEngine();
  const { id } = useParams();
  const [editing, setEditing] = useState(false);
  const account = engine.db?.accounts.find((a) => a.id === id);
  if (engine.db && !account) return <Navigate to="/argent/patrimoine" replace />;
  return (
    <Screen engine={engine} tone="worth" title={account?.name ?? 'Compte'} kicker="Patrimoine" back="/argent/patrimoine" right={account ? <Button onClick={() => setEditing(true)}>Modifier</Button> : undefined}>
      {({ db, state, data, update }) => {
        const a = db.accounts.find((x) => x.id === id);
        if (!a) return null;
        const family = FAMILIES.find((f) => f.id === familyOf(a))!;
        const debt = family.id === 'dettes';
        const lines = data.holdings.filter((h) => h.accountId === a.id).map((h) => position(h, data.investmentOps));
        const invested = lines.reduce((s, p) => s + p.invested, 0);
        const gain = lines.reduce((s, p) => s + p.gain, 0);
        const sim = simulationOf(db, state, a);
        const own = state.simulations?.[a.id];
        const set = (patch: Partial<Simulation>) => update((s: EngineState) => ({ ...s, simulations: { ...s.simulations, [a.id]: { ...s.simulations?.[a.id], ...patch } } }));
        const reset = () =>
          update((s: EngineState) => {
            const rest = { ...s.simulations };
            delete rest[a.id];
            return { ...s, simulations: rest };
          });
        const points = simulate(valueOf(a), sim);
        const end = points[points.length - 1]!;
        const holdingName = new Map(data.holdings.map((h) => [h.id, h.name]));
        const moves = data.investmentOps.filter((o) => holdingName.has(o.holdingId) && data.holdings.find((h) => h.id === o.holdingId)?.accountId === a.id).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 12);
        const ops = opViews(db).filter((o) => o.tx.accountId === a.id).sort((x, y) => y.tx.date.localeCompare(x.tx.date)).slice(0, 12);
        const planned = plannedMonthly(db, a.id);
        return (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="fin-num" style={{ fontSize: 44, lineHeight: 1.05 }}>{a.balance === null ? '?' : short(debt ? -valueOf(a) : valueOf(a))}</span>
              <span className="t-small">
                {invested > 0 ? (
                  <span className={gain >= 0 ? 'c-ok' : ''} style={{ fontWeight: 600, color: gain < 0 ? 'var(--warn)' : undefined }}>
                    {euros(gain, { round: true, sign: true })} · {((gain / invested) * 100).toFixed(1).replace('.', ',')} % <span className="muted" style={{ fontWeight: 400 }}>sur {short(invested)} investis</span>
                  </span>
                ) : (
                  <span className="muted">{family.name}{a.provider ? ` · ${a.provider}` : ''}</span>
                )}
              </span>
            </div>

            <Sec>Caractéristiques</Sec>
            <List>
              <ListRow title="Nature" value={ROLE[a.role] === family.name ? family.name : `${family.name} · ${ROLE[a.role]}`} />
              {a.provider && <ListRow title="Établissement" value={a.provider} />}
              <ListRow title="Suivi" value={a.source === 'manual' ? 'Tenu à la main' : 'Relié à la banque'} />
              <ListRow title="Compte dans le budget du jour" value={a.includeInDailyCash ? 'Oui' : 'Non'} />
              {a.ownershipRatio !== 1 && <ListRow title="Ta part" value={`${Math.round(a.ownershipRatio * 100)} %`} />}
              {planned > 0 && <ListRow title="Versement prévu au plan" value={`${short(planned)} par mois`} />}
            </List>

            {canSimulate(a) && (
              <>
                <Sec action={own ? 'Revenir aux valeurs par défaut' : undefined} onAction={own ? reset : undefined}>Simulation</Sec>
                <Glass style={{ padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="grid-2">
                    <Amount id="sim-monthly" label="Versement mensuel" unit="€" max={1000000} value={sim.monthly / 100} onChange={(v) => set({ monthly: Math.round(v * 100) })} />
                    <Amount id="sim-rate" label="Rendement annuel" unit="%" max={30} value={sim.rateBp / 100} onChange={(v) => set({ rateBp: Math.round(v * 100) })} />
                    <Amount id="sim-years" label="Horizon" unit="ans" max={60} value={sim.years} onChange={(v) => set({ years: Math.max(1, Math.round(v)) })} />
                    <Amount id="sim-fee" label="Frais de gestion" unit="%/an" max={10} value={sim.annualFeeBp / 100} onChange={(v) => set({ annualFeeBp: Math.round(v * 100) })} />
                    <Amount id="sim-entry" label="Frais d’entrée" unit="%" max={20} value={sim.entryFeeBp / 100} onChange={(v) => set({ entryFeeBp: Math.round(v * 100) })} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span className="t-small muted">Dans {sim.years} an{sim.years > 1 ? 's' : ''}, net de frais</span>
                    <span className="fin-num" style={{ fontSize: 30, lineHeight: 1.1 }}>{short(end.value)}</span>
                  </div>
                  <SimChart points={points} format={kilo} label={`Simulation sur ${sim.years} ans : ${short(end.value)} nets de frais, dont ${short(end.paid)} versés et ${short(end.gains)} de plus-values ; les frais coûtent ${short(end.fees)}`} />
                  <div className="fin-proj" style={{ flexWrap: 'wrap' }}>
                    <span>
                      <span className="t-small muted"><i className="fin-key" style={{ background: '#5ccbe6' }} />Versé</span>
                      <span className="fin-num" style={{ fontSize: 16 }}>{short(end.paid)}</span>
                    </span>
                    <span>
                      <span className="t-small muted"><i className="fin-key" style={{ background: '#6fe0a0' }} />Plus-values</span>
                      <span className={`fin-num ${end.gains >= 0 ? 'c-ok' : ''}`} style={{ fontSize: 16 }}>{euros(end.gains, { round: true, sign: true })}</span>
                    </span>
                    <span>
                      <span className="t-small muted"><i className="fin-key" style={{ background: '#f472b6' }} />Coût des frais</span>
                      <span className="fin-num" style={{ fontSize: 16 }}>{short(end.fees)}</span>
                    </span>
                  </div>
                  <span className="t-small muted">Une hypothèse, pas une promesse. Le coût des frais compte aussi le rendement qu’ils t’ont fait perdre.</span>
                </Glass>
              </>
            )}

            {lines.length > 0 && (
              <>
                <Sec>Lignes</Sec>
                <List>
                  {lines.map((p) => (
                    <ListRow key={p.holding.id} title={p.holding.name} detail={p.invested > 0 ? `${short(p.invested)} investis · ${p.gain >= 0 ? '+' : ''}${((p.gain / p.invested) * 100).toFixed(1).replace('.', ',')} %` : undefined} value={short(p.value)} />
                  ))}
                </List>
                <a href="/finances/patrimoine" className="link link-quiet t-small" style={{ alignSelf: 'flex-start' }}>Ajouter une ligne ou un achat : dans l’ancienne app, le temps de la bascule</a>
              </>
            )}

            <Sec action={ops.length ? 'Toutes les opérations' : undefined} to="/argent/operations">Historique</Sec>
            {moves.length > 0 ? (
              <List>
                {moves.map((o) => (
                  <ListRow key={o.id} title={`${OPS[o.type] ?? o.type} · ${holdingName.get(o.holdingId)}`} detail={day(o.date)} value={short(o.amount)} />
                ))}
              </List>
            ) : ops.length > 0 ? (
              <Glass className="list" style={{ padding: '2px 16px' }}>
                {ops.map((o) => (
                  <Link key={o.tx.id} to={`/argent/operations?op=${encodeURIComponent(o.tx.id)}`} className="fin-op">
                    <Avatar op={o} />
                    <span className="grow" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span className="t-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
                      <span className="t-small muted">{day(o.tx.date)}</span>
                    </span>
                    <span className={`t-strong ${o.tx.amount > 0 ? 'c-ok' : ''}`}>{euros(o.tx.amount, { sign: o.tx.amount > 0 })}</span>
                  </Link>
                ))}
              </Glass>
            ) : (
              <span className="t-small muted">Aucune opération sur ce compte pour l’instant.</span>
            )}

            <AccountSheet value={editing ? a : null} onClose={() => setEditing(false)} onPatch={(aid, patch) => update((s) => patchAccount(s, aid, patch))} onCreate={() => setEditing(false)} />
          </>
        );
      }}
    </Screen>
  );
}
