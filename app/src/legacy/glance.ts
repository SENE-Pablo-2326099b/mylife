import { readGlance, type MyLifeGlance } from '@mylife/lumen';
import { useDeviceTick } from '../store';

/**
 * Passerelle vers les apps d'avant la V5 (MyFinances, MyPerf, MyRave), le temps que chaque module soit repensé et
 * reconstruit dans la coquille (phases 3 à 5). Ces apps déposent déjà un « aperçu » sur l'appareil : les cartes de
 * l'accueil le lisent. Seule exception permise à la règle « un module n'importe que le kit, le cœur et son dossier » ;
 * elle disparaît avec la dernière app d'avant.
 */
export type LegacyApp = 'finances' | 'perf' | 'raveloc';

export function useGlance(app: LegacyApp): MyLifeGlance | null {
  useDeviceTick();
  return readGlance(app);
}

/** « 25,35 € à dépenser aujourd'hui » → le montant d'un côté, la suite de l'autre (pour le mettre en grand). */
export function splitAmount(title: string): { amount: string; rest: string } | null {
  const m = /^(-?\d[\d\s.,]*\s?€)\s*(.*)$/.exec(title.trim());
  return m ? { amount: m[1]!.trim(), rest: m[2]!.trim() } : null;
}
