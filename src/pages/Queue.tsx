import { useEffect, useMemo, useState } from 'react';
import { CategoryPicker, SHORTCUT_KEYS } from '../components/CategoryPicker';
import type { Transaction } from '../db/types';
import { CAT } from '../domain/defaults';
import { learnFromCorrection } from '../domain/learn';
import { suggestKeyword } from '../domain/rules';
import { formatDay } from '../lib/dates';
import { useAccounts, useCategories } from '../hooks';
import { Badge, Button, Card, EmptyState, Money, Reveal, toast, Toggle } from '../ui/index';
import { Screen } from '../ui/Screen';
import { Pending } from '../ui/extras';
import { useUnclassified } from '../domain/unclassified';

const NO_TX: Transaction[] = [];

/** File « à classer » : une opération à la fois, un tap (ou une touche) pour la classer. */
export default function QueuePage() {
  const categories = useCategories();
  const accounts = useAccounts();
  const queueRaw = useUnclassified();
  const queue = queueRaw ?? NO_TX;
  const sorted = useMemo(() => [...queue].sort((a, b) => b.date.localeCompare(a.date)), [queue]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [learn, setLearn] = useState(true);
  const [keyword, setKeyword] = useState('');

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
    toast({ message: `${current.label} → ${cat?.emoji ?? ''} ${cat?.name ?? ''}${others ? ` (+${others} similaire${others > 1 ? 's' : ''})` : ''}` });
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
      const c = categories[idx];
      if (idx !== -1 && c) {
        e.preventDefault();
        void pick(c.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const account = current && accounts.find((a) => a.id === current.accountId);

  return (
    <Screen stack title="À classer" kicker={`${queue.length} sans catégorie`} mood="activity" back="/operations">
      {queueRaw === undefined ? (
        <Pending cards={1} />
      ) : !current ? (
        <Card level="raised">
          <EmptyState
            icon={queue.length ? 'time' : 'check-circle'}
            title={queue.length ? 'Tu as passé les opérations restantes' : 'Tout est classé'}
            body={queue.length ? undefined : 'Les nouvelles opérations inconnues apparaîtront ici après chaque synchro.'}
            action={
              queue.length > 0 ? (
                <Button variant="secondary" onClick={() => setSkipped([])}>
                  Revoir les opérations passées
                </Button>
              ) : (
                <Button to="/" variant="secondary">
                  Accueil
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <Reveal key={current.id}>
            <Card level="raised" glow>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="t-title">{current.label}</p>
                  <p className="t-small mt-0.5 text-secondary">
                    {formatDay(current.date)} · {account?.bank ?? ''}
                  </p>
                  {current.pending && (
                    <span className="mt-1.5 inline-block">
                      <Badge tone="warning">en attente</Badge>
                    </span>
                  )}
                </div>
                <Money cents={current.amount} sign tone="auto" className="text-[22px]" />
              </div>
              {current.rawText !== current.label && <p className="t-caption mt-2 break-words text-muted">{current.rawText}</p>}
            </Card>
          </Reveal>

          <Card>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="t-body-strong">Retenir ce choix</p>
                <p className="t-caption text-muted">Crée une règle : les opérations similaires seront classées seules.</p>
              </div>
              <Toggle checked={learn} onChange={setLearn} label="Créer une règle avec ce choix" />
            </div>
            {learn && <input className="field-input mt-3 font-mono" value={keyword} onChange={(e) => setKeyword(e.target.value)} aria-label="Mot-clé de la règle" />}
          </Card>

          <CategoryPicker categories={categories} onPick={(id) => void pick(id)} shortcuts />

          <div className="flex gap-2">
            <Button variant="secondary" icon="chevron-back" className="flex-1" disabled={!skipped.length} onClick={() => setSkipped((s) => s.slice(0, -1))}>
              Précédente
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => setSkipped((s) => [...s, current.id])}>
              Passer
            </Button>
          </div>
          <p className="t-caption hidden text-center text-muted sm:block">Clavier : touches affichées pour classer, Espace ou → pour passer, ← pour revenir.</p>
        </div>
      )}
    </Screen>
  );
}
