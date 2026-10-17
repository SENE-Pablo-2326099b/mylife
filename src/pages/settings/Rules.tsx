import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { Badge, Button, Field, MoneyField, NumberField, PageTitle, Toggle, inputClass } from '../../components/ui';
import { db } from '../../db/db';
import type { Category, Rule, RuleDirection } from '../../db/types';
import { reapplyRules } from '../../domain/classifyDb';
import { CAT } from '../../domain/defaults';
import { countRuleMatches, newRule } from '../../domain/learn';
import { validatePattern } from '../../domain/rules';
import { formatCents } from '../../lib/money';
import { normalizeText } from '../../lib/text';
import { useCategories, useRules } from '../../hooks';
import { BackLink } from './common';

function RuleForm({ initial, categories, onClose }: { initial: Rule; categories: Category[]; onClose: () => void }) {
  const [rule, setRule] = useState(initial);
  const [matches, setMatches] = useState<number | null>(null);
  const error = validatePattern(rule.pattern, rule.isRegex);
  const set = (patch: Partial<Rule>) => setRule((r) => ({ ...r, ...patch }));
  const isNew = !initial.pattern;

  useEffect(() => {
    if (error) {
      setMatches(null);
      return;
    }
    const h = setTimeout(() => void countRuleMatches(rule).then(setMatches), 250);
    return () => clearTimeout(h);
  }, [rule, error]);

  const save = async () => {
    await db.rules.put({ ...rule, label: rule.label.trim() || rule.pattern });
    await reapplyRules();
    onClose();
  };
  const remove = async () => {
    if (!confirm(`Supprimer la règle « ${rule.label} » ?`)) return;
    await db.rules.delete(rule.id);
    await reapplyRules();
    onClose();
  };

  return (
    <Sheet title={isNew ? 'Nouvelle règle' : 'Modifier la règle'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nom du commerçant">{(id) => <input id={id} className={inputClass} value={rule.label} onChange={(e) => set({ label: e.target.value })} />}</Field>
        <Field
          label={rule.isRegex ? 'Expression régulière' : 'Mot-clé'}
          hint={
            error && rule.pattern ? (
              <span className="text-bad">{error}</span>
            ) : rule.isRegex ? (
              'Appliquée au libellé en minuscules, sans accents, ponctuation remplacée par des espaces.'
            ) : (
              'Insensible à la casse et aux accents. Le libellé doit contenir ce texte (ou tous ses mots).'
            )
          }
        >
          {(id) => (
            <input
              id={id}
              className={`${inputClass} font-mono`}
              value={rule.pattern}
              onChange={(e) => set({ pattern: e.target.value })}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          )}
        </Field>
        <Toggle label="Expression régulière" checked={rule.isRegex} onChange={(v) => set({ isRegex: v })} />
        <Field label="Catégorie">
          {(id) => (
            <select id={id} className={inputClass} value={rule.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        {rule.categoryId === CAT.remboursements && (
          <Field label="Personne">{(id) => <input id={id} className={inputClass} value={rule.person ?? ''} onChange={(e) => set({ person: e.target.value || null })} />}</Field>
        )}
        <Field label="Sens">
          {(id) => (
            <select id={id} className={inputClass} value={rule.direction} onChange={(e) => set({ direction: e.target.value as RuleDirection })}>
              <option value="any">Débits et crédits</option>
              <option value="debit">Débits uniquement</option>
              <option value="credit">Crédits uniquement</option>
            </select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label="Montant min." value={rule.minAmount} allowEmpty onCommit={(v) => set({ minAmount: v === null ? null : Math.abs(v) })} />
          <MoneyField label="Montant max." value={rule.maxAmount} allowEmpty onCommit={(v) => set({ maxAmount: v === null ? null : Math.abs(v) })} />
        </div>
        <NumberField
          label="Priorité"
          value={rule.priority}
          min={-100}
          max={100}
          onCommit={(priority) => set({ priority })}
          hint="La règle de plus forte priorité l’emporte. Tes règles : 25 par défaut."
        />
        <Toggle label="Active" checked={rule.enabled} onChange={(enabled) => set({ enabled })} />
        {matches !== null && (
          <p className="text-sm text-muted">
            Correspond à <strong className="text-ink">{matches}</strong> opération{matches > 1 ? 's' : ''} déjà synchronisée{matches > 1 ? 's' : ''}.
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <Button variant="primary" className="flex-1" disabled={!!error} onClick={() => void save()}>
            Enregistrer
          </Button>
          {!isNew && (
            <Button variant="danger" onClick={() => void remove()}>
              Supprimer
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

export default function RulesPage() {
  const rules = useRules();
  const categories = useCategories();
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [editing, setEditing] = useState<Rule | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const filtered = useMemo(() => {
    const q = normalizeText(query);
    return rules
      .filter((r) => (!catFilter || r.categoryId === catFilter) && (!q || normalizeText(`${r.label} ${r.pattern}`).includes(q)))
      .sort(
        (a, b) =>
          (catMap.get(a.categoryId)?.order ?? 99) - (catMap.get(b.categoryId)?.order ?? 99) || b.priority - a.priority || a.label.localeCompare(b.label),
      );
  }, [rules, query, catFilter, catMap]);

  return (
    <div className="space-y-4">
      <BackLink />
      <PageTitle sub={`${rules.length} règles · appliquées dans l’ordre de priorité`}>Règles de classement</PageTitle>
      <div className="flex gap-2">
        <input className={inputClass} placeholder="Rechercher" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher une règle" />
        <select className={`${inputClass} max-w-[45%]`} value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label="Filtrer par catégorie">
          <option value="">Toutes</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setEditing(newRule({ categoryId: catFilter || CAT.autres, pattern: '', label: '' }))}>
          + Nouvelle règle
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            void reapplyRules().then((r) => setMsg(`${r.changed} opération(s) reclassée(s), ${r.unclassified} à classer. Les corrections manuelles sont conservées.`))
          }
        >
          Réappliquer à tout l’historique
        </Button>
      </div>
      {msg && <p className="text-sm text-good">{msg}</p>}
      <ul className="divide-y divide-line/60 rounded-2xl border border-line/60 bg-surface">
        {filtered.map((r) => {
          const c = catMap.get(r.categoryId);
          return (
            <li key={r.id}>
              <button
                className={`flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left hover:bg-raised ${r.enabled ? '' : 'opacity-50'}`}
                onClick={() => setEditing(r)}
              >
                <span aria-hidden className="text-lg">
                  {c?.emoji ?? '❔'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.label}</span>
                  <span className="block truncate font-mono text-xs text-muted">{r.pattern}</span>
                </span>
                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                  {r.isRegex && <Badge>regex</Badge>}
                  {r.direction !== 'any' && <Badge>{r.direction === 'debit' ? 'débit' : 'crédit'}</Badge>}
                  {r.minAmount !== null && <Badge>≥ {formatCents(r.minAmount, { compact: true })}</Badge>}
                  {r.maxAmount !== null && <Badge>≤ {formatCents(r.maxAmount, { compact: true })}</Badge>}
                  {!r.enabled && <Badge tone="warn">inactive</Badge>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {editing && <RuleForm initial={editing} categories={categories} onClose={() => setEditing(null)} />}
    </div>
  );
}
