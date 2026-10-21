/// <reference lib="webworker" />
import { monteCarlo, type MonteCarloInput } from './fire';

/** Monte-Carlo hors du fil principal : l'écran reste fluide pendant les tirages. */
self.onmessage = (e: MessageEvent<{ id: number; input: MonteCarloInput }>) => {
  self.postMessage({ id: e.data.id, result: monteCarlo(e.data.input) });
};
