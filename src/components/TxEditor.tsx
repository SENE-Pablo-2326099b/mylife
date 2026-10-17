import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Category, Transaction } from '../db/types';
import { resetToAuto } from '../domain/classifyDb';
import { CAT } from '../domain/defaults';
import { learnFromCorrection, type LearnMode } from '../domain/learn';
import { suggestKeyword } from '../domain/rules';
import { formatDay } from '../lib/dates';
import { CategoryPicker } from './CategoryPicker';
import { Sheet } from './Sheet';
import { Badge, Button, Field, Money, inputClass } from './ui';

export function TxEditor({ tx, categories, onClose }: { tx: Transaction; categories: Category[]; onClose: () => void }) {
  const account = useLiveQuery(() => db.accounts.get(tx.accountId), [tx.accountId]);
  const rule = useLiveQuery(async () => (tx.ruleId ? (await db.rules.get(tx.ruleId)) ?? null : null), [tx.ruleId]);
  const [picked, setPicked] = useState<string | null>(null);
  const [mode, setMode] = useState<LearnMode>('create');
  const [keyword, setKeyword] = useState(suggestKeyword(tx.label));
  const [person, setPerson] = useState(tx.person ?? tx.counterparty ?? '');
  const [note, setNote] = useState(tx.note);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (rule) setMode('update');
  }, [rule]);

  const category = categories.find((c) => c.id === tx.categoryId);
  const target = picked ?? tx.categoryId;

  const apply = async () => {
    if (!picked) return;
    const changed = await learnFromCorrection({ txId: tx.id, categoryId: picked, mode, keyword, person: picked === CAT.remboursements ? person : null });
    if (note !== tx.note) await db.transactions.update(tx.id, { note });
    if (changed > 0) {
      setResult(`${changed} autre(s) opération(s) reclassée(s) par la règle.`);
      setTimeout(onClose, 1200);
    } else onClose();
  };

  return (
    <Sheet title="Opération" onClose={onClose}>
      <div className="mb-4 rounded-2xl bg-raised p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">{tx.label}</p>
            <p className="text-sm text-muted">
              {formatDay(tx.date)} · {account ? `${account.bank} ${account.name}` : tx.accountId}
            </p>
          </div>
          <Money cents={tx.amount} sign className={`text-lg font-bold ${tx.amount > 0 ? 'text-good' : ''}`} />
        </div>
        {tx.rawText && tx.rawText !== tx.label && <p className="mt-2 break-words text-xs text-muted">{tx.rawText}</p>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tx.pending && <Badge tone="warn">En attente</Badge>}
          {tx.transferPairId && <Badge>Transfert apparié</Badge>}
          {tx.categorySource === 'manual' && <Badge tone="accent">Corrigé à la main</Badge>}
          {tx.categorySource === 'rule' && rule && <Badge>Règle : {rule.label}</Badge>}
          {category && <Badge>{category.emoji} {category.name}</Badge>}
        </div>
      </div>

      <CategoryPicker categories={categories} value={target} onPick={setPicked} />

      {picked && picked !== tx.categoryId && (
        <fieldset className="mt-4 space-y-2 rounded-2xl border border-line p-3">
          <legend className="px-1 text-sm text-muted">Pour les prochaines fois</legend>
          {rule && (
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="mode" checked={mode === 'update'} onChange={() => setMode('update')} className="mt-1" />
              <span>
                Mettre à jour la règle « {rule.label} » <span className="text-muted">({rule.pattern})</span>
              </span>
            </label>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="mode" checked={mode === 'create'} onChange={() => setMode('create')} className="mt-1" />
            <span className="flex-1">
              Créer une règle : toujours classer ce mot-clé ici
              {mode === 'create' && (
                <input className={`${inputClass} mt-1`} value={keyword} onChange={(e) => setKeyword(e.target.value)} aria-label="Mot-clé de la règle" />
              )}
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="mode" checked={mode === 'only'} onChange={() => setMode('only')} className="mt-1" />
            <span>Seulement cette opération</span>
          </label>
        </fieldset>
      )}

      {target === CAT.remboursements && (
        <div className="mt-3">
          <Field label="Personne">{(id) => <input id={id} className={inputClass} value={person} onChange={(e) => setPerson(e.target.value)} />}</Field>
        </div>
      )}

      <div className="mt-3">
        <Field label="Note">{(id) => <input id={id} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Facultatif" />}</Field>
      </div>

      {result && <p className="mt-3 text-sm text-good">{result}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="primary"
          className="flex-1"
          disabled={!picked && note === tx.note && person === (tx.person ?? tx.counterparty ?? '')}
          onClick={() => {
            if (picked) void apply();
            else
              void db.transactions
                .update(tx.id, { note, ...(tx.categoryId === CAT.remboursements ? { person } : {}) })
                .then(onClose);
          }}
        >
          Enregistrer
        </Button>
        {tx.categorySource === 'manual' && (
          <Button variant="ghost" onClick={() => void resetToAuto(tx.id).then(onClose)}>
            Revenir au classement auto
          </Button>
        )}
      </div>
    </Sheet>
  );
}
