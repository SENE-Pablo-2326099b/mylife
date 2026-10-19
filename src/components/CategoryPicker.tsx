import type { Category } from '../db/types';
import { Tap } from '../ui/primitives';

export const SHORTCUT_KEYS = '1234567890azertyuiop';

/** Grille de catégories : la sélection s'allume (teinte d'accent + lueur). Raccourcis clavier en option. */
export function CategoryPicker({ categories, value, onPick, shortcuts = false }: { categories: Category[]; value?: string | null; onPick: (id: string) => void; shortcuts?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2 min-[560px]:grid-cols-3" role="group" aria-label="Choisir une catégorie">
      {categories.map((c, i) => {
        const key = shortcuts ? SHORTCUT_KEYS[i] : undefined;
        const active = value === c.id;
        const outside = c.kind === 'excluded' || c.kind === 'income';
        return (
          <Tap
            key={c.id}
            onClick={() => onPick(c.id)}
            ariaPressed={active}
            ariaKeyshortcuts={key}
            scaleTo={0.95}
            className={`flex min-h-[50px] items-center gap-2 rounded-md border px-3 py-2 text-left ${outside && !active ? 'border-dashed' : ''}`}
            style={
              active
                ? { background: 'var(--accent-tint)', borderColor: 'var(--accent-rim-strong)', boxShadow: '0 0 16px var(--accent-halo), inset 0 1px 0 var(--highlight)' }
                : { background: 'var(--glass-pane-fill)', borderColor: 'var(--glass-pane-rim)', boxShadow: 'inset 0 1px 0 var(--glass-pane-spec)' }
            }
          >
            <span aria-hidden className="text-[18px]">
              {c.emoji}
            </span>
            <span className={`t-small min-w-0 flex-1 font-semibold leading-tight ${active ? 'text-accent' : ''}`}>{c.name}</span>
            {key && <kbd className="rounded-[6px] border px-1.5 text-[11px] text-muted" style={{ borderColor: 'var(--border)' }}>{key.toUpperCase()}</kbd>}
          </Tap>
        );
      })}
    </div>
  );
}
