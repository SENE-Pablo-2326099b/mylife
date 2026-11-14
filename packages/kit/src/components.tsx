import { Children, cloneElement, isValidElement, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';

/**
 * Les composants du kit V5. Règles : le texte est toujours posé sur du verre ; un seul bouton en dégradé
 * (`action`) par écran ; une carte de module porte la couleur de son module par `tone`.
 */

export type Tone = 'finances' | 'perf' | 'rave' | 'chef' | 'neutral';
const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

/** Lien ou bouton, selon qu'on mène ailleurs ou qu'on agit. */
function Pressable({ href, onClick, className, children, label, disabled }: { href?: string; onClick?: () => void; className?: string; children: ReactNode; label?: string; disabled?: boolean }) {
  if (href !== undefined)
    return (
      <a href={href} className={className} aria-label={label} onClick={onClick}>
        {children}
      </a>
    );
  return (
    <button type="button" className={className} aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** Panneau de verre neutre. */
export function Glass({ children, className, as: As = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'nav' }) {
  return <As className={cx('glass', className)}>{children}</As>;
}

/** Carte de module : bord en dégradé et teinte à la couleur du module. */
export function ModuleCard({ tone, children, className, href, label }: { tone: Tone; children: ReactNode; className?: string; href?: string; label?: string }) {
  const classes = cx('card-module', `tone-${tone}`, className);
  return href !== undefined ? (
    <a href={href} className={classes} aria-label={label} style={{ display: 'block' }}>
      {children}
    </a>
  ) : (
    <section className={classes} aria-label={label}>
      {children}
    </section>
  );
}

export function ModuleLabel({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cx('module-label', `tone-${tone}`)}>{children}</span>;
}

export function Button({ variant = 'secondary', children, href, onClick, icon, block, disabled }: { variant?: 'action' | 'secondary' | 'quiet' | 'danger'; children: ReactNode; href?: string; onClick?: () => void; icon?: IconName; block?: boolean; disabled?: boolean }) {
  return (
    <Pressable href={href} onClick={onClick} disabled={disabled} className={cx('btn', `btn-${variant}`, block && 'btn-block')}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </Pressable>
  );
}

export function IconButton({ icon, label, href, onClick }: { icon: IconName; label: string; href?: string; onClick?: () => void }) {
  return (
    <Pressable href={href} onClick={onClick} label={label} className="glass icon-btn">
      <Icon name={icon} size={20} />
    </Pressable>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'ok' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  return <span className={cx('badge', tone !== 'neutral' && `badge-${tone}`)}>{children}</span>;
}

/** Tuile d'icône à la couleur d'un module. */
export function IconTile({ tone, icon, soft }: { tone: Tone; icon: IconName; soft?: boolean }) {
  return (
    <span className={cx('icon-tile', `tone-${tone}`, soft && 'icon-tile-soft')}>
      <Icon name={icon} size={24} />
    </span>
  );
}

/** Panneau de verre avec son titre : le bloc ordinaire des pages (réglages, données, compte…). */
export function Panel({ title, children, as = 'section' }: { title: ReactNode; children: ReactNode; as?: 'div' | 'section' }) {
  return (
    <Glass as={as} className="pad stack">
      <h2 className="panel-title">{title}</h2>
      {children}
    </Glass>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <Glass className="list">{children}</Glass>;
}

export function ListRow({ title, detail, value, href, lead, onClick }: { title: ReactNode; detail?: ReactNode; value?: ReactNode; href?: string; lead?: ReactNode; onClick?: () => void }) {
  const leads = href !== undefined || onClick !== undefined;
  const body = (
    <>
      {lead}
      <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="t-body" style={{ fontWeight: 500 }}>{title}</span>
        {detail && <span className="t-small muted">{detail}</span>}
      </span>
      {value !== undefined && <span className="t-strong">{value}</span>}
      {leads && <span className="muted"><Icon name="chevron" size={18} /></span>}
    </>
  );
  if (href !== undefined)
    return (
      <a href={href} className="list-row">
        {body}
      </a>
    );
  if (onClick)
    return (
      <button type="button" className="list-row" onClick={onClick}>
        {body}
      </button>
    );
  return <div className="list-row">{body}</div>;
}

/** Écran vide : toujours une explication et une action. */
export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="t-card">{title}</span>
      <span className="t-small muted">{body}</span>
      {action}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { id: T; label: string }[]; onChange: (next: T) => void; label: string }) {
  return (
    <div className="glass segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Un champ : l'étiquette au-dessus (avec, à droite, un lien éventuel comme « Oublié ? »), la saisie, puis l'aide ou
 * l'erreur dessous. Le champ enfant (input, select, textarea, ou `PasswordField`) reçoit tout seul `aria-invalid` et
 * `aria-describedby` : rien à câbler dans les écrans.
 */
export function Field({ id, label, hint, hintTone, error, aside, children }: { id: string; label: string; hint?: ReactNode; hintTone?: 'ok' | 'warn'; error?: string | null; aside?: ReactNode; children: ReactNode }) {
  const note = error || hint;
  const noteId = note ? `${id}-note` : undefined;
  const wire = (child: ReactNode) =>
    isValidElement(child) ? cloneElement(child as ReactElement<Record<string, unknown>>, { 'aria-describedby': noteId, 'aria-invalid': error ? true : undefined }) : child;
  return (
    <div className="field">
      {aside ? (
        <div className="field-head">
          <label htmlFor={id}>{label}</label>
          {aside}
        </div>
      ) : (
        <label htmlFor={id}>{label}</label>
      )}
      {Children.map(children, wire)}
      {note && (
        <span id={noteId} className="field-hint" data-tone={error ? 'bad' : hintTone} role={error ? 'alert' : undefined}>
          {note}
        </span>
      )}
    </div>
  );
}

const STRENGTH = ['Trop court', 'Faible', 'Moyen', 'Bon', 'Très bon'] as const;

/**
 * Mot de passe, avec l'œil pour l'afficher. À poser dans un `Field`. `strength` (0 à 4) affiche la jauge, pour un
 * nouveau mot de passe.
 */
export function PasswordField({ id, value, onChange, isNew = false, strength, ...aria }: { id: string; value: string; onChange: (v: string) => void; isNew?: boolean; strength?: number; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <div className="input-wrap">
        <input id={id} type={shown ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={isNew ? 'new-password' : 'current-password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go" {...aria} />
        <button type="button" className="input-adorn" aria-label={shown ? 'Cacher le mot de passe' : 'Afficher le mot de passe'} aria-pressed={shown} onClick={() => setShown((s) => !s)}>
          <Icon name={shown ? 'eye-off' : 'eye'} size={20} />
        </button>
      </div>
      {strength !== undefined && value && (
        <div className="row" style={{ gap: 10 }}>
          <div className="meter grow" data-level={Math.max(1, strength)} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <span className="t-small muted" style={{ minWidth: 64, textAlign: 'right' }}>{STRENGTH[strength]}</span>
        </div>
      )}
    </>
  );
}

/** Message d'un formulaire ou d'un écran. Une erreur est annoncée aux lecteurs d'écran. */
export function Notice({ tone = 'neutral', children }: { tone?: 'bad' | 'warn' | 'ok' | 'neutral'; children: ReactNode }) {
  return (
    <div className={cx('notice', tone !== 'neutral' && `notice-${tone}`)} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon name={tone === 'ok' ? 'check' : 'alert'} size={18} />
      <span>{children}</span>
    </div>
  );
}

/** Feuille par-dessus tout : se ferme par le fond, la croix ou Échap. */
export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-veil" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <span className="sheet-grip" aria-hidden="true" />
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 className="t-screen" style={{ fontSize: 26, lineHeight: '32px' }}>{title}</h2>
          <button type="button" className="tile icon-btn" aria-label="Fermer" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** En-tête d'un écran : une ligne discrète, le titre, une action à droite. */
export function ScreenHeader({ kicker, title, right }: { kicker?: string; title: string; right?: ReactNode }) {
  return (
    <header className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {kicker && <span className="t-label muted" style={{ fontWeight: 500 }}>{kicker}</span>}
        <h1 className="t-screen">{title}</h1>
      </div>
      {right}
    </header>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="t-label muted">{children}</h2>;
}
