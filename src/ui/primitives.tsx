import { AnimatePresence, motion, useMotionValue, useSpring } from 'framer-motion';
import { Children, forwardRef, useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { centsToInput, formatCents, tryDecimalToCents } from '../lib/money';
import { haptic, springs } from './motion';
import { Icon, type IconName } from './icons';
import type { GlassLevel, Tone } from './theme';

// ---------------------------------------------------------------- verre

export type GlassTone = Tone | 'neutral';

/**
 * Une plaque de verre. Chaque niveau = remplissage translucide + reflet + bord fin + liseré
 * spéculaire + ombre (voir .glass dans index.css). Plus le niveau est épais, plus il est opaque,
 * haut et lumineux. `glow` : il émet la lumière de l'accent (actif, principal).
 */
export const Glass = forwardRef<
  HTMLDivElement,
  {
    level?: GlassLevel;
    tone?: GlassTone;
    glow?: boolean;
    className?: string;
    style?: CSSProperties;
    children?: ReactNode;
    as?: 'div' | 'section' | 'article' | 'nav' | 'header' | 'aside' | 'li' | 'ul';
  } & Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'style' | 'children'>
>(function Glass({ level = 'pane', tone = 'neutral', glow = false, className = 'rounded-lg', style, children, as = 'div', ...rest }, ref) {
  const Tag = as as 'div';
  const cls = ['glass', level !== 'pane' && `glass-${level}`, tone !== 'neutral' && `tone-${tone}`, glow && 'glass-glow', className].filter(Boolean).join(' ');
  return (
    <Tag ref={ref} className={cls} style={style} {...rest}>
      {children}
    </Tag>
  );
});

// ---------------------------------------------------------------- Tap : la pression physique

const MotionLink = motion.create(Link);

export interface TapProps {
  to?: string;
  replace?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Échelle sous le doigt (pression élastique). */
  scaleTo?: number;
  disabled?: boolean;
  label?: string;
  type?: 'button' | 'submit';
  role?: string;
  /** Surface éclairée au survol / à l'appui. */
  highlight?: boolean;
  haptics?: boolean;
  ariaPressed?: boolean;
  ariaExpanded?: boolean;
  ariaChecked?: boolean;
  ariaCurrent?: 'page' | undefined;
  ariaKeyshortcuts?: string;
  title?: string;
  id?: string;
}

/** Tout ce qui se touche : s'enfonce sous le doigt (ressort) et s'éclaire au survol. */
export function Tap({
  to,
  replace,
  onClick,
  children,
  className = '',
  style,
  scaleTo = 0.965,
  disabled,
  label,
  type = 'button',
  role,
  highlight = true,
  haptics = true,
  ariaPressed,
  ariaExpanded,
  ariaChecked,
  ariaCurrent,
  ariaKeyshortcuts,
  title,
  id,
}: TapProps) {
  const cls = `${highlight ? 'hl' : ''} ${disabled ? 'pointer-events-none opacity-40' : 'cursor-pointer'} ${className}`;
  const motionProps = {
    whileTap: disabled ? undefined : { scale: scaleTo, transition: springs.snappy },
    transition: springs.liquid,
  };
  const press = () => {
    if (haptics) haptic('tap');
    onClick?.();
  };
  if (to !== undefined) {
    return (
      <MotionLink to={to} replace={replace} className={cls} style={style} aria-label={label} aria-current={ariaCurrent} onClick={onClick ? press : haptics ? () => haptic('tap') : undefined} title={title} id={id} {...motionProps}>
        {children}
      </MotionLink>
    );
  }
  return (
    <motion.button
      type={type}
      className={cls}
      style={style}
      onClick={type === 'submit' && !onClick ? undefined : press}
      disabled={disabled}
      aria-label={label}
      role={role}
      aria-pressed={ariaPressed}
      aria-expanded={ariaExpanded}
      aria-checked={ariaChecked}
      aria-current={ariaCurrent}
      aria-keyshortcuts={ariaKeyshortcuts}
      title={title}
      id={id}
      {...motionProps}
    >
      {children}
    </motion.button>
  );
}

// ---------------------------------------------------------------- boutons

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';

const BTN_HEIGHT = { sm: 'min-h-[38px] px-3 text-[14px]', md: 'min-h-[48px] px-[18px] text-[15px]', lg: 'min-h-[58px] px-5 text-[17px]' } as const;

/**
 * Primaire = lumière liquide (dégradé d'accent + reflet + lueur) ; secondaire = verre ;
 * ghost = texte accent ; danger = verre teinté rouge ; gold = ce qui est précieux.
 */
export function Button({
  children,
  onClick,
  to,
  variant = 'primary',
  icon,
  size = 'md',
  disabled,
  className = '',
  type = 'button',
  label,
}: {
  children: ReactNode;
  onClick?: () => void;
  to?: string;
  variant?: ButtonVariant;
  icon?: IconName;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
  label?: string;
}) {
  const magnetic = variant === 'primary' && size === 'lg';
  const x = useSpring(useMotionValue(0), springs.soft);
  const y = useSpring(useMotionValue(0), springs.soft);
  const radius = size === 'lg' ? 'rounded-lg' : 'rounded-md';
  const look: Record<ButtonVariant, string> = {
    primary: 'liquid',
    gold: 'liquid liquid-gold text-ink',
    secondary: 'glass glass-raised text-ink',
    ghost: 'text-accent',
    danger: 'glass glass-raised tone-danger text-danger',
  };
  const body = (
    <span className={`flex w-full items-center justify-center gap-2 font-semibold tracking-[-0.1px] ${BTN_HEIGHT[size]}`} style={{ fontSize: undefined }}>
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 19} />}
      <span className="min-w-0 text-center leading-tight">{children}</span>
    </span>
  );
  return (
    <motion.span
      className={`inline-flex ${className}`}
      style={magnetic ? { x, y } : undefined}
      onPointerMove={
        magnetic
          ? (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              x.set(((e.clientX - r.left - r.width / 2) / r.width) * 8);
              y.set(((e.clientY - r.top - r.height / 2) / r.height) * 6);
            }
          : undefined
      }
      onPointerLeave={
        magnetic
          ? () => {
              x.set(0);
              y.set(0);
            }
          : undefined
      }
    >
      <Tap to={to} onClick={onClick} disabled={disabled} type={type} label={label} className={`flex w-full ${radius} ${look[variant]}`} scaleTo={0.97}>
        {body}
      </Tap>
    </motion.span>
  );
}

export function IconButton({
  icon,
  onClick,
  to,
  label,
  size = 22,
  glass = false,
  className = '',
  tone = 'secondary',
  badge,
}: {
  icon: IconName;
  onClick?: () => void;
  to?: string;
  label: string;
  size?: number;
  /** Posé sur sa propre perle de verre (contrôles flottants). */
  glass?: boolean;
  className?: string;
  tone?: 'secondary' | 'accent' | 'ink' | 'muted' | 'danger';
  badge?: ReactNode;
}) {
  const color = { secondary: 'text-secondary', accent: 'text-accent', ink: 'text-ink', muted: 'text-muted', danger: 'text-danger' }[tone];
  return (
    <Tap to={to} onClick={onClick} label={label} scaleTo={0.88} className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${glass ? 'glass glass-raised' : ''} ${color} ${className}`} title={label}>
      <Icon name={icon} size={size} />
      {badge}
    </Tap>
  );
}

// ---------------------------------------------------------------- surfaces

export function Card({
  children,
  className = '',
  onClick,
  to,
  level = 'pane',
  glow = false,
  tone,
  padded = true,
  label,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  to?: string;
  level?: 'pane' | 'raised' | 'float';
  glow?: boolean;
  tone?: GlassTone;
  padded?: boolean;
  label?: string;
}) {
  const pad = padded ? 'p-4' : '';
  if (!onClick && to === undefined) {
    return (
      <Glass level={level} glow={glow} tone={tone} className={`rounded-lg ${pad} ${className}`}>
        {children}
      </Glass>
    );
  }
  const cls = ['glass', level !== 'pane' && `glass-${level}`, tone && tone !== 'neutral' && `tone-${tone}`, glow && 'glass-glow'].filter(Boolean).join(' ');
  return (
    <Tap to={to} onClick={onClick} scaleTo={0.985} label={label} className={`block w-full rounded-lg text-left ${cls} ${pad} ${className}`}>
      {children}
    </Tap>
  );
}

export function Chip({
  children,
  selected = false,
  onClick,
  small = false,
  icon,
  tone = 'accent',
  label,
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
  icon?: IconName;
  tone?: 'accent' | 'gold' | 'success' | 'danger' | 'warning' | 'info';
  label?: string;
}) {
  const h = small ? 'h-[30px] px-[10px] text-[12.5px]' : 'h-9 px-[14px] text-[13.5px]';
  const style: CSSProperties = selected
    ? {
        background: `var(--${tone}-tint)`,
        borderColor: `var(--${tone}-rim-strong)`,
        color: `var(--${tone})`,
        boxShadow: `0 0 16px var(--${tone}-halo), inset 0 1px 0 var(--highlight)`,
      }
    : { background: 'var(--glass-pane-fill)', borderColor: 'var(--glass-pane-rim)', boxShadow: 'inset 0 1px 0 var(--glass-pane-spec)' };
  const inner = (
    <>
      {icon && <Icon name={icon} size={small ? 13 : 15} />}
      <span className="truncate">{children}</span>
    </>
  );
  const cls = `inline-flex max-w-full shrink-0 items-center gap-[5px] rounded-pill border font-semibold ${h} ${selected ? '' : 'text-secondary'}`;
  if (!onClick) return <span className={cls} style={style}>{inner}</span>;
  return (
    <Tap onClick={onClick} scaleTo={0.92} className={cls} style={style} ariaPressed={selected} label={label}>
      {inner}
    </Tap>
  );
}

/** Petite pastille d'état : point lumineux (ou icône) + texte, dans la couleur porteuse de sens. */
export function Badge({ children, tone = 'neutral', icon }: { children: ReactNode; tone?: GlassTone; icon?: IconName }) {
  const color = tone === 'neutral' ? 'var(--text-secondary)' : `var(--${tone})`;
  const style: CSSProperties =
    tone === 'neutral'
      ? { color, background: 'var(--surface-alt)', borderColor: 'var(--border)' }
      : { color, background: `var(--${tone}-tint)`, borderColor: `var(--${tone}-rim)` };
  return (
    <span className="inline-flex min-h-[22px] max-w-full shrink items-center gap-1 rounded-pill border px-[9px] text-[11.5px] font-semibold" style={style}>
      {icon ? <Icon name={icon} size={11} /> : <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function SectionTitle({ children, action, className = '' }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`mb-2.5 mt-7 flex min-h-[28px] flex-wrap items-center justify-between gap-x-3 px-0.5 ${className}`}>
      <h2 className="t-headline shrink-0 text-ink">{children}</h2>
      {action}
    </div>
  );
}

/**
 * Section repliée : une ligne discrète (titre, résumé, chevron) qui déplie son contenu.
 * L'essentiel reste visible, le rare à un tap.
 */
export function Disclosure({ title, summary, children, initiallyOpen = false }: { title: string; summary?: ReactNode; children: ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div className="mt-4">
      <Tap onClick={() => setOpen(!open)} scaleTo={0.99} ariaExpanded={open} className="flex min-h-[48px] w-full items-center gap-2 rounded-md px-0.5 text-left">
        <span className="t-label min-w-0 text-muted">{title}</span>
        <span className="t-small min-w-0 flex-1 truncate text-right text-muted">{open ? '' : summary}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} className="text-muted" />
      </Tap>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={springs.soft} className="overflow-hidden">
            <div className="pt-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Pastille d'icône des lignes (ou emoji de catégorie). */
export function IconBubble({ icon, emoji, tone }: { icon?: IconName; emoji?: string; tone?: GlassTone }) {
  const style: CSSProperties =
    tone && tone !== 'neutral'
      ? { background: `var(--${tone}-soft)`, color: `var(--${tone})` }
      : { background: 'var(--surface-alt)', boxShadow: 'inset 0 1px 0 var(--glass-pane-spec)' };
  return (
    <span aria-hidden className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-sm text-[17px] text-secondary" style={style}>
      {emoji ?? (icon && <Icon name={icon} size={18} />)}
    </span>
  );
}

export function Row({
  title,
  subtitle,
  right,
  onClick,
  to,
  icon,
  emoji,
  iconTone,
  chevron,
  className = '',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  to?: string;
  icon?: IconName;
  emoji?: string;
  iconTone?: GlassTone;
  chevron?: boolean;
  className?: string;
}) {
  const interactive = !!onClick || to !== undefined;
  const body = (
    <>
      {(icon || emoji) && <IconBubble icon={icon} emoji={emoji} tone={iconTone} />}
      <span className="min-w-0 flex-1">
        <span className="t-body-strong line-clamp-2 block">{title}</span>
        {subtitle !== undefined && subtitle !== '' && <span className="t-small line-clamp-2 block text-secondary">{subtitle}</span>}
      </span>
      {right}
      {(chevron ?? (interactive && right === undefined)) && <Icon name="chevron-forward" size={17} className="text-muted" />}
    </>
  );
  const cls = `flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left ${className}`;
  if (!interactive) return <div className={cls}>{body}</div>;
  return (
    <Tap to={to} onClick={onClick} scaleTo={0.985} className={`${cls} rounded-none`}>
      {body}
    </Tap>
  );
}

/** Une vitre qui tient des lignes, séparées par des filets de lumière. */
export function Group({ children, className = '' }: { children: ReactNode; className?: string }) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <Glass className={`overflow-hidden rounded-lg ${className}`}>
      {items.map((child, i) => (
        <div key={i}>
          {i > 0 && <div className="ml-4 h-px bg-line" />}
          {child}
        </div>
      ))}
    </Glass>
  );
}

export function Divider({ className = '' }: { className?: string }) {
  return <div className={`h-px bg-line ${className}`} />;
}

// ---------------------------------------------------------------- montants

/** Montant : Sora 600, chiffres tabulaires, format français (virgule, espace insécable avant €). */
export function Money({
  cents,
  sign,
  compact,
  className = '',
  tone,
}: {
  cents: number;
  sign?: boolean;
  compact?: boolean;
  className?: string;
  /** 'auto' : vert si positif. */
  tone?: 'auto' | 'danger' | 'success' | 'gold' | 'accent' | 'muted';
}) {
  const color =
    tone === 'auto' ? (cents > 0 ? 'text-success' : '') : tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : tone === 'gold' ? 'text-gold' : tone === 'accent' ? 'text-accent' : tone === 'muted' ? 'text-muted' : '';
  return <span className={`num whitespace-nowrap font-display font-semibold ${color} ${className}`}>{formatCents(cents, { sign, compact })}</span>;
}

// ---------------------------------------------------------------- champs

export function Field({ label, hint, children, error }: { label?: string; hint?: ReactNode; error?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="t-label text-muted">
          {label}
        </label>
      )}
      {children(id)}
      {error ? <p className="t-caption text-danger">{error}</p> : hint ? <p className="t-caption text-muted">{hint}</p> : null}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  onCommit,
  placeholder,
  hint,
  type = 'text',
  mono,
  autoComplete,
  inputMode,
}: {
  label?: string;
  value: string;
  onChange?: (v: string) => void;
  /** Valeur validée à la sortie du champ (si différente). */
  onCommit?: (v: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  type?: 'text' | 'password' | 'search' | 'date' | 'url';
  mono?: boolean;
  autoComplete?: string;
  inputMode?: 'text' | 'decimal' | 'numeric' | 'search';
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          type={type}
          className={`field-input ${mono ? 'font-mono' : ''}`}
          value={onChange ? value : text}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          autoCapitalize={mono ? 'off' : undefined}
          spellCheck={mono ? false : undefined}
          onChange={(e) => (onChange ? onChange(e.target.value) : setText(e.target.value))}
          onBlur={() => onCommit && text !== value && onCommit(text)}
          onKeyDown={(e) => e.key === 'Enter' && onCommit && (e.target as HTMLInputElement).blur()}
        />
      )}
    </Field>
  );
}

/** Saisie d'un montant en euros ; la valeur est transmise en centimes à la validation (sortie du champ / Entrée). */
export function MoneyField({
  label,
  value,
  onCommit,
  hint,
  allowEmpty = false,
  placeholder,
  allowNegative = false,
}: {
  label: string;
  value: number | null;
  onCommit: (cents: number | null) => void;
  hint?: ReactNode;
  allowEmpty?: boolean;
  placeholder?: string;
  allowNegative?: boolean;
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
    if (cents === null || (!allowNegative && cents < 0)) {
      setError(true);
      return;
    }
    setError(false);
    if (cents !== value) onCommit(cents);
  };
  return (
    <Field label={label} hint={hint} error={error ? 'Montant invalide' : undefined}>
      {(id) => (
        <div className="relative">
          <input
            id={id}
            inputMode="decimal"
            className="field-input num pr-9 font-display font-semibold"
            value={text}
            aria-invalid={error}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted">€</span>
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
  suffix,
  decimals = false,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onCommit: (n: number) => void;
  hint?: ReactNode;
  suffix?: string;
  decimals?: boolean;
}) {
  const show = (n: number) => (decimals ? String(n).replace('.', ',') : String(n));
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const n = decimals ? parseFloat(text.replace(',', '.').replace(/\s/g, '')) : parseInt(text, 10);
    if (Number.isNaN(n)) return setText(show(value));
    const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
    setText(show(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <div className="relative">
          <input
            id={id}
            inputMode={decimals ? 'decimal' : 'numeric'}
            className={`field-input num font-display font-semibold ${suffix ? 'pr-12' : ''}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          {suffix && <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted">{suffix}</span>}
        </div>
      )}
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
  ariaLabel,
}: {
  label?: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
  hint?: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <div className="relative">
          <select id={id} className="field-input" value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={ariaLabel}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted" />
        </div>
      )}
    </Field>
  );
}

/** − valeur + compact pour les petits entiers (jours, nombres, pourcentages). */
export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 999,
  format = (v: number) => String(v),
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
  label?: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 1000) / 1000));
  return (
    <Glass className="flex h-[50px] items-center rounded-md" aria-label={label}>
      <IconButton icon="remove" label={`Diminuer${label ? ` ${label}` : ''}`} size={18} onClick={() => onChange(clamp(value - step))} />
      <span className="num min-w-0 flex-1 truncate text-center font-display text-[16px] font-semibold">{format(value)}</span>
      <IconButton icon="add" label={`Augmenter${label ? ` ${label}` : ''}`} size={18} onClick={() => onChange(clamp(value + step))} />
    </Glass>
  );
}

/** Un réglage avec un stepper compact à droite ; passe sous son libellé sur les écrans très étroits. */
export function StepperRow({ label, hint, ...stepper }: { label: string; hint?: ReactNode; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; format?: (v: number) => string }) {
  return (
    <div className="flex min-h-[50px] flex-wrap items-center gap-x-3 gap-y-1">
      <div className="min-w-0 flex-[1_1_120px]">
        <p className="t-body-strong">{label}</p>
        {hint && <p className="t-caption text-muted">{hint}</p>}
      </div>
      <div className="max-w-[200px] flex-[1_1_152px]">
        <Stepper {...stepper} label={label} />
      </div>
    </div>
  );
}

/** Options sur un rail de verre ; une pastille de verre surélevée glisse vers le choix. */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string }) {
  const id = useId();
  return (
    <Glass className="rounded-[18px] p-1" role="radiogroup" aria-label={label}>
      <div className="flex">
        {options.map((o, i) => {
          const selected = o.value === value;
          const focusable = selected || (i === 0 && !options.some((x) => x.value === value));
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              // Groupe de boutons radio : une seule étape de tabulation, flèches pour changer.
              tabIndex={focusable ? 0 : -1}
              onClick={() => {
                haptic('tap');
                onChange(o.value);
              }}
              onKeyDown={(e) => {
                const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const at = options.findIndex((x) => x.value === value);
                const next = options[(Math.max(at, 0) + step + options.length) % options.length];
                if (!next) return;
                onChange(next.value);
                const group = e.currentTarget.parentElement;
                requestAnimationFrame(() => group?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
              }}
              className={`relative min-h-[36px] flex-1 px-1 py-1 text-center text-[13px] font-semibold leading-tight ${selected ? 'text-ink' : 'text-secondary'}`}
            >
              {selected && (
                <motion.span
                  layoutId={`seg-${id}`}
                  transition={springs.liquid}
                  className="absolute inset-0 rounded-[14px]"
                  style={{ background: 'var(--glass-raised-solid)', boxShadow: '0 4px 14px var(--well-shade), inset 0 1px 0 var(--glass-raised-spec)' }}
                />
              )}
              <span className="relative">{o.label}</span>
            </button>
          );
        })}
      </div>
    </Glass>
  );
}

/** Interrupteur de verre : une perle de lumière glisse dans une rainure qui se remplit quand il est activé. */
export function Toggle({ checked, onChange, label, labelledBy }: { checked: boolean; onChange: (v: boolean) => void; label?: string; labelledBy?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      onClick={() => {
        haptic('tap');
        onChange(!checked);
      }}
      className="etched relative h-[30px] w-[50px] shrink-0 rounded-[15px] p-[3px]"
    >
      <motion.span className="liquid absolute inset-0 rounded-[15px]" style={{ boxShadow: 'none' }} initial={false} animate={{ opacity: checked ? 1 : 0 }} transition={{ duration: 0.2 }} />
      <motion.span
        className="relative block h-6 w-6 rounded-full"
        style={{ background: 'var(--knob)', boxShadow: '0 2px 6px var(--well-shade)' }}
        initial={false}
        animate={{ x: checked ? 20 : 0 }}
        transition={springs.liquid}
      />
    </button>
  );
}

export function ToggleRow({ label, hint, checked, onChange }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 py-1">
      <div className="min-w-0 flex-1" id={id}>
        <p className="t-body-strong">{label}</p>
        {hint && <p className="t-caption text-muted">{hint}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} labelledBy={id} />
    </div>
  );
}

/** États vides : une orbe de verre lumineuse, une phrase, et la prochaine étape. */
export function EmptyState({ icon = 'sparkles', title, body, action }: { icon?: IconName; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 py-8 text-center">
      <Glass level="raised" className="mb-2 flex h-[72px] w-[72px] items-center justify-center rounded-full text-accent" style={{ boxShadow: '0 0 40px var(--accent-glow), inset 0 1px 0 var(--glass-raised-spec)' }}>
        <Icon name={icon} size={30} />
      </Glass>
      <p className="t-title">{title}</p>
      {body && <div className="t-body max-w-[360px] text-secondary">{body}</div>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Grand chiffre avec son libellé, pour les bandeaux d'indicateurs. */
export function Metric({ label, value, hint, tone, className = '' }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'danger' | 'success' | 'gold' | 'accent' | 'warning'; className?: string }) {
  const color = tone ? `text-${tone}` : '';
  return (
    // Le chiffre se règle sur la largeur de sa tuile (container query) : jamais « 16… » à 320 px.
    <div className={`min-w-0 ${className}`} style={{ containerType: 'inline-size' }}>
      <p className="t-label line-clamp-2 text-muted">{label}</p>
      <p className={`num mt-0.5 truncate font-display font-semibold tracking-[-0.6px] ${color}`} style={{ fontSize: 'min(22px, 29cqi)' }}>
        {value}
      </p>
      {hint && <p className="t-caption mt-0.5 text-muted">{hint}</p>}
    </div>
  );
}

export function StatTile({ label, value, hint, tone, to, onClick }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'danger' | 'success' | 'gold' | 'accent' | 'warning'; to?: string; onClick?: () => void }) {
  return (
    <Card to={to} onClick={onClick} className="p-3.5">
      <Metric label={label} value={value} hint={hint} tone={tone} />
    </Card>
  );
}

/** Jauge horizontale : rainure gravée, remplissage de lumière (avec lueur) et repère d'objectif. */
export function ProgressBar({
  value,
  max,
  tone = 'accent',
  marker,
  height = 8,
  label,
}: {
  value: number;
  max: number;
  tone?: Tone;
  /** Position d'un repère (même unité que value). */
  marker?: number | null;
  height?: number;
  label?: string;
}) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value * 100) / max));
  const markerPct = marker != null && max > 0 ? Math.max(0, Math.min(100, (marker * 100) / max)) : null;
  const fill = tone === 'accent' ? 'linear-gradient(90deg, var(--accent-g0), var(--accent-g1))' : tone === 'gold' ? 'linear-gradient(90deg, var(--gold-g0), var(--gold-g1))' : `linear-gradient(90deg, var(--${tone}-rim-strong), var(--${tone}))`;
  return (
    <div className="relative" role={label ? 'img' : undefined} aria-label={label}>
      <div className="etched overflow-hidden rounded-pill" style={{ height }}>
        <motion.div
          className="h-full rounded-pill"
          style={{ background: fill, boxShadow: `0 0 10px var(--${tone}-halo)` }}
          initial={{ width: 0 }}
          animate={{ width: `${pct > 0 ? Math.max(2, pct) : 0}%` }}
          transition={springs.soft}
        />
      </div>
      {markerPct !== null && <div className="absolute -top-1 w-0.5 rounded bg-ink opacity-80" style={{ left: `calc(${markerPct}% - 1px)`, height: height + 8 }} />}
    </div>
  );
}
