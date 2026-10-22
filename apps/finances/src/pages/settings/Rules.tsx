import { useEffect, useMemo, useState } from 'react';
import { useLatest } from '../../hooks';
import { db } from '../../db/db';
import { changeWithUndo } from '../../db/undo';
import type { Category, Rule, RuleDirection } from '../../db/types';
import { reapplyRules } from '../../domain/classifyDb';
import { CAT } from '../../domain/defaults';
import { countRuleMatches, newRule } from '../../domain/learn';
import { validatePattern } from '../../domain/rules';
import { formatCents } from '../../ui/money';
import { normalizeText } from '../../lib/text';
import { useCategories, useRules } from '../../hooks';
import { Badge, Button, Divider, Field, Group, Icon, MoneyField, Reveal, Segmented, SelectField, Sheet, StepperRow, Tap, TextField, toast, ToggleRow } from '../../ui/index';
import { Screen } from '../../ui/Screen';

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
    const r = await reapplyRules();
    toast({ message: `Règle enregistrée${r.changed ? ` · ${r.changed} opération(s) reclassée(s)` : ''}` });
    onClose();
  };
  const remove = async () => {
    onClose();
    await changeWithUndo(
      `Règle « ${rule.label} » supprimée`,
      async () => ({ rules: [initial] }),
      async () => {
        await db.rules.delete(rule.id);
        await reapplyRules();
      },
      () => reapplyRules(),
    );
  };

  return (
    <div className="space-y-3">
      <TextField label="Nom du commerçant" value={rule.label} onChange={(label) => set({ label })} />
      <Field
        label={rule.isRegex ? 'Expression régulière' : 'Mot-clé'}
        error={error && rule.pattern ? error : undefined}
        hint={rule.isRegex ? 'Appliquée au libellé en minuscules, sans accents, ponctuation remplacée par des espaces.' : 'Insensible à la casse et aux accents. Le libellé doit contenir ce texte (ou tous ses mots).'}
      >
        {(id) => <input id={id} className="field-input font-mono" value={rule.pattern} onChange={(e) => set({ pattern: e.target.value })} autoCapitalize="off" autoCorrect="off" spellCheck={false} />}
      </Field>
      <SelectField label="Catégorie" value={rule.categoryId} onChange={(categoryId) => set({ categoryId })} options={categories.map((c) => ({ value: c.id, label: `${c.emoji} ${c.name}` }))} />
      {rule.categoryId === CAT.remboursements && <TextField label="Personne" value={rule.person ?? ''} onChange={(v) => set({ person: v || null })} />}
      <div>
        <p className="t-label mb-1.5 text-muted">Sens</p>
        <Segmented<RuleDirection>
          options={[
            { value: 'any', label: 'Tous' },
            { value: 'debit', label: 'Débits' },
            { value: 'credit', label: 'Crédits' },
          ]}
          value={rule.direction}
          onChange={(direction) => set({ direction })}
          label="Sens"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <MoneyField label="Montant min." value={rule.minAmount} allowEmpty onCommit={(v) => set({ minAmount: v === null ? null : Math.abs(v) })} />
        <MoneyField label="Montant max." value={rule.maxAmount} allowEmpty onCommit={(v) => set({ maxAmount: v === null ? null : Math.abs(v) })} />
      </div>
      <StepperRow label="Priorité" hint="La plus forte l’emporte. Tes règles : 25." value={rule.priority} min={-100} max={100} onChange={(priority) => set({ priority })} />
      <Divider />
      <ToggleRow label="Expression régulière" checked={rule.isRegex} onChange={(isRegex) => set({ isRegex })} />
      <ToggleRow label="Active" checked={rule.enabled} onChange={(enabled) => set({ enabled })} />
      {matches !== null && (
        <p className="t-small text-secondary">
          Correspond à <strong className="text-ink">{matches}</strong> opération{matches > 1 ? 's' : ''} déjà synchronisée{matches > 1 ? 's' : ''}.
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <Button className="flex-1" disabled={!!error} onClick={() => void save()}>
          Enregistrer
        </Button>
        {!isNew && (
          <Button variant="danger" icon="trash" onClick={() => void remove()}>
            Supprimer
          </Button>
        )}
      </div>
    </div>
  );
}

export default function RulesPage() {
  const rules = useRules();
  const categories = useCategories();
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [editing, setEditing] = useState<Rule | null>(null);
  const shown = useLatest(editing);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const filtered = useMemo(() => {
    const q = normalizeText(query);
    return rules
      .filter((r) => (!catFilter || r.categoryId === catFilter) && (!q || normalizeText(`${r.label} ${r.pattern}`).includes(q)))
      .sort((a, b) => (catMap.get(a.categoryId)?.order ?? 99) - (catMap.get(b.categoryId)?.order ?? 99) || b.priority - a.priority || a.label.localeCompare(b.label));
  }, [rules, query, catFilter, catMap]);

  return (
    <Screen
      stack
      title="Règles de classement"
      kicker={`${rules.length} règles · par ordre de priorité`}
      mood="settings"
      back="/reglages"
      footer={
        <Button size="lg" icon="add" className="w-full" onClick={() => setEditing(newRule({ categoryId: catFilter || CAT.autres, pattern: '', label: '' }))}>
          Nouvelle règle
        </Button>
      }
    >
      <Reveal index={0} className="space-y-2">
        <div className="relative">
          <Icon name="search" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="field-input pl-10" placeholder="Rechercher" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher une règle" />
        </div>
        <SelectField ariaLabel="Filtrer par catégorie" value={catFilter} onChange={setCatFilter} options={[{ value: '', label: 'Toutes les catégories' }, ...categories.map((c) => ({ value: c.id, label: `${c.emoji} ${c.name}` }))]} />
        <Button variant="ghost" size="sm" icon="sync" onClick={() => void reapplyRules().then((r) => toast({ message: `${r.changed} reclassée(s), ${r.unclassified} à classer. Corrections manuelles conservées.` }))}>
          Réappliquer à tout l’historique
        </Button>
      </Reveal>
      <Reveal index={1} className="mt-3">
        <Group>
          {filtered.map((r) => {
            const c = catMap.get(r.categoryId);
            return (
              <Tap key={r.id} onClick={() => setEditing(r)} scaleTo={0.985} className={`flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left ${r.enabled ? '' : 'opacity-50'}`}>
                <span aria-hidden className="text-[18px]">
                  {c?.emoji ?? '❔'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="t-body-strong block truncate">{r.label}</span>
                  <span className="t-caption block truncate font-mono text-muted">{r.pattern}</span>
                </span>
                <span className="flex max-w-[45%] shrink-0 flex-wrap justify-end gap-1">
                  {r.isRegex && <Badge>regex</Badge>}
                  {r.direction !== 'any' && <Badge>{r.direction === 'debit' ? 'débit' : 'crédit'}</Badge>}
                  {r.minAmount !== null && <Badge>≥ {formatCents(r.minAmount, { compact: true })}</Badge>}
                  {r.maxAmount !== null && <Badge>≤ {formatCents(r.maxAmount, { compact: true })}</Badge>}
                  {!r.enabled && <Badge tone="warning">inactive</Badge>}
                </span>
              </Tap>
            );
          })}
        </Group>
      </Reveal>
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={shown && !shown.pattern ? 'Nouvelle règle' : 'Modifier la règle'}>
        {shown && <RuleForm key={shown.id} initial={shown} categories={categories} onClose={() => setEditing(null)} />}
      </Sheet>
    </Screen>
  );
}
