import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { CategoryPicker, SHORTCUT_KEYS } from '../components/CategoryPicker';
import { Badge, Button, EmptyState, Money, PageTitle, Toggle, inputClass } from '../components/ui';
import { db } from '../db/db';
import type { Transaction } from '../db/types';
import { CAT } from '../domain/defaults';
import { learnFromCorrection } from '../domain/learn';
import { suggestKeyword } from '../domain/rules';
import { formatDay } from '../lib/dates';
import { useAccounts, useCategories } from '../hooks';

const NO_TX: Transaction[] = [];

export default function QueuePage() {
  const categories = useCategories();
  const accounts = useAccounts();
  const queue = useLiveQuery(() => db.transactions.filter((t) => t.categoryId === null).toArray(), []) ?? NO_TX;
  const sorted = useMemo(() => [...queue].sort((a, b) => b.date.localeCompare(a.date)), [queue]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [learn, setLearn] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [flash, setFlash] = useState<string | null>(null);

  const pending = sorted.filter((t) => !skipped.includes(t.id));
  const current = pending[0] ?? null;

  useEffect(() => {
    if (current) setKeyword(suggestKeyword(current.label));
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (categoryId: string) => {
    if (!current) return;
    const others = await learnFromCorrection({
      txId: current.id,
      categoryId,
      mode: learn && keyword.trim() ? 'create' : 'only',
      keyword,
      person: categoryId === CAT.remboursements ? current.counterparty : null,
    });
    const cat = categories.find((c) => c.id === categoryId);
    setFlash(`${current.label} → ${cat?.emoji ?? ''} ${cat?.name ?? ''}${others ? ` (+${others} similaire${others > 1 ? 's' : ''})` : ''}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current || e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        setSkipped((s) => [...s, current.id]);
        return;
      }
      if (e.key === 'ArrowLeft' && skipped.length) {
        setSkipped((s) => s.slice(0, -1));
        return;
      }
      const idx = SHORTCUT_KEYS.indexOf(e.key.toLowerCase());
      if (idx !== -1 && categories[idx]) {
        e.preventDefault();
        void pick(categories[idx].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const account = current && accounts.find((a) => a.id === current.accountId);

  return (
    <div className="space-y-4">
      <PageTitle sub={`${queue.length} opération${queue.length > 1 ? 's' : ''} sans catégorie`}>À classer</PageTitle>
      {flash && (
        <p role="status" className="rounded-xl bg-good/10 p-2 text-sm text-good">
          ✓ {flash}
        </p>
      )}
      {!current ? (
        <EmptyState title={queue.length ? 'Tu as passé toutes les opérations restantes' : 'Tout est classé 🎉'}>
          {queue.length > 0 && (
            <Button variant="ghost" onClick={() => setSkipped([])}>
              Revoir les opérations passées
            </Button>
          )}
          {!queue.length && <Link to="/" className="text-accent underline">Retour à l’accueil</Link>}
        </EmptyState>
      ) : (
        <>
          <article className="rounded-2xl border border-line bg-surface p-4" aria-live="polite">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold">{current.label}</p>
                <p className="text-sm text-muted">
                  {formatDay(current.date)} · {account?.bank ?? ''} {current.pending && <Badge tone="warn">en attente</Badge>}
                </p>
              </div>
              <Money cents={current.amount} sign className={`text-xl font-bold ${current.amount > 0 ? 'text-good' : ''}`} />
            </div>
            {current.rawText !== current.label && <p className="mt-2 break-words text-xs text-muted">{current.rawText}</p>}
          </article>

          <div className="rounded-2xl border border-line/60 bg-surface p-3">
            <Toggle label="Créer une règle avec ce choix" hint="Les opérations similaires seront classées automatiquement." checked={learn} onChange={setLearn} />
            {learn && <input className={`${inputClass} mt-2`} value={keyword} onChange={(e) => setKeyword(e.target.value)} aria-label="Mot-clé de la règle" />}
          </div>

          <CategoryPicker categories={categories} onPick={(id) => void pick(id)} shortcuts />

          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" disabled={!skipped.length} onClick={() => setSkipped((s) => s.slice(0, -1))}>
              ← Précédente
            </Button>
            <Button variant="ghost" className="flex-1" onClick={() => setSkipped((s) => [...s, current.id])}>
              Passer →
            </Button>
          </div>
          <p className="hidden text-center text-xs text-muted sm:block">Clavier : touches affichées pour classer, Espace ou → pour passer, ← pour revenir.</p>
        </>
      )}
    </div>
  );
}
