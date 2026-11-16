import { useEffect, useState } from 'react';
import { Field } from '@mylife/kit';

/** Un nombre saisi au clavier (virgule ou point), enregistré dès qu'il est valide ; il suit la valeur venue d'ailleurs. */
export function Amount({ id, label, value, unit, max, onChange }: { id: string; label: string; value: number; unit: string; max: number; onChange: (v: number) => void }) {
  const show = (v: number) => String(v).replace('.', ',');
  const [text, setText] = useState(show(value));
  useEffect(() => {
    setText((t) => (Number(t.replace(',', '.')) === value ? t : show(value)));
  }, [value]);
  return (
    <Field id={id} label={`${label} (${unit})`}>
      <input
        id={id}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value.replace(/\s/g, '').replace(',', '.'));
          if (e.target.value.trim() && Number.isFinite(n) && n >= 0 && n <= max) onChange(n);
        }}
      />
    </Field>
  );
}
