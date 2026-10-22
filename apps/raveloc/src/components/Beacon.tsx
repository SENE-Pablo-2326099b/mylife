import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { observable, useObservable } from '../lib/observable';
import { BRAND } from './kit';

/** Mode phare : écran plein de lumière qui pulse, à lever au-dessus de la foule pour être repéré. */
export const beacon = observable<{ on: boolean }>({ on: false });
export const setBeacon = (on: boolean) => beacon.set({ on });

export function Beacon() {
  const { on } = useObservable(beacon);
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setBeacon(false);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [on]);
  if (!on) return null;
  return createPortal(
    <button type="button" onClick={() => setBeacon(false)} aria-label="Quitter le mode phare" className="beacon" style={{ ['--brand-a' as string]: BRAND[0], ['--brand-b' as string]: BRAND[1] }}>
      Lève ton téléphone · touche pour quitter
    </button>,
    document.body,
  );
}
