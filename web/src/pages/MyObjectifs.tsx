import { useEffect, useMemo, useState } from 'react';
import { COUNTER_SOURCES, localToday, markDone, objectiveLine, objectiveProgress, type MiniApp, type Objective, type ObjectiveProgress, type ObjectiveSource, type ObjectiveStatus } from '../vendor/lumen';
import { objectives } from '../myObjectifsData';
import { Icon } from '../ui/icons';
import { Badge, Button, Card, EmptyState, ProgressBar, Reveal, SelectField, Sheet, TextField, toast } from '../ui/index';
import { Screen } from '../ui/Screen';
import { useMiniApps, useStatsInput } from '../ui/stats';

/**
 * MyObjectifs (V4, 3.1) : tes objectifs, mesurés tout seuls par tes apps (séances, jours sous le budget, épargne tenue,
 * sorties, musique, « Mes apps », niveau du Personnage). Moteur : packages/lumen/src/objectifs.ts.
 */
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
const TONE: Record<ObjectiveStatus, 'gold' | 'success' | 'warning' | 'accent' | 'info'> = { done: 'gold', ahead: 'success', onTrack: 'success', behind: 'warning', missed: 'info', unavailable: 'info' };
const fmtDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const plus = (iso: string, months: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};
const n = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');

/** Ce qu'on peut mesurer : compteurs des apps, niveau, et chaque app de « Mes apps » (saisies, ou total d'un champ). */
function sourceOptions(apps: readonly MiniApp[]): { value: string; label: string; source: ObjectiveSource; unit: string; perMonth: number }[] {
  return [
    ...COUNTER_SOURCES.map((c) => ({ value: `c:${c.app}:${c.key}`, label: c.label, source: { type: 'counter' as const, app: c.app, key: c.key }, unit: c.unit[0], perMonth: c.perMonth })),
    { value: 'level', label: 'Niveau de ton Personnage', source: { type: 'level' as const }, unit: 'niveau', perMonth: 2 },
    ...apps.flatMap((a) => [
      { value: `m:${a.id}`, label: `${a.spec!.name} : nombre de saisies`, source: { type: 'miniapp' as const, appId: a.id, agg: 'count' as const }, unit: 'saisies', perMonth: 12 },
      ...a.spec!.fields
        .filter((f) => f.type === 'number' || f.type === 'duration')
        .map((f) => ({ value: `m:${a.id}:${f.id}`, label: `${a.spec!.name} : total de « ${f.label} »`, source: { type: 'miniapp' as const, appId: a.id, agg: 'sum' as const, field: f.id }, unit: f.unit ?? (f.type === 'duration' ? 'min' : ''), perMonth: 100 })),
    ]),
  ];
}

function NewObjective({ open, onClose, apps }: { open: boolean; onClose: () => void; apps: readonly MiniApp[] }) {
  const today = localToday();
  const options = useMemo(() => sourceOptions(apps), [apps]);
  const [choice, setChoice] = useState(options[0]!.value);
  const [months, setMonths] = useState('3');
  const opt = options.find((o) => o.value === choice) ?? options[0]!;
  const [target, setTarget] = useState(String(opt.perMonth * 3));
  const [title, setTitle] = useState('');
  const deadline = plus(today, Math.max(1, Math.min(36, Number(months) || 3)));
  const value = Number(target.replace(',', '.'));
  const valid = Number.isFinite(value) && value > 0;
  const auto = opt.source.type === 'level' ? `Niveau ${n(value || 0)} du Personnage` : `${n(value || 0)} ${opt.unit} d’ici le ${fmtDate(deadline)}`.trim();
  const save = () => {
    if (!valid) return;
    objectives.put(newId(), { v: 1, title: (title.trim() || auto).slice(0, 80), source: opt.source, target: value, start: today, deadline });
    toast({ message: 'Objectif créé : il se mesure tout seul', tone: 'gold' });
    setTitle('');
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Nouvel objectif"
      footer={
        <Button size="lg" className="w-full" disabled={!valid} onClick={save}>
          Créer l’objectif
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <SelectField
          label="Ce qui compte"
          value={choice}
          onChange={(v) => {
            setChoice(v);
            const o = options.find((x) => x.value === v);
            if (o) setTarget(String(o.source.type === 'level' ? 10 : o.perMonth * (Number(months) || 3)));
          }}
          options={options.map((o) => ({ value: o.value, label: o.label }))}
          hint="Mesuré par tes apps, sans rien saisir. L’argent se compte en jours et en cycles, jamais en montants."
        />
        <TextField label={opt.source.type === 'level' ? 'Niveau visé' : `Cible (${opt.unit})`} inputMode="decimal" value={target} onChange={setTarget} />
        <SelectField
          label="D’ici"
          value={months}
          onChange={setMonths}
          options={[
            { value: '1', label: '1 mois' },
            { value: '3', label: '3 mois' },
            { value: '6', label: '6 mois' },
            { value: '12', label: '1 an' },
          ]}
          hint={`Jusqu’au ${fmtDate(deadline)}.`}
        />
        <TextField label="Nom (facultatif)" value={title} onChange={setTitle} placeholder={auto} />
      </div>
    </Sheet>
  );
}

function ObjectiveCard({ id, o, p, onOpen }: { id: string; o: Objective; p: ObjectiveProgress; onOpen: (id: string) => void }) {
  return (
    <Card onClick={() => onOpen(id)} label={`${o.title} : ${objectiveLine(p)}`}>
      <div className="flex items-center gap-2">
        <span className="t-body-strong min-w-0 flex-1 truncate">{o.title}</span>
        {p.status === 'done' ? (
          <Badge tone="gold" icon="trophy">
            Atteint
          </Badge>
        ) : (
          <span className="num t-small text-secondary">{Math.round(p.ratio * 100)} %</span>
        )}
      </div>
      <div className="mt-2">
        <ProgressBar value={p.value} max={p.target} tone={TONE[p.status]} marker={p.status === 'done' || o.source.type === 'level' ? null : p.expected} label={`${n(p.value)} sur ${n(p.target)}`} />
      </div>
      <p className="t-small mt-2 text-secondary">{objectiveLine(p)}</p>
      <p className="t-caption mt-1 text-muted">
        {n(p.value)} / {n(p.target)} {p.unit[0]} · jusqu’au {fmtDate(o.deadline)}
      </p>
    </Card>
  );
}

export function MyObjectifsPage() {
  const list = objectives.useList();
  const apps = useMiniApps();
  const { stats, rest, today } = useStatsInput();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const rows = useMemo(
    () => list.map((i) => ({ id: i.id, o: i.value, p: objectiveProgress(i.value, { stats, miniApps: apps, today, rest }) })).sort((a, b) => Number(a.p.status === 'done') - Number(b.p.status === 'done') || a.o.deadline.localeCompare(b.o.deadline)),
    [list, apps, stats, today, rest],
  );
  // Un objectif atteint garde sa date, même si la source baisse ensuite (succès gagné).
  useEffect(() => {
    for (const r of rows) {
      const done = markDone(r.o, r.p);
      if (done) {
        objectives.put(r.id, done);
        toast({ message: `Objectif atteint : ${r.o.title}`, tone: 'gold' });
      }
    }
  }, [rows]);
  const current = rows.find((r) => r.id === open) ?? null;
  const done = rows.filter((r) => r.p.status === 'done').length;

  return (
    <Screen stack title="MyObjectifs" kicker="Mesurés par tes apps" mood="today" back="/">
      <div className="flex flex-col gap-3">
        <Reveal index={0}>
          <Card level="raised" glow>
            {rows.length ? (
              <p className="t-body">
                <strong className="text-ink">{rows.length - done}</strong> en cours{done > 0 && <>, <strong className="text-gold">{done}</strong> atteint{done > 1 ? 's' : ''}</>}. Rien à saisir : tes apps les font avancer.
              </p>
            ) : (
              <EmptyState icon="flag" title="Fixe-toi un cap" body="« 40 séances d’ici Noël », « tenir mon épargne 6 cycles », « 20 livres cette année » : tes apps mesurent, tu vois si tu es dans le rythme." />
            )}
            <Button className="mt-3 w-full" icon="add" onClick={() => setCreating(true)}>
              Nouvel objectif
            </Button>
          </Card>
        </Reveal>
        {rows.map((r, i) => (
          <Reveal key={r.id} index={Math.min(i + 1, 6)}>
            <ObjectiveCard id={r.id} o={r.o} p={r.p} onOpen={(id) => (setDeleting(false), setOpen(id))} />
          </Reveal>
        ))}
      </div>
      <NewObjective open={creating} onClose={() => setCreating(false)} apps={apps} />
      <Sheet open={current !== null} onClose={() => setOpen(null)} title={current?.o.title}>
        {current && (
          <div className="flex flex-col gap-3">
            <p className="t-body">{objectiveLine(current.p)}</p>
            <p className="t-small text-secondary">
              Du {fmtDate(current.o.start)} au {fmtDate(current.o.deadline)} · {n(current.p.value)} sur {n(current.p.target)} {current.p.unit[0]}
              {current.o.source.type !== 'level' && current.p.status !== 'done' && <> · le rythme régulier en attendait {n(current.p.expected)} aujourd’hui</>}.
            </p>
            {current.o.doneAt && (
              <p className="t-small flex items-center gap-1.5 text-gold">
                <Icon name="trophy" size={16} /> Atteint le {new Date(current.o.doneAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}.
              </p>
            )}
            <Button
              variant="ghost"
              icon="trash"
              onClick={() => {
                if (!deleting) return setDeleting(true);
                objectives.remove(current.id);
                setOpen(null);
                toast({ message: 'Objectif supprimé' });
              }}
            >
              {deleting ? 'Confirmer la suppression' : 'Supprimer l’objectif'}
            </Button>
          </div>
        )}
      </Sheet>
    </Screen>
  );
}
