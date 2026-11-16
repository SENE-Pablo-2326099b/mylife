import { useState, type ReactNode } from 'react';
import { Badge, Button, Field, Glass, List, ListRow, Notice, ScreenHeader, SectionTitle, Segmented } from '@mylife/kit';
import { euros } from '../core/format';
import { useEngine } from '../data/engineStore';
import { checkIntegrity } from '../engine/integrity';
import type { Account, Category, Envelope, Rule, Tag } from '../engine/schema';
import { addAccount, archiveCategory, mergeCategories, patchAccount, patchSettings, removeEnvelope, removeRule, removeTag, saveCategory, saveEnvelope, saveRule, saveTag } from '../engine/state';
import { downloadExport } from '../data/export';
import { Select, Toggle } from './controls';
import { Welcome } from './Welcome';
import { END, FLOW, ROLE, SCOPES } from './labels';
import { AccountSheet, CategorySheet, EnvelopeSheet, RuleSheet, TagSheet } from './sheets';

/**
 * Étape M4 : les réglages de MyFinances. Tout ce qui structure le calcul est ici, et rien n'est figé : le cycle, les
 * comptes et leurs rôles, les catégories sur deux niveaux, les tags, les enveloppes, les règles de tri. Chaque
 * changement est gardé sur l'appareil et recalcule tout aussitôt.
 */
const MODES = [
  { id: 'PRUDENT', label: 'Prudent' },
  { id: 'CASH', label: 'Trésorerie' },
] as const;
const END_OPTIONS = [
  { id: 'RESET', label: 'Remis à zéro' },
  { id: 'ROLLOVER', label: 'Reporté' },
  { id: 'AUTO_SAVE', label: 'Épargné' },
] as const;
const OVER = [['DEDUCT_NEXT', 'Déduit du cycle suivant'], ['FORGIVE', 'Oublié']] as const;
const SCOPE_NAME = Object.fromEntries(SCOPES) as Record<Category['scope'], string>;

function Head({ children, action, onAction }: { children: ReactNode; action?: string; onAction?: () => void }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 }}>
      <SectionTitle>{children}</SectionTitle>
      {action && (
        <button type="button" className="link t-small" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

/** Un nombre entier borné, saisi au clavier : enregistré dès qu'il est valide. */
function NumberField({ id, label, hint, value, min, max, onChange }: { id: string; label: string; hint?: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  return (
    <Field id={id} label={label} hint={hint}>
      <input
        id={id}
        inputMode="numeric"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Math.trunc(Number(e.target.value));
          if (e.target.value.trim() && Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
      />
    </Field>
  );
}

export function ReglagesPage() {
  const engine = useEngine();
  const [account, setAccount] = useState<string | 'new' | null>(null);
  const [category, setCategory] = useState<Category | 'new' | null>(null);
  const [tag, setTag] = useState<Tag | 'new' | null>(null);
  const [envelope, setEnvelope] = useState<Envelope | 'new' | null>(null);
  const [rule, setRule] = useState<Rule | 'new' | null>(null);

  const header = <ScreenHeader kicker="MyFinances" title="Réglages" right={<Button href="/argent">Retour</Button>} />;
  if (engine.status === 'error') return <>{header}<Notice tone="bad">La lecture de tes données a échoué : {engine.error}</Notice></>;
  if (engine.status === 'empty') return <>{header}<Welcome engine={engine} /></>;
  const { db, state, explanation: e, update } = engine;
  if (!db || !state || !e) return <>{header}<span className="t-small muted">Lecture de tes données…</span></>;

  const settings = db.settings;
  const incomes = db.commitments.filter((c) => c.kind === 'INCOME' && !c.direct);
  const accounts = db.accounts.filter((a) => !a.archivedAt);
  const live = db.categories.filter((c) => !c.archivedAt && !c.mergedIntoId);
  const top = live.filter((c) => !c.parentId || !live.some((p) => p.id === c.parentId));
  const archived = db.categories.filter((c) => c.archivedAt && !c.mergedIntoId);
  const merged = db.categories.filter((c) => c.mergedIntoId);
  const envelopeName = (categoryId: string) => db.envelopes.find((x) => x.categoryIds.includes(categoryId))?.name;
  const expenseCategories = live.filter((c) => c.scope === 'EXPENSE');
  const integrity = checkIntegrity(db);
  const accountValue: Account | 'new' | null = account === 'new' ? 'new' : (db.accounts.find((a) => a.id === account) ?? null);

  return (
    <>
      {header}
      {integrity.errors.length > 0 && <Notice tone="bad">Réglages incohérents : {integrity.errors.slice(0, 3).join(' ; ')}</Notice>}

      <SectionTitle>Banques et données</SectionTitle>
      <List>
        <ListRow href="/argent/banques" title="Banques" detail="Comptes reliés, synchro, relier une banque" />
        <ListRow title="Exporter mes données" detail="Un fichier avec tes opérations, tes comptes et tes réglages" onClick={() => void downloadExport()} />
        <ListRow href="/finances/patrimoine" title="Gérer mes placements" detail="Dans l’ancienne app, le temps de la bascule : lignes, achats, biens, objectifs" />
      </List>

      <SectionTitle>Cycle</SectionTitle>
      <Glass className="pad stack">
        <span className="t-small muted">
          Cycle en cours : du {new Date(`${e.cycle.start}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} au {new Date(`${e.cycle.end}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}.
        </span>
        <div className="grid-2">
          <NumberField id="set-payday" label="Jour de paie" value={settings.payday} min={1} max={31} onChange={(payday) => update((s) => patchSettings(s, { payday }))} />
          <NumberField id="set-early" label="Paie en avance, jusqu’à" hint="jours avant" value={settings.earlyDays} min={0} max={15} onChange={(earlyDays) => update((s) => patchSettings(s, { earlyDays }))} />
        </div>
        <Select id="set-opening" label="Le revenu qui ouvre le cycle" value={settings.openingCommitmentId ?? ''} options={[['', 'Aucun : le jour de paie seul'], ...incomes.map((c) => [c.id, `${c.label} · ${euros(c.amount)}`] as const)]} onChange={(id) => update((s) => patchSettings(s, { openingCommitmentId: id || null }))} hint="S’il arrive en avance, le nouveau cycle démarre ce jour-là." />
        <span className="t-label muted">Budget du jour</span>
        <Segmented label="Mode de calcul" value={settings.mode} options={MODES} onChange={(mode) => update((s) => patchSettings(s, { mode }))} />
        <span className="t-small muted">{settings.mode === 'PRUDENT' ? 'Prudent : le plus petit de ce que le budget autorise et de ce que la trésorerie permet. La marge de trésorerie est montrée à côté.' : 'Trésorerie : seul le cash libre compte, le budget théorique est ignoré.'}</span>
        <span className="t-label muted">Réservé dans la trésorerie avant l’échéance, par défaut</span>
        <Toggle label="Charges récurrentes" detail="Éteint : elles ne touchent la trésorerie qu’à leur débit réel." checked={settings.reserveDue.CHARGE} onChange={(v) => update((s) => patchSettings(s, { reserveDue: { ...settings.reserveDue, CHARGE: v } }))} />
        <Toggle label="Échéances de paiements fractionnés" checked={settings.reserveDue.INSTALLMENT} onChange={(v) => update((s) => patchSettings(s, { reserveDue: { ...settings.reserveDue, INSTALLMENT: v } }))} />
        <Toggle label="Mises de côté prévues" checked={settings.reserveDue.SAVING} onChange={(v) => update((s) => patchSettings(s, { reserveDue: { ...settings.reserveDue, SAVING: v } }))} />
        <span className="t-small muted">Chaque engagement peut s’en écarter, depuis sa fiche.</span>
        <span className="t-label muted">Fin de cycle, pour le budget du quotidien</span>
        <Segmented label="Excédent en fin de cycle" value={settings.endPolicy} options={END_OPTIONS} onChange={(endPolicy) => update((s) => patchSettings(s, { endPolicy }))} />
        <span className="t-small muted">{END.find(([id]) => id === settings.endPolicy)?.[1]}.</span>
        <Select id="set-over" label="Dépassement" value={settings.overspendPolicy} options={OVER} onChange={(overspendPolicy) => update((s) => patchSettings(s, { overspendPolicy }))} />
        <NumberField id="set-tolerance" label="Virements internes : écart de dates toléré" hint="jours entre les deux opérations" value={settings.transferToleranceDays} min={0} max={10} onChange={(transferToleranceDays) => update((s) => patchSettings(s, { transferToleranceDays }))} />
      </Glass>

      <Head action="Ajouter" onAction={() => setAccount('new')}>Comptes : {accounts.length}</Head>
      <List>
        {accounts.map((a) => (
          <ListRow
            key={a.id}
            title={a.name}
            detail={[ROLE[a.role], a.includeInDailyCash ? 'cash quotidien' : null, a.includeInNetWorth ? null : 'hors patrimoine', a.ownershipRatio !== 1 ? `${Math.round(a.ownershipRatio * 100)} %` : null, a.deferredDebit ? `débit différé le ${a.deferredDebit.debitDay}` : null, a.source === 'manual' ? 'tenu à la main' : null].filter(Boolean).join(' · ')}
            value={a.balance === null ? '?' : euros(a.role === 'LIABILITY' ? -a.balance : a.balance, { round: true })}
            onClick={() => setAccount(a.id)}
          />
        ))}
      </List>

      <Head action="Ajouter" onAction={() => setCategory('new')}>Catégories : {live.length}</Head>
      <List>
        {top.length === 0 && <ListRow title="Aucune catégorie" />}
        {top.flatMap((p) => [p, ...live.filter((c) => c.parentId === p.id)]).map((c) => (
          <ListRow
            key={c.id}
            lead={<span style={{ width: 12, height: 12, borderRadius: 4, background: c.color, flex: 'none', marginLeft: c.parentId && live.some((p) => p.id === c.parentId) ? 18 : 0 }} />}
            title={c.name}
            detail={[c.scope === 'EXPENSE' ? null : SCOPE_NAME[c.scope], envelopeName(c.id) ? `enveloppe « ${envelopeName(c.id)} »` : null].filter(Boolean).join(' · ') || undefined}
            onClick={() => setCategory(c)}
          />
        ))}
      </List>
      {(archived.length > 0 || merged.length > 0) && (
        <List>
          {archived.map((c) => (
            <ListRow key={c.id} title={c.name} detail="archivée : touche pour la restaurer" onClick={() => setCategory(c)} />
          ))}
          {merged.map((c) => (
            <ListRow key={c.id} title={c.name} detail={`fusionnée dans « ${db.categories.find((x) => x.id === c.mergedIntoId)?.name ?? '?'} »`} />
          ))}
        </List>
      )}

      <Head action="Ajouter" onAction={() => setTag('new')}>Tags : {db.tags.length}</Head>
      {db.tags.length === 0 ? (
        <span className="t-small muted">Aucun tag. Par exemple : imprévu, week-end, pro.</span>
      ) : (
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {db.tags.map((t) => (
            <button key={t.id} type="button" onClick={() => setTag(t)} style={{ background: 'none', border: 0, padding: 0 }}>
              <Badge>#{t.name}</Badge>
            </button>
          ))}
        </div>
      )}

      <Head action="Ajouter" onAction={() => setEnvelope('new')}>Enveloppes : {db.envelopes.length}</Head>
      <List>
        {e.envelopes.map((x) => (
          <ListRow
            key={x.envelope.id}
            title={x.envelope.name}
            detail={[x.envelope.inDailyBudget ? 'dans le quotidien' : 'hors quotidien', x.budget !== null ? `plafond ${euros(x.envelope.cap ?? 0)}` : 'sans plafond', x.envelope.isDefault ? 'reçoit tout le reste' : `${x.envelope.categoryIds.length} catégorie${x.envelope.categoryIds.length > 1 ? 's' : ''}`].join(' · ')}
            onClick={() => setEnvelope(x.envelope)}
          />
        ))}
      </List>

      <Head action="Ajouter" onAction={() => setRule('new')}>Règles de tri : {db.rules.length}</Head>
      <List>
        {db.rules.length === 0 && <ListRow title="Aucune règle" detail="Par exemple : le libellé contient « boulangerie » → Courses" />}
        {db.rules.map((r) => (
          <ListRow key={r.id} title={r.name} detail={[FLOW[r.flow], db.categories.find((c) => c.id === r.categoryId)?.name, ...r.tagIds.map((id) => `#${db.tags.find((t) => t.id === id)?.name ?? '?'}`), r.enabled ? null : 'désactivée'].filter(Boolean).join(' · ')} onClick={() => setRule(r)} />
        ))}
      </List>
      <span className="t-small muted">Une règle l’emporte sur le marchand. Ce que tu classes à la main l’emporte sur tout.</span>

      <AccountSheet
        value={accountValue}
        onClose={() => setAccount(null)}
        onPatch={(id, patch) => update((s) => patchAccount(s, id, patch))}
        onCreate={(a) => {
          update((s) => addAccount(s, a));
          setAccount(null);
        }}
      />
      <CategorySheet
        value={category}
        all={db.categories}
        onClose={() => setCategory(null)}
        onSave={(c) => {
          update((s) => saveCategory(s, c, db.categories));
          setCategory(null);
        }}
        onArchive={(id, at) => {
          update((s) => archiveCategory(s, id, db.categories, at));
          setCategory(null);
        }}
        onMerge={(from, into) => {
          update((s) => mergeCategories(s, from, into, db.categories, Date.now()));
          setCategory(null);
        }}
      />
      <TagSheet
        value={tag}
        onClose={() => setTag(null)}
        onSave={(t) => {
          update((s) => saveTag(s, t));
          setTag(null);
        }}
        onRemove={(id) => {
          update((s) => removeTag(s, id));
          setTag(null);
        }}
      />
      <EnvelopeSheet
        value={envelope}
        categories={expenseCategories}
        envelopes={db.envelopes}
        onClose={() => setEnvelope(null)}
        onSave={(env) => {
          update((s) => saveEnvelope(s, env));
          setEnvelope(null);
        }}
        onRemove={(id) => {
          update((s) => removeEnvelope(s, id));
          setEnvelope(null);
        }}
      />
      <RuleSheet
        value={rule}
        categories={expenseCategories}
        tags={db.tags}
        count={db.rules.length}
        onClose={() => setRule(null)}
        onSave={(r) => {
          update((s) => saveRule(s, r));
          setRule(null);
        }}
        onRemove={(id) => {
          update((s) => removeRule(s, id));
          setRule(null);
        }}
      />
    </>
  );
}
