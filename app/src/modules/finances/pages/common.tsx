import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, IconButton, Notice } from '@mylife/kit';
import type { FinanceData } from '../core/model';
import type { Engine } from '../data/engineStore';
import type { Explanation } from '../engine/engine';
import type { Db } from '../engine/schema';
import type { EngineState } from '../engine/state';
import type { OpView } from './opViews';
import '../finances.css';

/** Ce que reçoit un écran une fois les données prêtes. */
export interface Ready {
  db: Db;
  state: EngineState;
  e: Explanation;
  data: FinanceData;
  today: string;
  update: Engine['update'];
  engine: Engine;
}

/**
 * Le cadre commun des écrans de MyFinances : l'en-tête (retour vers MyLife, titre, action), l'ambiance de l'écran,
 * et les trois états d'attente (lecture, rien à lire, erreur). L'écran lui-même ne s'affiche que quand tout est prêt.
 */
export function Screen({ engine, tone, kicker, title, right, children }: { engine: Engine; tone: 'jour' | 'ops' | 'plan' | 'worth'; kicker?: string; title: string; right?: ReactNode; children: (r: Ready) => ReactNode }) {
  const { db, state, explanation: e, data } = engine;
  return (
    <div className={`fin-screen fin-${tone} tone-finances`}>
      <header className="fin-head">
        <div className="row" style={{ gap: 12, alignItems: 'center', minWidth: 0 }}>
          <IconButton icon="back" label="Retour à MyLife" href="/" />
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {kicker && <span className="t-small muted">{kicker}</span>}
            <h1 className="t-screen">{title}</h1>
          </div>
        </div>
        {right}
      </header>
      {engine.status === 'error' ? (
        <>
          <Notice tone="bad">La lecture de tes données a échoué : {engine.error}</Notice>
          <Button onClick={engine.reload}>Réessayer</Button>
        </>
      ) : engine.status === 'empty' ? (
        <EmptyState title="Rien à montrer pour l’instant" body="MyFinances n’a pas encore de données sur cet appareil. Ouvre-la une fois, puis reviens." action={<Button href="/finances/">Ouvrir MyFinances</Button>} />
      ) : !db || !state || !e || !data ? (
        <span className="t-small muted">Lecture de tes données…</span>
      ) : (
        children({ db, state, e, data, today: engine.today, update: engine.update, engine })
      )}
    </div>
  );
}

export function Sec({ children, action, to, onAction }: { children: ReactNode; action?: ReactNode; to?: string; onAction?: () => void }) {
  return (
    <div className="fin-sec">
      <span>{children}</span>
      {action && to ? (
        <Link to={to} className="link">
          {action}
        </Link>
      ) : action && onAction ? (
        <button type="button" className="link" onClick={onAction}>
          {action}
        </button>
      ) : (
        action && <span>{action}</span>
      )}
    </div>
  );
}

/** La pastille d'une opération : la couleur de sa catégorie et l'initiale de son marchand. */
export function Avatar({ op }: { op: Pick<OpView, 'color' | 'letter' | 'unclassified' | 'tag'> }) {
  if (op.tag === 'Virement' || op.tag === 'Mise de côté')
    return (
      <span className="fin-av fin-av-plain" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 8h14l-3-3M20 16H6l3 3" />
        </svg>
      </span>
    );
  return (
    <span className={`fin-av${op.color ? '' : ' fin-av-plain'}`} style={op.color ? { background: op.color } : op.unclassified ? { borderStyle: 'dashed' } : undefined} aria-hidden="true">
      {op.unclassified && !op.color ? '?' : op.letter}
    </span>
  );
}
