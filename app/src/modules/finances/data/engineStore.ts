import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { localToday, pendingActions, runPendingActions } from '@mylife/lumen';
import { maybeAutoSync } from '../bank/sync';
import { DEFAULT_CATEGORIES, EMPTY, type FinanceData } from '../core/model';
import { compute, type Explanation } from '../engine/engine';
import { fromV3 } from '../engine/fromV3';
import type { Db } from '../engine/schema';
import { applyState, initState, roll, type EngineState } from '../engine/state';
import { cloudBoot, dropForeign, stateToCome, syncCloud } from './cloud';
import { loadOverrides } from './db';
import { onFactsChanged } from './facts';
import { importOld } from './importOld';
import { actionChange, publish } from './publish';
import { onStateReplaced, readState, writeInitial, writeState } from './stateStore';
import { housekeeping } from './upkeep';

/**
 * Le moteur branché sur l'appareil : les faits viennent de la base des faits (`facts.ts` : banque, comptes,
 * placements), les réglages de l'utilisateur (`EngineState`) de la base du module. À chaque ouverture et à chaque
 * changement (une saisie, une synchro bancaire, un autre appareil), le moteur « fait passer le temps » (`roll` :
 * clôtures, cotisations) puis recalcule.
 */
let started = false;
/** Une fois par visite : la synchro entre appareils, la banque si elle date, l'entretien du patrimoine. */
function startBackground(): void {
  if (started) return;
  started = true;
  cloudBoot();
  void maybeAutoSync()
    .then(() => housekeeping())
    .catch(() => undefined);
}

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
  /** Dernière lecture des faits. */
  at: number | null;
  busy: boolean;
  update: (change: (s: EngineState) => EngineState) => void;
  reload: () => void;
  /** Premier lancement : pose les premiers réglages (un compte tenu à la main) sur un module encore vide. */
  begin: (change: (s: EngineState) => EngineState) => Promise<void>;
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

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await dropForeign();
      const r = await importOld();
      let saved = await readState();
      // Pas encore de réglages ici, mais le compte en a peut-être : on les attend plutôt que d'en poser d'autres.
      if (!saved && (await stateToCome())) {
        // Au plus huit secondes : un réseau qui ne répond pas ne bloque pas l'écran.
        await Promise.race([syncCloud().catch(() => false), new Promise((done) => setTimeout(done, 8000))]);
        saved = await readState();
      }
      // Un compte neuf : pas de faits, mais des catégories de départ pour ce qui sera saisi à la main.
      const data: FinanceData = r.empty && r.data.accounts.length === 0 ? { ...EMPTY, categories: [...DEFAULT_CATEGORIES] } : r.data;
      if (data.accounts.length === 0 && !saved?.accounts?.length) {
        live.current = null;
        setStatus('empty');
        startBackground();
        return;
      }
      setAt(r.at);
      const nextBase = fromV3(data);
      // Premier lancement du moteur : ses réglages de départ, qui ne remplacent jamais ceux d'un autre appareil.
      let rolled: EngineState;
      if (saved) {
        rolled = roll(saved, nextBase, today);
        if (rolled !== saved) await writeState(rolled, { before: saved });
      } else {
        const kept = await writeInitial(roll({ ...initState(nextBase), occurrenceOverrides: await loadOverrides() }, nextBase, today));
        rolled = roll(kept, nextBase, today);
        if (rolled !== kept) await writeState(rolled, { before: kept });
      }
      live.current = { base: nextBase, state: rolled };
      setData(data);
      setBase(nextBase);
      setState(rolled);
      setStatus('ready');
      startBackground();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    } finally {
      setBusy(false);
    }
  }, [today]);

  useEffect(() => {
    void load();
    const reload = () => void load();
    const offFacts = onFactsChanged(reload);
    const offState = onStateReplaced(reload);
    return () => {
      offFacts();
      offState();
    };
  }, [load]);

  const update = useCallback(
    (change: (s: EngineState) => EngineState) => {
      const cur = live.current;
      if (!cur) return;
      const next = roll(change(cur.state), cur.base, today);
      live.current = { base: cur.base, state: next };
      setState(next);
      void writeState(next, { touched: true, before: cur.state });
    },
    [today],
  );

  /** Créer le premier compte à la main, quand il n'y a encore rien. */
  const begin = useCallback(
    async (change: (s: EngineState) => EngineState) => {
      const base = fromV3({ ...EMPTY, categories: [...DEFAULT_CATEGORIES] });
      await writeState(change(initState(base)), { touched: true });
      await load();
    },
    [load],
  );

  const db = useMemo(() => (base && state ? applyState(base, state) : null), [base, state]);
  const explanation = useMemo(() => (db ? compute(db, today) : null), [db, today]);
  useEffect(() => {
    if (!db || !explanation) return;
    publish(db, explanation);
    // Les actions validées dans Copilot qui attendent MyFinances.
    if (pendingActions('finances').length)
      void runPendingActions('finances', async (a) => {
        const { change, undo } = actionChange(a, explanation);
        update(change);
        return undo;
      });
  }, [db, explanation, update]);
  return { status, error, today, data, base, db, state, explanation, at, busy, update, reload: () => void load(), begin };
}
