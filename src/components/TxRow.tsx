import type { Account, Category, Transaction } from '../db/types';
import { formatShort } from '../lib/dates';
import { Badge, Money } from './ui';

export function TxRow({ tx, category, account, onClick }: { tx: Transaction; category?: Category; account?: Account; onClick?: () => void }) {
  const excluded = category && (category.kind === 'excluded' || category.kind === 'income');
  return (
    <li>
      <button type="button" onClick={onClick} className="flex min-h-[56px] w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-raised">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-raised text-lg">
          {category?.emoji ?? '❔'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{tx.label}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
            <span className="truncate">
              {formatShort(tx.date)} · {category?.name ?? 'À classer'}
              {account && ` · ${account.bank}`}
              {tx.categorySource === 'manual' && <span title="Corrigé à la main"> ✎</span>}
            </span>
            {tx.pending && (
              <span className="shrink-0">
                <Badge tone="warn">en attente</Badge>
              </span>
            )}
          </span>
        </span>
        <Money cents={tx.amount} sign className={`text-sm font-semibold ${tx.amount > 0 ? 'text-good' : ''} ${excluded ? 'opacity-60' : ''}`} />
      </button>
    </li>
  );
}
