import type { ReactNode } from 'react';
import { IconButton } from '@mylife/kit';

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
