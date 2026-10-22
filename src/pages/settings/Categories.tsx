import { useState } from 'react';
import { useLatest } from '../../hooks';
import { db } from '../../db/db';
import { changeWithUndo } from '../../db/undo';
import type { Category, CategoryKind } from '../../db/types';
import { useCategories } from '../../hooks';
import { formatCents } from '../../ui/money';
import { uid } from '../../lib/text';
import { Badge, Button, Divider, Field, Group, IconButton, MoneyField, Reveal, SelectField, Sheet, Tap, TextField, ToggleRow } from '../../ui/index';
import { Screen } from '../../ui/Screen';

const KIND_LABELS: Record<CategoryKind, string> = {
  variable: 'Dépense courante (enveloppe)',
  fixed: 'Charge fixe',
  income: 'Revenu',
  excluded: 'Hors budget',
};

function CategoryForm({ cat, onClose }: { cat: Category; onClose: () => void }) {
  const save = (patch: Partial<Category>) => void db.categories.update(cat.id, patch);
  const remove = async () => {
    onClose();
    await changeWithUndo(
      `${cat.emoji} ${cat.name} supprimée`,
      async () => ({
        categories: [cat],
        transactions: await db.transactions.where('categoryId').equals(cat.id).toArray(),
        rules: await db.rules.where('categoryId').equals(cat.id).toArray(),
      }),
      () =>
        db.transaction('rw', [db.categories, db.transactions, db.rules], async () => {
          await db.transactions.where('categoryId').equals(cat.id).modify({ categoryId: null, categorySource: null, ruleId: null });
          await db.rules.where('categoryId').equals(cat.id).delete();
          await db.categories.delete(cat.id);
        }),
    );
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[72px_1fr] gap-3">
        <Field label="Icône">{(id) => <input id={id} className="field-input text-center text-[20px]" defaultValue={cat.emoji} maxLength={4} onBlur={(e) => save({ emoji: e.target.value || '•' })} />}</Field>
        <TextField label="Nom" value={cat.name} onCommit={(name) => name.trim() && save({ name: name.trim() })} />
      </div>
      <SelectField label="Type" value={cat.kind} onChange={(kind) => save({ kind })} options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value: value as CategoryKind, label }))} hint={cat.kind === 'excluded' ? 'Ni dépense ni revenu : transferts, épargne, remboursements entre amis.' : cat.kind === 'fixed' ? 'Comptée dans le cycle, hors budget du jour (déjà prévue dans tes charges fixes).' : undefined} />
      {(cat.kind === 'variable' || cat.kind === 'fixed') && <MoneyField label="Objectif par cycle" value={cat.target} allowEmpty onCommit={(v) => save({ target: v === null ? null : Math.abs(v) })} hint="Vide = pas d’objectif" />}
      <Divider />
      <ToggleRow label="Compte dans la part « nourriture »" checked={cat.isFood} onChange={(isFood) => save({ isFood })} />
      {!cat.system && (
        <Button variant="danger" icon="trash" onClick={() => void remove()}>
          Supprimer la catégorie
        </Button>
      )}
    </div>
  );
}

export default function CategoriesPage() {
  const categories = useCategories();
  const [open, setOpen] = useState<string | null>(null);
  const current = categories.find((c) => c.id === open) ?? null;
  const shown = useLatest(current);

  const move = async (index: number, delta: number) => {
    const target = index + delta;
    const a = categories[index];
    const b = categories[target];
    if (!a || !b) return;
    await db.transaction('rw', db.categories, async () => {
      await db.categories.update(a.id, { order: b.order });
      await db.categories.update(b.id, { order: a.order });
    });
  };

  const add = async () => {
    const id = uid('c');
    const order = Math.max(0, ...categories.map((c) => c.order)) + 1;
    await db.categories.put({ id, name: 'Nouvelle catégorie', emoji: '🏷️', color: '#94A3B8', kind: 'variable', target: null, isFood: false, order });
    setOpen(id);
  };

  return (
    <Screen
      stack
      title="Catégories et objectifs"
      kicker="L’ordre définit aussi les raccourcis clavier"
      mood="settings"
      back="/reglages"
      footer={
        <Button size="lg" icon="add" className="w-full" onClick={() => void add()}>
          Nouvelle catégorie
        </Button>
      }
    >
      <Reveal>
        <Group>
          {categories.map((c, i) => (
            <div key={c.id} className="flex items-center pr-1">
              <Tap onClick={() => setOpen(c.id)} scaleTo={0.985} className="flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2 pl-4 pr-1 text-left">
                <span aria-hidden className="text-[18px]">
                  {c.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="t-body-strong block truncate">{c.name}</span>
                  <span className="t-caption block truncate text-muted">
                    {KIND_LABELS[c.kind]}
                    {c.target !== null && ` · objectif ${formatCents(c.target, { compact: true })}`}
                  </span>
                </span>
                {c.isFood && <Badge>nourriture</Badge>}
              </Tap>
              <IconButton icon="chevron-up" size={18} label={`Monter ${c.name}`} onClick={() => void move(i, -1)} className={i === 0 ? 'invisible' : ''} />
              <IconButton icon="chevron-down" size={18} label={`Descendre ${c.name}`} onClick={() => void move(i, 1)} className={i === categories.length - 1 ? 'invisible' : ''} />
            </div>
          ))}
        </Group>
      </Reveal>
      <Sheet open={current !== null} onClose={() => setOpen(null)} title={shown ? `${shown.emoji} ${shown.name}` : ''}>
        {shown && <CategoryForm key={shown.id} cat={shown} onClose={() => setOpen(null)} />}
      </Sheet>
    </Screen>
  );
}
