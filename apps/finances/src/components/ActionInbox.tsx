import { useEffect, useRef } from 'react';
import { ACTIONS_EVENT, ACTIONS_KEY, runPendingActions, type ActionSpec, type MyLifeAction } from '../vendor/lumen';
import { executeFinancesAction } from '../domain/actionExec';
import { setRecurringSkip } from '../domain/useBudget';
import { useRecurringList } from '../domain/useInsights';
import { toast } from '../ui/index';

/**
 * Boîte d'envoi de MyFinances (actions validées, V4 F1) : ce que tu as validé dans Copilot, exécuté ici avec le code de
 * MyFinances (même calcul de cycle, même synchro), tout de suite si l'app est ouverte, sinon à son ouverture.
 */
export function ActionInbox() {
  const { items, cycle, loaded } = useRecurringList();
  const ctx = useRef({ items, cycle });
  ctx.current = { items, cycle };

  useEffect(() => {
    if (!loaded) return;
    let busy = false;
    const execute = async (a: MyLifeAction): Promise<ActionSpec | null> => {
      const r = await executeFinancesAction(a, ctx.current, setRecurringSkip);
      toast({ message: r.message });
      return r.undo;
    };
    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        await runPendingActions('finances', execute);
      } finally {
        busy = false;
      }
    };
    void run();
    const onStorage = (e: StorageEvent) => e.key === ACTIONS_KEY && void run();
    window.addEventListener('storage', onStorage);
    window.addEventListener(ACTIONS_EVENT, run);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(ACTIONS_EVENT, run);
    };
  }, [loaded]);
  return null;
}
