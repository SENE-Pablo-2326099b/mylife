import { useEffect, useState } from 'react';
import { monteCarlo, type MonteCarloInput, type MonteCarloResult } from './fire';

let worker: Worker | null = null;
let seq = 0;

/** Simulation Monte-Carlo (Web Worker si disponible), relancée 250 ms après le dernier changement. */
export function useMonteCarlo(input: MonteCarloInput | null): MonteCarloResult | null {
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const key = input ? JSON.stringify(input) : '';
  useEffect(() => {
    if (!input) return;
    const id = ++seq;
    const timer = setTimeout(() => {
      if (typeof Worker === 'undefined') return setResult(monteCarlo(input));
      try {
        worker ??= new Worker(new URL('./fireWorker.ts', import.meta.url), { type: 'module' });
      } catch {
        return setResult(monteCarlo(input));
      }
      const w = worker;
      const onMessage = (e: MessageEvent<{ id: number; result: MonteCarloResult }>) => {
        if (e.data.id !== id) return;
        w.removeEventListener('message', onMessage);
        setResult(e.data.result);
      };
      w.addEventListener('message', onMessage);
      w.postMessage({ id, input });
    }, 250);
    return () => clearTimeout(timer);
    // `key` résume `input` (objet recréé à chaque rendu).
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return result;
}
