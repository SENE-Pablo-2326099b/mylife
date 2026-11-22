import { useCallback, useEffect, useState } from 'react';
import { useCloud } from '../data/cloud';

/** Petits outils partagés des écrans de MyPerf. */
export const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
export const DAYS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
export const longDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long' });
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Lecture d'une donnée du module, relue quand la synchro apporte du neuf. */
export function useData<T>(read: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; reload: () => void } {
  const cloud = useCloud();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    read().then(setData, (e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => reload(), [reload, cloud.lastSyncAt]);
  return { data, error, reload };
}

export const MUSCLES: readonly [string, string][] = [
  ['chest', 'Pectoraux'],
  ['back', 'Dos'],
  ['lats', 'Grand dorsal'],
  ['shoulders', 'Épaules'],
  ['rear_delts', 'Arrière d’épaule'],
  ['biceps', 'Biceps'],
  ['triceps', 'Triceps'],
  ['forearms', 'Avant-bras'],
  ['abs', 'Abdos'],
  ['lower_back', 'Lombaires'],
  ['glutes', 'Fessiers'],
  ['quads', 'Quadriceps'],
  ['hamstrings', 'Ischios'],
  ['adductors', 'Adducteurs'],
  ['calves', 'Mollets'],
  ['traps', 'Trapèzes'],
];
