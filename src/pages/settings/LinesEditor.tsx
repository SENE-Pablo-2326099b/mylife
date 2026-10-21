import { useState } from 'react';
import type { BudgetLine } from '../../db/types';
import { formatCents } from '../../lib/money';
import { uid } from '../../lib/text';
import { Button, Group, MoneyField, Row, Sheet, Stepper, TextField, Toggle, toast } from '../../ui/index';

/** Liste de lignes mensuelles (revenus ou charges fixes) : un tap pour modifier, suppression annulable. */
export function LinesEditor({
  lines,
  onChange,
  addLabel,
  emptyLabel,
  suggestions = [],
  icon,
  income = false,
}: {
  lines: BudgetLine[];
  onChange: (lines: BudgetLine[]) => void;
  addLabel: string;
  emptyLabel: string;
  suggestions?: string[];
  icon: 'cash' | 'receipt';
  /** Lignes de revenus : option « versé directement à un tiers » (APL au CROUS…). */
  income?: boolean;
}) {
  const [editing, setEditing] = useState<BudgetLine | null>(null);
  const isNew = editing !== null && !lines.some((l) => l.id === editing.id);

  const save = (line: BudgetLine) => {
    onChange(isNew ? [...lines, line] : lines.map((l) => (l.id === line.id ? line : l)));
    setEditing(null);
  };
  const remove = (line: BudgetLine) => {
    const before = lines;
    onChange(lines.filter((l) => l.id !== line.id));
    setEditing(null);
    toast({ message: `${line.label} supprimé`, actionLabel: 'Annuler', onAction: () => onChange(before) });
  };

  return (
    <>
      {lines.length > 0 ? (
        <Group>
          {lines.map((l) => (
            <Row
              key={l.id}
              icon={icon}
              title={l.label}
              subtitle={[l.day ? `le ${l.day} du mois` : 'jour non précisé', l.direct ? 'versé directement' : null].filter(Boolean).join(' · ')}
              right={<span className="num font-display font-semibold">{formatCents(l.amount)}</span>}
              chevron
              onClick={() => setEditing(l)}
            />
          ))}
        </Group>
      ) : (
        <p className="t-small px-0.5 text-muted">{emptyLabel}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon="add" onClick={() => setEditing({ id: uid('l'), label: '', amount: 0, day: null })}>
          {addLabel}
        </Button>
        {suggestions
          .filter((s) => !lines.some((l) => l.label === s))
          .slice(0, 3)
          .map((s) => (
            <Button key={s} variant="ghost" size="sm" onClick={() => setEditing({ id: uid('l'), label: s, amount: 0, day: null })}>
              + {s}
            </Button>
          ))}
      </div>
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={isNew ? addLabel : 'Modifier'}>
        {editing && <LineForm key={editing.id} line={editing} income={income} onSave={save} onDelete={isNew ? undefined : () => remove(editing)} />}
      </Sheet>
    </>
  );
}

function LineForm({ line, income, onSave, onDelete }: { line: BudgetLine; income: boolean; onSave: (l: BudgetLine) => void; onDelete?: () => void }) {
  const [draft, setDraft] = useState(line);
  const set = (patch: Partial<BudgetLine>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <div className="space-y-3">
      <TextField label="Libellé" value={draft.label} onChange={(label) => set({ label })} placeholder="Ex. Salaire, Loyer, Forfait…" />
      <MoneyField label="Montant par mois" value={draft.amount} onCommit={(v) => set({ amount: Math.abs(v ?? 0) })} />
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="t-body-strong">Jour connu</p>
          <p className="t-caption text-muted">Sert aux prévisions de trésorerie.</p>
        </div>
        <Toggle checked={draft.day !== null} onChange={(on) => set({ day: on ? (draft.day ?? 1) : null })} label="Jour connu" />
      </div>
      {draft.day !== null && <Stepper value={draft.day} min={1} max={31} onChange={(day) => set({ day })} format={(d) => `le ${d}`} label="Jour du mois" />}
      {income && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="t-body-strong">Versé directement à un tiers</p>
            <p className="t-caption text-muted">Ex. APL versée au CROUS : compte dans ton budget, mais n’arrive jamais sur ton compte (le loyer est débité net).</p>
          </div>
          <Toggle checked={!!draft.direct} onChange={(direct) => set({ direct })} label="Versé directement à un tiers" />
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <Button className="flex-1" disabled={!draft.label.trim() || draft.amount <= 0} onClick={() => onSave({ ...draft, label: draft.label.trim() })}>
          Enregistrer
        </Button>
        {onDelete && (
          <Button variant="danger" icon="trash" onClick={onDelete} label="Supprimer">
            Supprimer
          </Button>
        )}
      </div>
    </div>
  );
}
