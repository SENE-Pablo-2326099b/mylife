import { db } from '../db/db';
import { sharedLiveQuery } from '../db/sharedQuery';
import type { Transaction } from '../db/types';

/**
 * Opérations à classer, lues une seule fois pour toute l'app (pastille du dock, Aujourd'hui, palette,
 * actions rapides, file « À classer ») : un seul parcours de la table par écriture au lieu de cinq.
 */
export const useUnclassified = sharedLiveQuery<Transaction[]>(() => db.transactions.filter((t) => t.categoryId === null).toArray());

/** Nombre d'opérations à classer (0 tant que la lecture n'est pas arrivée). */
export function useToClassifyCount(): number {
  return useUnclassified()?.length ?? 0;
}
