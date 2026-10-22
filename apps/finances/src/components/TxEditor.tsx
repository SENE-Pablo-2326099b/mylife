import { useEffect, useState } from 'react';
import { useLatest } from '../hooks';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Category, Transaction } from '../db/types';
import { resetToAuto } from '../domain/classifyDb';
import { CAT } from '../domain/defaults';
import { learnFromCorrection, type LearnMode } from '../domain/learn';
import { suggestKeyword } from '../domain/rules';
import { addDays, formatDay, formatShort } from '../lib/dates';
import { formatCents } from '../ui/money';
import { Sheet } from '../ui/Sheet';
import { Badge, Button, Glass, Money, Segmented, SelectField, TextField } from '../ui/primitives';
import { toast } from '../ui/toastStore';
import { logError } from '../ui/errorLog';
import { CategoryPicker } from './CategoryPicker';

/** Feuille d'une opération : catégorie, apprentissage (règle), personne, note. */
export function TxEditor({ tx, categories, onClose }: { tx: Transaction | null; categories: Category[]; onClose: () => void }) {
  const shown = useLatest(tx);
  return (
    <Sheet open={tx !== null} onClose={onClose} title="Opération">
      {shown && <TxEditorBody key={shown.id} tx={shown} categories={categories} onClose={onClose} />}
    </Sheet>
  );
}

function TxEditorBody({ tx, categories, onClose }: { tx: Transaction; categories: Category[]; onClose: () => void }) {
  const account = useLiveQuery(() => db.accounts.get(tx.accountId), [tx.accountId]);
  const rule = useLiveQuery(async () => (tx.ruleId ? ((await db.rules.get(tx.ruleId)) ?? null) : null), [tx.ruleId]);
  const [picked, setPicked] = useState<string | null>(null);
  const [mode, setMode] = useState<LearnMode>('create');
  const [keyword, setKeyword] = useState(suggestKeyword(tx.label));
  const [person, setPerson] = useState(tx.person ?? tx.counterparty ?? '');
  const [note, setNote] = useState(tx.note);
  const [refundOf, setRefundOf] = useState(tx.refundOf ?? '');
  // Un crédit peut rembourser une dépense précise (90 jours avant) : il la réduit au lieu d'être neutre.
  const candidates = useLiveQuery(async () => {
    if (tx.amount <= 0) return [];
    const kinds = new Map(categories.map((c) => [c.id, c.kind]));
    const list = await db.transactions.where('date').between(addDays(tx.date, -90), tx.date, true, true).toArray();
    return list
      .filter((t) => t.amount < 0 && (t.categoryId === null || kinds.get(t.categoryId) === 'variable'))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 40);
  }, [tx.id, tx.amount, tx.date, categories]);

  useEffect(() => {
    if (rule) setMode('update');
  }, [rule]);

  const category = categories.find((c) => c.id === tx.categoryId);
  const target = picked ?? tx.categoryId;
  const refundChanged = refundOf !== (tx.refundOf ?? '');
  const dirty = !!picked || note !== tx.note || person !== (tx.person ?? tx.counterparty ?? '') || refundChanged;

  // La feuille se ferme tout de suite ; le classement (et sa règle) s'applique derrière. Un second
  // toucher pendant l'enregistrement est ignoré ; une erreur est dite, jamais silencieuse.
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    onClose();
    try {
      if (refundChanged) await db.transactions.update(tx.id, { refundOf: refundOf || null });
      if (picked) {
        const changed = await learnFromCorrection({
          txId: tx.id,
          categoryId: picked,
          mode,
          keyword,
          person: picked === CAT.remboursements ? person : null,
        });
        if (note !== tx.note) await db.transactions.update(tx.id, { note });
        const cat = categories.find((c) => c.id === picked);
        toast({
          message: changed > 0 ? `${cat?.emoji ?? ''} ${cat?.name ?? ''} · ${changed} autre${changed > 1 ? 's' : ''} reclassée${changed > 1 ? 's' : ''}` : `Classée en ${cat?.emoji ?? ''} ${cat?.name ?? ''}`,
        });
      } else if (note !== tx.note || person !== (tx.person ?? tx.counterparty ?? '')) {
        await db.transactions.update(tx.id, {
          note,
          ...(tx.categoryId === CAT.remboursements ? { person } : {}),
        });
      }
      if (refundChanged && !picked)
        toast({
          message: refundOf ? 'Remboursement rattaché : la dépense est réduite d’autant' : 'Remboursement détaché',
        });
    } catch (e) {
      logError('opération', e);
      toast({
        message: `Modification non enregistrée : ${e instanceof Error ? e.message : String(e)}`,
        tone: 'danger',
      });
    }
  };

  const modes = [...(rule ? [{ value: 'update' as const, label: 'Modifier la règle' }] : []), { value: 'create' as const, label: 'Nouvelle règle' }, { value: 'only' as const, label: 'Cette fois' }];

  return (
    <div className="space-y-4">
      <Glass level="raised" className="rounded-md p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="t-headline">{tx.label}</p>
            <p className="t-small text-secondary">
              {formatDay(tx.date)} · {account ? `${account.bank} ${account.name}` : tx.accountId}
            </p>
          </div>
          <Money cents={tx.amount} sign tone="auto" className="text-[20px]" />
        </div>
        {tx.rawText && tx.rawText !== tx.label && <p className="t-caption mt-2 break-words text-muted">{tx.rawText}</p>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tx.pending && <Badge tone="warning">En attente</Badge>}
          {tx.transferPairId && <Badge tone="info">Transfert apparié</Badge>}
          {tx.categorySource === 'manual' && <Badge tone="accent">Corrigé à la main</Badge>}
          {tx.categorySource === 'rule' && rule && <Badge>Règle : {rule.label}</Badge>}
          {category && (
            <Badge>
              {category.emoji} {category.name}
            </Badge>
          )}
        </div>
      </Glass>

      <CategoryPicker categories={categories} value={target} onPick={setPicked} />

      {picked && picked !== tx.categoryId && (
        <div className="space-y-2">
          <p className="t-label text-muted">Pour les prochaines fois</p>
          <Segmented options={modes} value={mode} onChange={setMode} label="Apprentissage" />
          {mode === 'create' && <TextField label="Mot-clé de la règle" value={keyword} onChange={setKeyword} mono hint="Les opérations dont le libellé contient ce texte seront classées ici." />}
          {mode === 'update' && rule && (
            <p className="t-small text-secondary">
              La règle « {rule.label} » <span className="font-mono text-muted">({rule.pattern})</span> classera désormais ici.
            </p>
          )}
        </div>
      )}

      {target === CAT.remboursements && <TextField label="Personne" value={person} onChange={setPerson} />}
      {tx.amount > 0 && (candidates?.length ?? 0) > 0 && (
        <SelectField
          label="Rembourse une dépense"
          value={refundOf}
          onChange={setRefundOf}
          options={[
            { value: '', label: 'Aucune (neutre)' },
            ...(candidates ?? []).map((t) => ({
              value: t.id,
              label: `${formatShort(t.date)} · ${t.label} · ${formatCents(-t.amount)}`,
            })),
          ]}
          hint="Ex. un ami te rembourse sa part du resto : la dépense est réduite au lieu de compter en entier."
        />
      )}
      <TextField label="Note" value={note} onChange={setNote} placeholder="Facultatif" />

      <div className="flex flex-wrap gap-2 pt-1">
        <Button className="flex-1" disabled={!dirty || saving} onClick={() => void save()}>
          Enregistrer
        </Button>
        {tx.categorySource === 'manual' && (
          <Button
            variant="ghost"
            onClick={() => {
              onClose();
              void resetToAuto(tx.id).catch((e: unknown) => {
                logError('opération', e);
                toast({
                  message: 'Retour au classement auto impossible',
                  tone: 'danger',
                });
              });
            }}
          >
            Classement auto
          </Button>
        )}
      </div>
    </div>
  );
}
