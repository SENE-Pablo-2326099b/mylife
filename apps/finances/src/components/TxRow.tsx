import type { Account, Category, Transaction } from '../db/types';
import { formatShort } from '../lib/dates';
import { Badge, IconBubble, Money, Tap } from '../ui/primitives';

/** Une opération = une ligne : catégorie · libellé · date, catégorie, compte · montant. */
export function TxRow({ tx, category, account, onClick, showDate = true }: { tx: Transaction; category?: Category; account?: Account; onClick?: () => void; showDate?: boolean }) {
  const outside = category && (category.kind === 'excluded' || category.kind === 'income');
  const meta = [showDate ? formatShort(tx.date) : null, category?.name ?? 'À classer', account?.bank].filter(Boolean).join(' · ');
  return (
    <Tap onClick={onClick} scaleTo={0.985} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left">
      <IconBubble emoji={category?.emoji ?? '❔'} tone={category ? undefined : 'warning'} />
      <span className="min-w-0 flex-1">
        <span className="t-body-strong block truncate">{tx.label}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="t-small truncate text-secondary">
            {meta}
            {tx.categorySource === 'manual' && <span title="Corrigé à la main"> ✎</span>}
          </span>
          {tx.pending && (
            <span className="shrink-0">
              <Badge tone="warning">en attente</Badge>
            </span>
          )}
        </span>
      </span>
      <Money cents={tx.amount} sign tone={tx.amount > 0 && !outside ? 'success' : outside ? 'muted' : undefined} className="text-[15px]" />
    </Tap>
  );
}
