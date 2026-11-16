import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Glass } from '@mylife/kit';
import { euros } from '../core/format';
import { useEngine } from '../data/engineStore';
import { toClassify, type ToClassify } from '../engine/automation';
import { envelopeOf } from '../engine/engine';
import type { Flow } from '../engine/schema';
import { classifyAllocation, classifyMerchant } from '../engine/state';
import { byCategory, merchantMonths } from '../engine/views';
import { addDays } from '../core/dates';
import { MonthBars } from './charts';
import { Screen } from './common';
import { ClassifySheet } from './sheets';

/**
 * À classer, par marchand : on dit d'abord ce que c'est (une dépense, un revenu, un remboursement, un virement),
 * puis la catégorie si c'est une dépense. Un geste classe toutes les opérations du marchand, passées et à venir.
 */
const month = (key: string) => new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(new Date(`${key}-15T12:00:00`));
const INCOMING: readonly (readonly [Flow, string])[] = [['REFUND', 'Un remboursement'], ['INCOME', 'Un revenu'], ['TRANSFER', 'Un virement entre mes comptes']];

export function ClasserPage() {
  const engine = useEngine();
  const [other, setOther] = useState<ToClassify | null>(null);
  return (
    <Screen engine={engine} tone="ops" title="À classer" kicker="Un geste par marchand" right={<Button href="/argent/operations">Opérations</Button>}>
      {({ db, today, update }) => {
        const groups = toClassify(db);
        const categories = db.categories.filter((c) => !c.archivedAt && !c.mergedIntoId && c.scope === 'EXPENSE');
        // Les catégories les plus utilisées ces trois derniers mois, proposées d'abord.
        // (celles du budget quotidien : une charge fixe comme le loyer n'est presque jamais la bonne réponse).
        const usual = byCategory(db, addDays(today, -90), today).filter((x) => x.id !== null && envelopeOf(db, x.id).inDailyBudget).slice(0, 4);
        const quick = (usual.length ? usual.map((x) => ({ id: x.id!, name: x.name, color: x.color })) : categories.filter((c) => !c.parentId).slice(0, 4).map((c) => ({ id: c.id, name: c.name, color: c.color })));
        const apply = (g: ToClassify, flow: Flow, categoryId: string | null, whole = true) => update((s) => (whole && g.merchantId ? classifyMerchant(s, g.merchantId, flow, categoryId) : g.allocationIds.reduce((x, id) => classifyAllocation(x, id, flow, categoryId), s)));
        const sample = (g: ToClassify) => db.transactions.find((t) => t.id === db.allocations.find((a) => a.id === g.allocationIds[0])?.transactionId);
        if (groups.length === 0) return <EmptyState title="Tout est classé" body="Les prochaines opérations de tes marchands se classeront toutes seules." action={<Button href="/argent/operations">Voir les opérations</Button>} />;
        return (
          <>
            <span className="t-small muted">{groups.length} marchand{groups.length > 1 ? 's' : ''}, {groups.reduce((n, g) => n + g.count, 0)} opération{groups.reduce((n, g) => n + g.count, 0) > 1 ? 's' : ''}. D’abord ce que c’est, puis la catégorie, seulement pour une dépense.</span>
            <Link to="/argent/categories" className="link t-small" style={{ alignSelf: 'flex-start' }}>Gérer les catégories</Link>
            {groups.slice(0, 30).map((g, i) => {
              const incoming = g.total > 0;
              const tx = sample(g);
              const months = g.merchantId ? merchantMonths(db, g.merchantId, today, 4) : [];
              return (
                <Glass key={g.key} className={i === 0 ? 'card-module tone-finances' : undefined} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    <span className="fin-av fin-av-plain" style={{ width: 48, height: 48, borderRadius: 16, fontSize: 20 }} aria-hidden="true">{(g.name.trim()[0] ?? '?').toUpperCase()}</span>
                    <span className="grow" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span className="t-card" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                      <span className="t-small muted">{g.count} opération{g.count > 1 ? 's' : ''} · {euros(g.total, { sign: incoming })}</span>
                      {tx && tx.rawLabel !== g.name && <span className="t-small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.rawLabel}</span>}
                    </span>
                  </div>
                  {months.some((m) => m.amount > 0) && <MonthBars months={months.map((m) => ({ key: m.month, name: month(m.month), value: m.amount }))} label={`Dépenses chez ${g.name} sur les quatre derniers mois`} />}
                  <span className="t-small muted">{incoming ? 'De l’argent reçu : c’est…' : 'C’est une dépense de…'}</span>
                  <div className="fin-choices">
                    {incoming
                      ? INCOMING.map(([flow, label]) => (
                          <button key={flow} type="button" className="fin-choice" onClick={() => apply(g, flow, null, flow !== 'REFUND')}>
                            {label}
                          </button>
                        ))
                      : quick.map((c) => (
                          <button key={c.id} type="button" className="fin-choice" onClick={() => apply(g, 'EXPENSE', c.id)}>
                            <span className="fin-dot" style={{ background: c.color, borderRadius: 999 }} />
                            {c.name}
                          </button>
                        ))}
                    <button type="button" className="fin-choice" onClick={() => setOther(g)}>
                      Autre…
                    </button>
                  </div>
                </Glass>
              );
            })}
            <ClassifySheet
              group={other}
              categories={categories}
              onClose={() => setOther(null)}
              onSave={(g, flow, categoryId, whole) => {
                apply(g, flow, categoryId, whole);
                setOther(null);
              }}
            />
          </>
        );
      }}
    </Screen>
  );
}
