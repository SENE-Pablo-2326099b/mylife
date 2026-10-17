import { useEffect, useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { centsToInput, formatCents, tryDecimalToCents } from '../lib/money';

export function Card({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl bg-surface border border-line/60 p-4 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = 'primary' | 'ghost' | 'danger' | 'subtle';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-black font-semibold hover:brightness-110',
  ghost: 'border border-line text-ink hover:bg-raised',
  subtle: 'bg-raised text-ink hover:brightness-125',
  danger: 'border border-bad/60 text-bad hover:bg-bad/10',
};

export function Button({ variant = 'subtle', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm transition disabled:opacity-50 disabled:pointer-events-none ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass =
  'w-full min-h-[44px] rounded-xl bg-raised border border-line px-3 py-2 text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none';

/** Saisie d'un montant en euros ; la valeur est transmise en centimes à la validation (blur / Entrée). */
export function MoneyField({
  label,
  value,
  onCommit,
  hint,
  allowEmpty = false,
  placeholder,
}: {
  label: string;
  value: number | null;
  onCommit: (cents: number | null) => void;
  hint?: ReactNode;
  allowEmpty?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === null ? '' : centsToInput(value));
  const [error, setError] = useState(false);
  useEffect(() => {
    setText(value === null ? '' : centsToInput(value));
  }, [value]);
  const commit = () => {
    if (text.trim() === '' && allowEmpty) {
      setError(false);
      if (value !== null) onCommit(null);
      return;
    }
    const cents = tryDecimalToCents(text);
    if (cents === null) {
      setError(true);
      return;
    }
    setError(false);
    if (cents !== value) onCommit(cents);
  };
  return (
    <Field label={label} hint={error ? <span className="text-bad">Montant invalide</span> : hint}>
      {(id) => (
        <div className="relative">
          <input
            id={id}
            inputMode="decimal"
            className={`${inputClass} pr-8 num ${error ? 'border-bad' : ''}`}
            value={text}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">€</span>
        </div>
      )}
    </Field>
  );
}

export function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
  hint,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onCommit: (n: number) => void;
  hint?: ReactNode;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = parseInt(text, 10);
    if (Number.isNaN(n)) return setText(String(value));
    const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          className={`${inputClass} num`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      )}
    </Field>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <label htmlFor={id} className="flex-1 cursor-pointer">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-accent' : 'bg-line'}`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-ink transition-all ${checked ? 'left-6' : 'left-1'}`} />
      </button>
    </div>
  );
}

export function Money({ cents, sign, className = '', compact }: { cents: number; sign?: boolean; className?: string; compact?: boolean }) {
  return <span className={`num whitespace-nowrap ${className}`}>{formatCents(cents, { sign, compact })}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line p-6 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-4">
      <h1 className="text-2xl font-bold tracking-tight">{children}</h1>
      {sub && <p className="text-sm text-muted">{sub}</p>}
    </header>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent' }) {
  const tones = {
    neutral: 'bg-raised text-muted',
    good: 'bg-good/15 text-good',
    warn: 'bg-warn/15 text-warn',
    bad: 'bg-bad/15 text-bad',
    accent: 'bg-accent/15 text-accent',
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
