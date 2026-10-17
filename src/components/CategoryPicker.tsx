import type { Category } from '../db/types';

export const SHORTCUT_KEYS = '1234567890azertyuiop';

export function CategoryPicker({
  categories,
  value,
  onPick,
  shortcuts = false,
}: {
  categories: Category[];
  value?: string | null;
  onPick: (id: string) => void;
  shortcuts?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="Choisir une catégorie">
      {categories.map((c, i) => {
        const key = shortcuts ? SHORTCUT_KEYS[i] : undefined;
        const active = value === c.id;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c.id)}
            aria-pressed={active}
            aria-keyshortcuts={key}
            className={`flex min-h-[48px] items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
              active ? 'border-accent bg-accent/15' : 'border-line bg-raised hover:border-muted'
            } ${c.kind === 'excluded' || c.kind === 'income' ? 'border-dashed' : ''}`}
          >
            <span aria-hidden className="text-lg">
              {c.emoji}
            </span>
            <span className="flex-1 leading-tight">{c.name}</span>
            {key && <kbd className="rounded border border-line px-1.5 text-[11px] text-muted">{key.toUpperCase()}</kbd>}
          </button>
        );
      })}
    </div>
  );
}
