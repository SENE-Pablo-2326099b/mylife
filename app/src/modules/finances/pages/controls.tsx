import type { ReactNode } from 'react';
import { Field, Sheet, Switch } from '@mylife/kit';

/** Les petits contrôles des feuilles de réglage : un interrupteur avec son explication, une liste déroulante, une feuille. */

export function Toggle({ label, detail, checked, onChange }: { label: string; detail?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="row" style={{ minHeight: 48 }}>
      <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="t-body" style={{ fontWeight: 500 }}>{label}</span>
        {detail && <span className="t-small muted">{detail}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

export function Select<T extends string>({ id, label, value, options, onChange, hint }: { id: string; label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; hint?: string }) {
  return (
    <Field id={id} label={label} hint={hint}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Form({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <div className="stack" style={{ maxHeight: '70dvh', overflowY: 'auto', paddingBottom: 4 }}>{children}</div>
    </Sheet>
  );
}

