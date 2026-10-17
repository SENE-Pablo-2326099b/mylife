import { useState } from 'react';
import { Badge, Button, Field, MoneyField, PageTitle, Toggle, inputClass } from '../../components/ui';
import { db } from '../../db/db';
import type { Category, CategoryKind } from '../../db/types';
import { useCategories } from '../../hooks';
import { formatCents } from '../../lib/money';
import { uid } from '../../lib/text';
import { BackLink } from './common';

const KIND_LABELS: Record<CategoryKind, string> = {
  variable: 'Dépense courante (enveloppe)',
  fixed: 'Charge fixe',
  income: 'Revenu',
  excluded: 'Exclue du budget',
};

function CategoryEditor({ cat, onDone }: { cat: Category; onDone: () => void }) {
  const save = (patch: Partial<Category>) => void db.categories.update(cat.id, patch);
  const remove = async () => {
    if (!confirm(`Supprimer « ${cat.name} » ? Ses opérations repasseront « à classer » et ses règles seront supprimées.`)) return;
    await db.transaction('rw', [db.categories, db.transactions, db.rules], async () => {
      await db.transactions.where('categoryId').equals(cat.id).modify({ categoryId: null, categorySource: null, ruleId: null });
      await db.rules.where('categoryId').equals(cat.id).delete();
      await db.categories.delete(cat.id);
    });
    onDone();
  };
  return (
    <div className="space-y-3 border-t border-line/60 p-3">
      <div className="grid grid-cols-[72px_1fr] gap-3">
        <Field label="Icône">
          {(id) => <input id={id} className={`${inputClass} text-center text-lg`} defaultValue={cat.emoji} maxLength={4} onBlur={(e) => save({ emoji: e.target.value || '•' })} />}
        </Field>
        <Field label="Nom">
          {(id) => <input id={id} className={inputClass} defaultValue={cat.name} onBlur={(e) => e.target.value.trim() && save({ name: e.target.value.trim() })} />}
        </Field>
      </div>
      <Field label="Type">
        {(id) => (
          <select id={id} className={inputClass} value={cat.kind} onChange={(e) => save({ kind: e.target.value as CategoryKind })}>
            {Object.entries(KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        )}
      </Field>
      {(cat.kind === 'variable' || cat.kind === 'fixed') && (
        <MoneyField label="Objectif par cycle" value={cat.target} allowEmpty onCommit={(v) => save({ target: v === null ? null : Math.abs(v) })} hint="Vide = pas d’objectif" />
      )}
      <Toggle label="Compte dans la part « nourriture »" checked={cat.isFood} onChange={(isFood) => save({ isFood })} />
      {!cat.system && (
        <Button variant="danger" onClick={() => void remove()}>
          Supprimer la catégorie
        </Button>
      )}
    </div>
  );
}

export default function CategoriesPage() {
  const categories = useCategories();
  const [open, setOpen] = useState<string | null>(null);

  const move = async (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= categories.length) return;
    const a = categories[index];
    const b = categories[target];
    await db.transaction('rw', db.categories, async () => {
      await db.categories.update(a.id, { order: b.order });
      await db.categories.update(b.id, { order: a.order });
    });
  };

  const add = async () => {
    const id = uid('c');
    const order = Math.max(0, ...categories.map((c) => c.order)) + 1;
    await db.categories.put({ id, name: 'Nouvelle catégorie', emoji: '🏷️', color: '#8a8a85', kind: 'variable', target: null, isFood: false, order });
    setOpen(id);
  };

  return (
    <div className="space-y-4">
      <BackLink />
      <PageTitle sub="L’ordre définit aussi les raccourcis de la file « à classer »">Catégories et objectifs</PageTitle>
      <ul className="overflow-hidden rounded-2xl border border-line/60 bg-surface">
        {categories.map((c, i) => (
          <li key={c.id} className="border-b border-line/60 last:border-b-0">
            <div className="flex items-center gap-1 px-2">
              <button
                className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 px-1 text-left"
                onClick={() => setOpen(open === c.id ? null : c.id)}
                aria-expanded={open === c.id}
              >
                <span aria-hidden className="text-lg">
                  {c.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {KIND_LABELS[c.kind]}
                    {c.target !== null && ` · objectif ${formatCents(c.target, { compact: true })}`}
                  </span>
                </span>
                {c.isFood && <Badge>nourriture</Badge>}
              </button>
              <button
                className="h-11 w-9 rounded-lg text-muted hover:bg-raised disabled:opacity-30"
                onClick={() => void move(i, -1)}
                disabled={i === 0}
                aria-label={`Monter ${c.name}`}
              >
                ↑
              </button>
              <button
                className="h-11 w-9 rounded-lg text-muted hover:bg-raised disabled:opacity-30"
                onClick={() => void move(i, 1)}
                disabled={i === categories.length - 1}
                aria-label={`Descendre ${c.name}`}
              >
                ↓
              </button>
            </div>
            {open === c.id && <CategoryEditor cat={c} onDone={() => setOpen(null)} />}
          </li>
        ))}
      </ul>
      <Button variant="primary" onClick={() => void add()}>
        + Nouvelle catégorie
      </Button>
    </div>
  );
}
