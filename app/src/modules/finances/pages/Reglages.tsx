import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Badge, Button, Field, Glass, Icon, List, ListRow, Notice, Segmented, type IconName } from '@mylife/kit';
import { euros } from '../core/format';
import { useEngine } from '../data/engineStore';
import { checkIntegrity } from '../engine/integrity';
import type { Account, Envelope, Rule, Tag } from '../engine/schema';
import { addAccount, patchAccount, patchSettings, removeEnvelope, removeRule, removeTag, saveEnvelope, saveRule, saveTag } from '../engine/state';
import { downloadExport } from '../data/export';
import { ImportSheet } from './ImportData';
import { Select, Toggle } from './controls';
import { Screen, Sec, type Ready } from './common';
import { END, FLOW, ROLE } from './labels';
import { AccountSheet, EnvelopeSheet, RuleSheet, TagSheet } from './sheets';

/**
 * Les réglages de MyFinances : un sommaire en rubriques, et un écran court par rubrique (`/argent/reglages/<rubrique>`).
 * Tout ce qui structure le calcul s'y règle, et rien n'est figé : le cycle, les comptes et leurs rôles, les
 * enveloppes, les règles de tri, les tags. Les catégories et les banques ont leur propre écran. Chaque changement
 * est gardé sur l'appareil et recalcule tout aussitôt.
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
const longDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

function Entry({ to, onClick, icon, color, title, detail }: { to?: string; onClick?: () => void; icon: IconName; color: string; title: string; detail: string }) {
  const inside = (
    <>
      <span className="fin-ic" style={{ background: color }}><Icon name={icon} size={19} /></span>
      <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="t-strong">{title}</span>
        <span className="t-small muted">{detail}</span>
      </span>
      {to && <Icon name="chevron" size={16} />}
    </>
  );
  // L'ancienne app n'est pas une page de la coquille : un vrai lien, pas une navigation interne.
  if (to?.startsWith('/finances/')) return <a href={to} className="list-row">{inside}</a>;
  return to ? <Link to={to} className="list-row">{inside}</Link> : <button type="button" className="list-row" onClick={onClick}>{inside}</button>;
}

/** Le sommaire : l'essentiel en deux tuiles, puis les rubriques, chacune avec ce qu'elle contient aujourd'hui. */
function Hub({ db, e }: Ready) {
  const [importing, setImporting] = useState(false);
  const live = db.categories.filter((c) => !c.archivedAt && !c.mergedIntoId);
  const accounts = db.accounts.filter((a) => !a.archivedAt);
  const linked = accounts.filter((a) => a.source === 'bank').length;
  const integrity = checkIntegrity(db);
  return (
    <>
      {integrity.errors.length > 0 && <Notice tone="bad">Réglages incohérents : {integrity.errors.slice(0, 3).join(' ; ')}</Notice>}
      <Sec>L’essentiel</Sec>
      <div className="grid-2">
        <Link to="/argent/categories" className="glass fin-tile">
          <span className="fin-ic" style={{ background: '#ffd08a' }}><Icon name="modules" size={19} /></span>
          <span className="t-strong">Catégories</span>
          <span className="t-small muted">{plural(live.length, 'catégorie')}</span>
        </Link>
        <Link to="/argent/banques" className="glass fin-tile">
          <span className="fin-ic" style={{ background: '#9be9f8' }}><Icon name="transfer" size={19} /></span>
          <span className="t-strong">Banques</span>
          <span className="t-small muted">{linked ? plural(linked, 'compte relié', 'comptes reliés') : 'relier une banque'}</span>
        </Link>
      </div>

      <Sec>Ton budget</Sec>
      <List>
        <Entry to="/argent/reglages/cycle" icon="calendar" color="#cdbeff" title="Cycle et calcul" detail={`Paie le ${db.settings.payday} · mode ${db.settings.mode === 'PRUDENT' ? 'prudent' : 'trésorerie'}`} />
        <Entry to="/argent/reglages/comptes" icon="card" color="#9bf0b7" title="Comptes" detail={`${plural(accounts.length, 'compte')}, dont ${accounts.filter((a) => a.includeInDailyCash).length} du quotidien`} />
        <Entry to="/argent/reglages/enveloppes" icon="list" color="#f9a8d4" title="Enveloppes" detail={`${plural(db.envelopes.length, 'enveloppe')}, dont ${e.envelopes.filter((x) => x.budget !== null).length} plafonnée${e.envelopes.filter((x) => x.budget !== null).length > 1 ? 's' : ''}`} />
      </List>

      <Sec>Le classement</Sec>
      <List>
        <Entry to="/argent/reglages/regles" icon="search" color="#ffd08a" title="Règles de tri" detail={db.rules.length ? plural(db.rules.length, 'règle') : 'Aucune règle'} />
        <Entry to="/argent/reglages/tags" icon="flag" color="#9be9f8" title="Tags" detail={db.tags.length ? db.tags.slice(0, 3).map((t) => `#${t.name}`).join(', ') : 'Aucun tag'} />
      </List>

      <Sec>Tes données</Sec>
      <List>
        <Entry onClick={() => void downloadExport()} icon="shield" color="#cdbeff" title="Exporter mes données" detail="Un fichier, fabriqué sur ton appareil" />
        <Entry onClick={() => setImporting(true)} icon="plus" color="#9be9f8" title="Importer des données" detail="Un fichier exporté, ou une sauvegarde de l’ancienne MyFinances" />
        <Entry to="/argent/moteur" icon="eye" color="#9bf0b7" title="Pourquoi ce chiffre" detail="Le calcul, terme par terme" />
        <Entry to="/argent/patrimoine/import" icon="chart" color="#ffc29b" title="Importer un relevé Trade Republic" detail="Lignes et mouvements de tes placements, d’un coup" />
      </List>
      <ImportSheet open={importing} onClose={() => setImporting(false)} />
    </>
  );
}

function Cycle({ db, e, update }: Ready) {
  const settings = db.settings;
  const incomes = db.commitments.filter((c) => c.kind === 'INCOME' && !c.direct);
  return (
    <>
      <Sec>Ton cycle</Sec>
      <Glass className="pad stack">
        <span className="t-small muted">Cycle en cours : du {longDate(e.cycle.start)} au {longDate(e.cycle.end)}.</span>
        <div className="grid-2">
          <NumberField id="set-payday" label="Jour de paie" value={settings.payday} min={1} max={31} onChange={(payday) => update((s) => patchSettings(s, { payday }))} />
          <NumberField id="set-early" label="Paie en avance, jusqu’à" hint="jours avant" value={settings.earlyDays} min={0} max={15} onChange={(earlyDays) => update((s) => patchSettings(s, { earlyDays }))} />
        </div>
        <Select id="set-opening" label="Le revenu qui ouvre le cycle" value={settings.openingCommitmentId ?? ''} options={[['', 'Aucun : le jour de paie seul'], ...incomes.map((c) => [c.id, `${c.label} · ${euros(c.amount)}`] as const)]} onChange={(id) => update((s) => patchSettings(s, { openingCommitmentId: id || null }))} hint="S’il arrive en avance, le nouveau cycle démarre ce jour-là." />
      </Glass>

      <Sec>Le calcul du jour</Sec>
      <Glass className="pad stack">
        <Segmented label="Mode de calcul" value={settings.mode} options={MODES} onChange={(mode) => update((s) => patchSettings(s, { mode }))} />
        <span className="t-small muted">{settings.mode === 'PRUDENT' ? 'Prudent : le plus petit de ce que le budget autorise et de ce que la trésorerie permet. La marge de trésorerie est montrée à côté.' : 'Trésorerie : seul le cash libre compte, le budget théorique est ignoré.'}</span>
        <span className="t-label muted">Réservé dans la trésorerie avant l’échéance, par défaut</span>
        <Toggle label="Charges récurrentes" detail="Éteint : elles ne touchent la trésorerie qu’à leur débit réel." checked={settings.reserveDue.CHARGE} onChange={(v) => update((s) => patchSettings(s, { reserveDue: { ...settings.reserveDue, CHARGE: v } }))} />
        <Toggle label="Échéances de paiements fractionnés" checked={settings.reserveDue.INSTALLMENT} onChange={(v) => update((s) => patchSettings(s, { reserveDue: { ...settings.reserveDue, INSTALLMENT: v } }))} />
        <Toggle label="Mises de côté prévues" checked={settings.reserveDue.SAVING} onChange={(v) => update((s) => patchSettings(s, { reserveDue: { ...settings.reserveDue, SAVING: v } }))} />
        <span className="t-small muted">Chaque engagement peut s’en écarter, depuis sa fiche.</span>
      </Glass>

      <Sec>La fin du cycle</Sec>
      <Glass className="pad stack">
        <Segmented label="Excédent en fin de cycle" value={settings.endPolicy} options={END_OPTIONS} onChange={(endPolicy) => update((s) => patchSettings(s, { endPolicy }))} />
        <span className="t-small muted">{END.find(([id]) => id === settings.endPolicy)?.[1]}.</span>
        <Select id="set-over" label="Dépassement" value={settings.overspendPolicy} options={OVER} onChange={(overspendPolicy) => update((s) => patchSettings(s, { overspendPolicy }))} />
      </Glass>

      <Sec>Les virements internes</Sec>
      <Glass className="pad stack">
        <NumberField id="set-tolerance" label="Écart de dates toléré" hint="jours entre les deux opérations" value={settings.transferToleranceDays} min={0} max={10} onChange={(transferToleranceDays) => update((s) => patchSettings(s, { transferToleranceDays }))} />
      </Glass>
    </>
  );
}

function Accounts({ db, update, open, setOpen }: Ready & Opener) {
  const accounts = db.accounts.filter((a) => !a.archivedAt);
  const value: Account | 'new' | null = open === 'new' ? 'new' : (db.accounts.find((a) => a.id === open) ?? null);
  return (
    <>
      <List>
        {accounts.length === 0 && <ListRow title="Aucun compte" detail="Relie une banque, ou ajoute un compte tenu à la main" />}
        {accounts.map((a) => (
          <ListRow
            key={a.id}
            title={a.name}
            detail={[ROLE[a.role], a.includeInDailyCash ? 'cash quotidien' : null, a.includeInNetWorth ? null : 'hors patrimoine', a.ownershipRatio !== 1 ? `${Math.round(a.ownershipRatio * 100)} %` : null, a.deferredDebit ? `débit différé le ${a.deferredDebit.debitDay}` : null, a.source === 'manual' ? 'tenu à la main' : null].filter(Boolean).join(' · ')}
            value={a.balance === null ? '?' : euros(a.role === 'LIABILITY' ? -a.balance : a.balance, { round: true })}
            onClick={() => setOpen(a.id)}
          />
        ))}
      </List>
      <AccountSheet
        value={value}
        onClose={() => setOpen(null)}
        onPatch={(id, patch) => update((s) => patchAccount(s, id, patch))}
        onCreate={(a) => {
          update((s) => addAccount(s, a));
          setOpen(null);
        }}
      />
    </>
  );
}

function Envelopes({ db, e, update, open, setOpen }: Ready & Opener) {
  const categories = db.categories.filter((c) => !c.archivedAt && !c.mergedIntoId && c.scope === 'EXPENSE');
  const value: Envelope | 'new' | null = open === 'new' ? 'new' : (db.envelopes.find((x) => x.id === open) ?? null);
  return (
    <>
      <List>
        {e.envelopes.map((x) => (
          <ListRow
            key={x.envelope.id}
            title={x.envelope.name}
            detail={[x.envelope.inDailyBudget ? 'dans le quotidien' : 'hors quotidien', x.budget !== null ? `plafond ${euros(x.envelope.cap ?? 0)}` : 'sans plafond', x.envelope.isDefault ? 'reçoit tout le reste' : plural(x.envelope.categoryIds.length, 'catégorie')].join(' · ')}
            onClick={() => setOpen(x.envelope.id)}
          />
        ))}
      </List>
      <span className="t-small muted">Une enveloppe regroupe des catégories : dans le budget du jour ou à part, avec ou sans plafond.</span>
      <EnvelopeSheet
        value={value}
        categories={categories}
        envelopes={db.envelopes}
        onClose={() => setOpen(null)}
        onSave={(env) => {
          update((s) => saveEnvelope(s, env));
          setOpen(null);
        }}
        onRemove={(id) => {
          update((s) => removeEnvelope(s, id));
          setOpen(null);
        }}
      />
    </>
  );
}

function Rules({ db, update, open, setOpen }: Ready & Opener) {
  const categories = db.categories.filter((c) => !c.archivedAt && !c.mergedIntoId && c.scope === 'EXPENSE');
  const value: Rule | 'new' | null = open === 'new' ? 'new' : (db.rules.find((r) => r.id === open) ?? null);
  return (
    <>
      <List>
        {db.rules.length === 0 && <ListRow title="Aucune règle" detail="Par exemple : le libellé contient « boulangerie » → Courses" />}
        {db.rules.map((r) => (
          <ListRow key={r.id} title={r.name} detail={[FLOW[r.flow], db.categories.find((c) => c.id === r.categoryId)?.name, ...r.tagIds.map((id) => `#${db.tags.find((t) => t.id === id)?.name ?? '?'}`), r.enabled ? null : 'désactivée'].filter(Boolean).join(' · ')} onClick={() => setOpen(r.id)} />
        ))}
      </List>
      <span className="t-small muted">Une règle l’emporte sur le marchand. Ce que tu classes à la main l’emporte sur tout.</span>
      <RuleSheet
        value={value}
        categories={categories}
        tags={db.tags}
        count={db.rules.length}
        onClose={() => setOpen(null)}
        onSave={(r) => {
          update((s) => saveRule(s, r));
          setOpen(null);
        }}
        onRemove={(id) => {
          update((s) => removeRule(s, id));
          setOpen(null);
        }}
      />
    </>
  );
}

function Tags({ db, update, open, setOpen }: Ready & Opener) {
  const value: Tag | 'new' | null = open === 'new' ? 'new' : (db.tags.find((t) => t.id === open) ?? null);
  return (
    <>
      {db.tags.length === 0 ? (
        <span className="t-small muted">Aucun tag. Par exemple : imprévu, week-end, pro.</span>
      ) : (
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {db.tags.map((t) => (
            <button key={t.id} type="button" onClick={() => setOpen(t.id)} style={{ background: 'none', border: 0, padding: 0, minHeight: 44 }}>
              <Badge>#{t.name}</Badge>
            </button>
          ))}
        </div>
      )}
      <span className="t-small muted">Une étiquette libre, en plus de la catégorie. Elle n’entre dans aucun calcul.</span>
      <TagSheet
        value={value}
        onClose={() => setOpen(null)}
        onSave={(t) => {
          update((s) => saveTag(s, t));
          setOpen(null);
        }}
        onRemove={(id) => {
          update((s) => removeTag(s, id));
          setOpen(null);
        }}
      />
    </>
  );
}

interface Opener {
  open: string | null;
  setOpen: (id: string | null) => void;
}
const SECTIONS = {
  cycle: { title: 'Cycle et calcul', add: false, View: Cycle },
  comptes: { title: 'Comptes', add: true, View: Accounts },
  enveloppes: { title: 'Enveloppes', add: true, View: Envelopes },
  regles: { title: 'Règles de tri', add: true, View: Rules },
  tags: { title: 'Tags', add: true, View: Tags },
} as const;

export function ReglagesPage() {
  const engine = useEngine();
  const { section } = useParams();
  const [open, setOpen] = useState<string | null>(null);
  if (!section)
    return (
      <Screen engine={engine} tone="jour" kicker="MyFinances" title="Réglages" back="/argent">
        {(ready) => <Hub {...ready} />}
      </Screen>
    );
  const found = section in SECTIONS ? SECTIONS[section as keyof typeof SECTIONS] : null;
  if (!found) return <Navigate to="/argent/reglages" replace />;
  const { View } = found;
  return (
    <Screen engine={engine} tone="jour" kicker="Réglages" title={found.title} back="/argent/reglages" right={found.add ? <Button onClick={() => setOpen('new')}>Ajouter</Button> : undefined}>
      {(ready) => <View {...ready} open={open} setOpen={setOpen} />}
    </Screen>
  );
}
