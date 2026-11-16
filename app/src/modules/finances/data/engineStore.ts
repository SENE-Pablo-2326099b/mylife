import { useCallback, useEffect, useRef, useState } from 'react';
import { localToday } from '@mylife/lumen';
import type { FinanceData } from '../core/model';
import { compute, type Explanation } from '../engine/engine';
import { fromV3 } from '../engine/fromV3';
import type { Db } from '../engine/schema';
import { applyState, initState, roll, type EngineState } from '../engine/state';
import { db as store, loadAll, loadOverrides } from './db';
import { importOld, lastImport } from './importOld';

/**
 * Le moteur branché sur l'appareil : les faits viennent de la reprise de l'ancienne app, les réglages de
 * l'utilisateur (`EngineState`) sont gardés dans la base locale. À chaque ouverture et à chaque changement, le moteur
 * « fait passer le temps » (`roll` : clôtures, cotisations) puis recalcule.
 */
const KEY = 'engineState';

export interface Engine {
  status: 'loading' | 'empty' | 'ready' | 'error';
  error: string | null;
  today: string;
  /** Les données reprises (placements, objectifs, historique du patrimoine). */
  data: FinanceData | null;
  /** Les faits seuls (sans les réglages). */
  base: Db | null;
  db: Db | null;
  state: EngineState | null;
  explanation: Explanation | null;
  /** Dernière lecture de l'ancienne app. */
  at: number | null;
  busy: boolean;
  update: (change: (s: EngineState) => EngineState) => void;
  reload: () => void;
}

export function useEngine(): Engine {
  const today = localToday();
  const [status, setStatus] = useState<Engine['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState<Db | null>(null);
  const [data, setData] = useState<FinanceData | null>(null);
  const [state, setState] = useState<EngineState | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef<{ base: Db; state: EngineState } | null>(null);

  const load = useCallback(
    async (fresh: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const when = fresh ? null : await lastImport();
        let data: FinanceData;
        if (when === null) {
          const r = await importOld();
          data = r.data;
          if (r.empty && data.accounts.length === 0) {
            setStatus('empty');
            return;
          }
          if (!r.empty) setAt(r.at);
        } else {
          data = await loadAll();
          setAt(when);
        }
        const nextBase = fromV3(data);
        const saved = (await store.meta.get(KEY))?.value as EngineState | undefined;
        // Premier lancement du moteur : ses réglages de départ, et les décisions prises à l'étape M1.
        const start = saved?.version === 1 ? saved : { ...initState(nextBase), occurrenceOverrides: await loadOverrides() };
        const rolled = roll(start, nextBase, today);
        if (rolled !== saved) await store.meta.put({ key: KEY, value: rolled });
        live.current = { base: nextBase, state: rolled };
        setData(data);
        setBase(nextBase);
        setState(rolled);
        setStatus('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      } finally {
        setBusy(false);
      }
    },
    [today],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const update = useCallback(
    (change: (s: EngineState) => EngineState) => {
      const cur = live.current;
      if (!cur) return;
      const next = roll(change(cur.state), cur.base, today);
      live.current = { base: cur.base, state: next };
      setState(next);
      void store.meta.put({ key: KEY, value: next });
    },
    [today],
  );

  const db = base && state ? applyState(base, state) : null;
  return { status, error, today, data, base, db, state, explanation: db ? compute(db, today) : null, at, busy, update, reload: () => void load(true) };
}
