import { liveQuery, type Subscription } from 'dexie';
import { useSyncExternalStore } from 'react';
import { db } from '../db/db';
import type { Transaction } from '../db/types';
import { addDays, todayISO } from '../lib/dates';

/**
 * Opérations des 460 derniers jours, lues UNE fois et partagées par tous les écrans et composants
 * (alertes, récurrences, prévision, budget, indépendance financière) au lieu d'une requête chacun.
 * La lecture suit la base en direct et s'arrête quelques secondes après le dernier abonné.
 */
const WINDOW_DAYS = 460;

let state: Transaction[] | undefined;
let sub: Subscription | null = null;
let day = '';
let refs = 0;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function start() {
  day = todayISO();
  sub = liveQuery(() => db.transactions.where('date').aboveOrEqual(addDays(day, -WINDOW_DAYS)).toArray()).subscribe({
    next: (v) => {
      state = v;
      listeners.forEach((l) => l());
    },
    error: () => undefined,
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  refs++;
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = null;
  // Nouveau jour : la fenêtre glisse.
  if (sub && day !== todayISO()) {
    sub.unsubscribe();
    sub = null;
  }
  if (!sub) start();
  return () => {
    listeners.delete(listener);
    refs--;
    if (refs === 0)
      stopTimer = setTimeout(() => {
        sub?.unsubscribe();
        sub = null;
      }, 5000);
  };
}

/** undefined tant que la première lecture n'est pas arrivée. */
export function useRecentTransactions(): Transaction[] | undefined {
  return useSyncExternalStore(subscribe, () => state);
}
