import type { Account } from '../db/types';
import type { ExceptionalIncome } from '../domain/budgetEngine';
import { allocateExceptional } from '../domain/useBudget';
import { formatShort } from '../lib/dates';
import { Card, Money, Segmented, Sheet } from '../ui/index';

const CHOICES = [
  { value: 'none', label: 'À décider' },
  { value: 'envelope', label: 'Au budget' },
  { value: 'savings', label: 'De côté' },
] as const;

/**
 * Revenus exceptionnels (rappel d'aide, prime, gros remboursement) : ils n'augmentent pas
 * l'enveloppe d'eux-mêmes. « Au budget » les ajoute à ce cycle, « De côté » les laisse hors budget.
 */
export function ExceptionalSheet({ open, onClose, items, accounts }: { open: boolean; onClose: () => void; items: ExceptionalIncome[]; accounts: Map<string, Account> }) {
  return (
    <Sheet open={open} onClose={onClose} title="Revenus exceptionnels">
      <p className="t-small mb-3 text-secondary">
        Ces rentrées ne correspondent à aucun de tes revenus habituels. Elles ne gonflent pas ton budget du jour tant que tu ne décides pas : ajoute-les au budget de ce cycle, ou garde-les de côté.
      </p>
      <div className="space-y-2">
        {items.map(({ tx, allocation }) => (
          <Card key={tx.id}>
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="t-body-strong block truncate">{tx.label}</span>
                <span className="t-small block text-secondary">
                  {formatShort(tx.date)} · {accounts.get(tx.accountId)?.bank ?? 'Compte'}
                </span>
              </span>
              <Money cents={tx.amount} sign tone="success" className="text-[16px]" />
            </div>
            <div className="mt-3">
              <Segmented options={CHOICES} value={allocation ?? 'none'} onChange={(v) => void allocateExceptional(tx.id, v === 'none' ? null : v)} label={`Affectation de ${tx.label}`} />
            </div>
          </Card>
        ))}
      </div>
    </Sheet>
  );
}
