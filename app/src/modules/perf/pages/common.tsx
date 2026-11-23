import { useEffect, useState, type ReactNode } from 'react';
import { IconButton, Notice } from '@mylife/kit';
import { storageInfo } from '../data/client';

export function Head({ back, kicker, title, right }: { back: string; kicker?: string; title: string; right?: ReactNode }) {
  return (
    <header className="row" style={{ alignItems: 'flex-end' }}>
      <IconButton icon="back" label="Retour" href={back} />
      <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        {kicker && <span className="pf-kick pf-nowrap">{kicker}</span>}
        <h1 className="t-screen pf-title">{title}</h1>
      </div>
      {right}
    </header>
  );
}

/** Une valeur réglée au − / + (séries, reps, minutes, %). */
export function NumberRow({ label, value, unit, onChange, step = 1, min = 1, max = 999, format }: { label: string; value: number; unit: string; onChange: (v: number) => void; step?: number; min?: number; max?: number; format?: (v: number) => string }) {
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return (
    <div className="pf-numrow">
      <span className="grow">{label}</span>
      <button type="button" className="pf-more" aria-label={`${label} : moins`} onClick={() => onChange(Math.max(min, round(value - step)))}>
        −
      </button>
      <span className="pf-numval">{`${format ? format(value) : value}${unit ? ` ${unit}` : ''}`}</span>
      <button type="button" className="pf-more" aria-label={`${label} : plus`} onClick={() => onChange(Math.min(max, round(value + step)))}>
        +
      </button>
    </div>
  );
}

/** Prévient quand la base n'est pas gardée sur l'appareil : ouverte dans un autre onglet, ou navigateur sans stockage. */
export function StorageWarning() {
  const [vfs, setVfs] = useState<string | null>(null);
  useEffect(() => {
    storageInfo().then((i) => setVfs(i.vfs), () => setVfs(null));
  }, []);
  if (vfs === 'busy') return <Notice tone="warn">MyPerf est ouvert dans un autre onglet : ce que tu fais ici ne sera pas gardé. Ferme l’autre onglet, puis recharge.</Notice>;
  if (vfs === 'memory') return <Notice tone="warn">Ce navigateur ne garde pas tes séances sur l’appareil : elles partent au compte à la synchro.</Notice>;
  return null;
}
