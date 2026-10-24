import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  MAX_MINI_APPS,
  MINI_COLORS,
  MINI_TEMPLATES,
  addEntry,
  cleanValues,
  decodeSpec,
  deleteMiniApp,
  emptyMiniApp,
  encodeSpec,
  extractJson,
  formatMini,
  goalProgress,
  localToday,
  miniAppPrompt,
  parseSpec,
  removeEntry,
  setMiniReminder,
  statValue,
  EVERY_DAY,
  DECLARED_STATS,
  STATS,
  XP,
  type StatId,
  weeklySeries,
  type MiniApp,
  type MiniField,
  type MiniSpec,
  type MiniValue,
} from '../vendor/lumen';
import { ColumnChart } from '../ui/charts';
import { Icon, type IconName } from '../ui/icons';
import { Button, Card, Chip, EmptyState, Field, ProgressBar, Reveal, SectionTitle, SelectField, StatTile, TextField, Toggle, ToggleRow } from '../ui/index';
import { ensureSubscription } from '../push';
import { refreshReminders } from '../reminders';
import { NotFoundScreen, Screen } from '../ui/Screen';
import { saveMiniApp, useMiniApps } from '../ui/stats';
import { toast } from '../ui/toastStore';

/**
 * Mes apps (étape 10, premier palier) : des apps personnelles sans code. Une app est une description
 * (`mylife-app`) lue et vérifiée par le moteur de lumen ; ses saisies sont chiffrées dans le compte comme le reste.
 * Création : un modèle, ou une IA gratuite qui écrit la description (la demande est fournie), ou un lien reçu.
 */

const TYPE_LABEL: Record<MiniField['type'], string> = { number: 'nombre', duration: 'durée', rating: 'note sur 5', check: 'oui / non', choice: 'choix', text: 'texte' };

function AppBadge({ spec, size = 40 }: { spec: MiniSpec; size?: number }) {
  const [a, b] = MINI_COLORS[spec.color];
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[13px] text-white" style={{ width: size, height: size, background: `linear-gradient(150deg, ${a}, ${b})` }} aria-hidden>
      <Icon name={spec.icon as IconName} size={Math.round(size / 2)} />
    </span>
  );
}

function goalText(spec: MiniSpec): string | null {
  const g = spec.goal;
  if (!g) return null;
  const field = spec.fields.find((f) => f.id === g.field);
  const per = g.per === 'day' ? 'par jour' : 'par semaine';
  if (g.agg === 'sum') return `${formatMini(field, g.target)} ${per}`;
  return `${g.target} ${field ? `fois « ${field.label} »` : `saisie${g.target > 1 ? 's' : ''}`} ${per}`;
}

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

async function shareSpec(spec: MiniSpec): Promise<void> {
  const link = `${location.origin}/mes-apps/nouvelle#app=${encodeSpec(spec)}`;
  if (navigator.share) {
    try {
      return await navigator.share({ title: spec.name, text: `Mon app « ${spec.name} » sur MyLife (sans mes données)`, url: link });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    toast({ message: 'Lien copié : il contient l’app, pas tes saisies', tone: 'gold' });
  } catch {
    toast({ message: 'Copie impossible' });
  }
}

// ---------------------------------------------------------------- liste

export function MiniAppsPage() {
  const apps = useMiniApps();
  const today = localToday();
  return (
    <Screen stack title="Mes apps" kicker="Sans code, rien que pour toi" mood="today" back="/">
      <div className="flex flex-col gap-3">
        {apps.length === 0 ? (
          <Reveal index={0}>
            <EmptyState
              icon="apps"
              title="Crée tes propres apps"
              body="Lecture, sommeil, eau, une habitude, ta collection de vinyles : choisis un modèle, ou décris ce que tu veux à une IA gratuite. Pas une ligne de code."
              action={
                <Button icon="add" to="/mes-apps/nouvelle">
                  Créer une app
                </Button>
              }
            />
          </Reveal>
        ) : (
          <>
            {apps.map((app, i) => {
              const spec = app.spec!;
              const g = goalProgress(spec, app.entries, today);
              return (
                <Reveal key={app.id} index={i}>
                  <Card to={`/mes-apps/${app.id}`} label={`Ouvrir ${spec.name}`}>
                    <div className="flex items-center gap-3">
                      <AppBadge spec={spec} />
                      <span className="min-w-0 flex-1">
                        <span className="t-body-strong block truncate">{spec.name}</span>
                        <span className="t-small block truncate text-secondary">
                          {g ? `${g.done ? 'Objectif tenu' : `${formatMini(spec.fields.find((f) => f.id === spec.goal?.field), g.value, spec.goal?.agg === 'count' ? 'count' : undefined)} sur ${goalText(spec)}`}${g.streak > 1 ? ` · série de ${g.streak}` : ''}` : `${app.entries.length} saisie${app.entries.length > 1 ? 's' : ''}`}
                        </span>
                      </span>
                      <Icon name="chevron-forward" className="text-muted" />
                    </div>
                  </Card>
                </Reveal>
              );
            })}
            <Button className="mt-1" variant="secondary" icon="add" to="/mes-apps/nouvelle" disabled={apps.length >= MAX_MINI_APPS}>
              {apps.length >= MAX_MINI_APPS ? `${MAX_MINI_APPS} apps au plus` : 'Créer une app'}
            </Button>
          </>
        )}
        <p className="t-caption px-1 pt-1 text-center text-muted">Tes saisies sont chiffrées dans ton compte, comme le reste. Une app partagée ne contient jamais tes saisies.</p>
      </div>
    </Screen>
  );
}

// ---------------------------------------------------------------- création

function SpecPreview({ spec }: { spec: MiniSpec }) {
  const goal = goalText(spec);
  return (
    <Card level="raised">
      <div className="flex items-center gap-3">
        <AppBadge spec={spec} size={48} />
        <span className="min-w-0 flex-1">
          <span className="t-headline block">{spec.name}</span>
          {spec.description && <span className="t-small block text-secondary">{spec.description}</span>}
        </span>
      </div>
      <p className="t-label mt-4 text-muted">À chaque saisie</p>
      <ul className="t-body mt-1 flex flex-col gap-1">
        {spec.fields.map((f) => (
          <li key={f.id}>
            {f.label} <span className="t-small text-muted">({TYPE_LABEL[f.type]}{f.unit && f.type === 'number' ? `, ${f.unit}` : ''}{f.options ? ` : ${f.options.join(', ')}` : ''}{f.required ? ', obligatoire' : ''})</span>
          </li>
        ))}
      </ul>
      {goal && (
        <p className="t-small mt-3 text-secondary">
          <Icon name="flag" size={14} className="mr-1 inline text-gold" />
          Objectif : {goal}
        </p>
      )}
      <p className="t-small mt-1 text-secondary">Stats : {spec.stats.map((s) => s.label).join(' · ')}</p>
    </Card>
  );
}

export function MiniAppNewPage() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const shared = useMemo(() => (hash.startsWith('#app=') ? decodeSpec(hash.slice(5)) : null), [hash]);
  const [draft, setDraft] = useState<MiniSpec | null>(null);
  const [wish, setWish] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const spec = draft ?? shared?.spec ?? null;
  const live = useMiniApps().length;

  const create = () => {
    if (!spec) return;
    if (live >= MAX_MINI_APPS) return toast({ message: `${MAX_MINI_APPS} apps au plus : supprimes-en une d’abord.` });
    // Toujours un identifiant neuf : une saisie tardive d'une app supprimée ne doit pas rejoindre la nouvelle.
    const id = newId();
    saveMiniApp(emptyMiniApp(id, spec));
    toast({ message: `« ${spec.name} » est prête`, tone: 'gold' });
    navigate(`/mes-apps/${id}`, { replace: true });
  };

  const read = () => {
    try {
      const r = parseSpec(extractJson(answer));
      if (r.error) return setError(r.error);
      setError(null);
      setDraft(r.spec ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(miniAppPrompt(wish));
      toast({ message: 'Demande copiée : colle-la dans l’IA', tone: 'gold' });
    } catch {
      toast({ message: 'Copie impossible' });
    }
  };

  if (spec) {
    return (
      <Screen stack title={shared?.spec && !draft ? 'App reçue' : 'Ta nouvelle app'} kicker="Mes apps" mood="today" back="/mes-apps">
        <div className="flex flex-col gap-3">
          <SpecPreview spec={spec} />
          {shared?.spec && !draft && <p className="t-small px-1 text-secondary">Quelqu’un t’a partagé cette app : tu reçois sa forme, pas ses saisies. Les tiennes resteront à toi.</p>}
          <Button size="lg" icon="check" onClick={create}>
            Créer cette app
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(null);
              if (shared) navigate('/mes-apps/nouvelle', { replace: true });
            }}
          >
            Choisir autre chose
          </Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen stack title="Nouvelle app" kicker="Mes apps" mood="today" back="/mes-apps">
      <div className="flex flex-col gap-3">
        {shared?.error && <p className="t-small text-danger">{shared.error}</p>}
        <Reveal index={0}>
          <SectionTitle>Partir d’un modèle</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            {MINI_TEMPLATES.map((t) => (
              <Card key={t.name} onClick={() => setDraft(t)} label={`Modèle ${t.name}`}>
                <AppBadge spec={t} size={34} />
                <p className="t-body-strong mt-2">{t.name}</p>
                <p className="t-caption text-muted">{t.description}</p>
              </Card>
            ))}
          </div>
        </Reveal>
        <Reveal index={1}>
          <SectionTitle>La décrire à une IA</SectionTitle>
          <Card>
            <ol className="t-small flex list-decimal flex-col gap-1 pl-5 text-secondary">
              <li>Écris ce que tu veux suivre, puis copie la demande.</li>
              <li>Colle-la dans une IA gratuite (ChatGPT, Le Chat, Gemini, Claude…).</li>
              <li>Colle sa réponse ici : MyLife la vérifie avant de créer quoi que ce soit.</li>
            </ol>
            <div className="mt-3 flex flex-col gap-2">
              <TextField label="Ce que tu veux suivre" value={wish} onChange={setWish} placeholder="Mes séances de piano : durée, morceau, ressenti" />
              <Button variant="secondary" icon="copy" onClick={() => void copyPrompt()}>
                Copier la demande
              </Button>
              <Field label="Réponse de l’IA" error={error}>
                {(id) => <textarea id={id} className="field-input min-h-[120px] py-3 font-mono text-[13px]" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder='{ "format": "mylife-app", … }' spellCheck={false} />}
              </Field>
              <Button icon="sparkles" disabled={!answer.trim()} onClick={read}>
                Lire la réponse
              </Button>
            </div>
          </Card>
        </Reveal>
        <p className="t-caption px-1 text-center text-muted">Une app MyLife n’est qu’une description : rien ne s’exécute, rien ne part ailleurs.</p>
      </div>
    </Screen>
  );
}

// ---------------------------------------------------------------- une app

function FieldInput({ field, value, onChange }: { field: MiniField; value: MiniValue | undefined; onChange: (v: MiniValue | undefined) => void }) {
  const label = `${field.label}${field.required ? '' : ' (facultatif)'}`;
  if (field.type === 'check')
    return (
      <div className="flex min-h-[44px] items-center justify-between gap-3">
        <span className="t-body">{field.label}</span>
        <Toggle checked={value === true} onChange={(v) => onChange(v)} label={field.label} />
      </div>
    );
  if (field.type === 'rating' || field.type === 'choice') {
    const options = field.type === 'rating' ? ['1', '2', '3', '4', '5'] : field.options!;
    return (
      <div className="flex flex-col gap-1.5">
        <span className="t-label text-muted">{label}</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={field.label}>
          {options.map((o) => {
            const v: MiniValue = field.type === 'rating' ? Number(o) : o;
            return (
              <Chip key={o} selected={value === v} onClick={() => onChange(value === v ? undefined : v)} label={`${field.label} : ${o}`}>
                {field.type === 'rating' ? `${o}★` : o}
              </Chip>
            );
          })}
        </div>
      </div>
    );
  }
  const numeric = field.type === 'number' || field.type === 'duration';
  return (
    <TextField
      label={`${label}${field.type === 'duration' ? ' en minutes' : field.unit ? ` (${field.unit})` : ''}`}
      value={value === undefined ? '' : String(value)}
      onChange={(v) => onChange(v === '' ? undefined : v)}
      inputMode={numeric ? 'decimal' : undefined}
    />
  );
}

export function MiniAppPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const apps = useMiniApps();
  const app = apps.find((a) => a.id === id);
  const today = localToday();
  const [values, setValues] = useState<Record<string, MiniValue | undefined>>({});
  const [day, setDay] = useState(today);
  const [deleting, setDeleting] = useState(false);
  if (!app?.spec) return <NotFoundScreen title="App introuvable" body="Elle a peut-être été supprimée." back="/mes-apps" />;
  const spec = app.spec;
  const goal = goalProgress(spec, app.entries, today);
  const series = spec.chart ? weeklySeries(spec, app.entries, today) : null;
  const chartField = spec.fields.find((f) => f.id === spec.chart?.field);
  const goalField = spec.fields.find((f) => f.id === spec.goal?.field);
  const recent = [...app.entries].reverse().slice(0, 30);

  const save = () => {
    const r = cleanValues(spec, values);
    if (r.error) return toast({ message: r.error });
    saveMiniApp(addEntry(app, { id: newId(), day: day <= today ? day : today, values: r.values }));
    setValues({});
    toast({ message: 'Noté', tone: 'gold' });
  };

  return (
    <Screen stack title={spec.name} kicker="Mes apps" mood="today" back="/mes-apps">
      <div className="flex flex-col gap-3">
        {goal && (
          <Reveal index={0}>
            <Card level="raised">
              <p className="t-label text-muted">{spec.goal!.per === 'day' ? 'Objectif du jour' : 'Objectif de la semaine'}</p>
              <p className="mt-1">
                <span className="num t-title">{formatMini(goalField, goal.value, spec.goal!.agg === 'count' ? 'count' : undefined)}</span>{' '}
                <span className="t-small text-secondary">sur {goalText(spec)}</span>
              </p>
              <div className="mt-2">
                <ProgressBar value={goal.value} max={goal.target} tone={goal.done ? 'success' : 'accent'} label={`Objectif : ${goal.value} sur ${goal.target}`} />
              </div>
              {goal.streak > 0 && (
                <p className="t-small mt-2 text-gold">
                  <Icon name="flame" size={14} className="mr-1 inline" />
                  Série : {goal.streak} {spec.goal!.per === 'day' ? 'jour' : 'semaine'}
                  {goal.streak > 1 ? 's' : ''}
                </p>
              )}
            </Card>
          </Reveal>
        )}

        <Reveal index={1}>
          <SectionTitle>Nouvelle saisie</SectionTitle>
          <Card>
            <div className="flex flex-col gap-3">
              {spec.fields.map((f) => (
                <FieldInput key={f.id} field={f} value={values[f.id]} onChange={(v) => setValues((s) => ({ ...s, [f.id]: v }))} />
              ))}
              <TextField label="Jour" type="date" value={day} onChange={(v) => setDay(v || today)} />
              <Button icon="check" onClick={save}>
                Noter
              </Button>
            </div>
          </Card>
        </Reveal>

        <Reveal index={2}>
          <div className="grid grid-cols-2 gap-2">
            {spec.stats.map((s) => (
              <StatTile key={s.label} label={s.label} value={formatMini(spec.fields.find((f) => f.id === s.field), statValue(app.entries, s, today), s.agg)} />
            ))}
          </div>
        </Reveal>

        {series && app.entries.length > 0 && (
          <Reveal index={3}>
            <Card>
              <p className="t-label mb-3 text-muted">8 dernières semaines</p>
              <ColumnChart
                data={series.map((p, i) => ({ label: `${Number(p.week.slice(8, 10))}/${Number(p.week.slice(5, 7))}`, value: p.value, lit: i === series.length - 1 }))}
                format={(v) => (chartField?.type === 'duration' && spec.chart!.agg !== 'count' ? formatMini(chartField, v) : formatMini(undefined, v))}
                label={`${spec.name} : 8 dernières semaines`}
              />
            </Card>
          </Reveal>
        )}

        {recent.length > 0 && (
          <Reveal index={4}>
            <SectionTitle>Dernières saisies</SectionTitle>
            <Card className="divide-y divide-line">
              {recent.map((e) => (
                <div key={e.id} className="flex items-center gap-3 py-2.5">
                  <span className="num t-small w-12 shrink-0 text-muted">{`${Number(e.day.slice(8, 10))}/${Number(e.day.slice(5, 7))}`}</span>
                  <span className="t-body min-w-0 flex-1 truncate">
                    {spec.fields
                      .filter((f) => e.values[f.id] !== undefined)
                      .map((f) => (f.type === 'check' ? (e.values[f.id] ? f.label : `pas « ${f.label} »`) : formatMini(f, e.values[f.id]!)))
                      .join(' · ')}
                  </span>
                  <button type="button" className="flex h-9 w-9 items-center justify-center text-muted" aria-label={`Supprimer la saisie du ${e.day}`} onClick={() => saveMiniApp(removeEntry(app, e.id))}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}
            </Card>
          </Reveal>
        )}

        <Reveal index={5}>
          <ReminderCard app={app} />
        </Reveal>

        <Reveal index={5}>
          <StatChoice app={app} />
        </Reveal>

        <Reveal index={5}>
          <div className="flex flex-col gap-2 pt-2">
            <Button variant="secondary" icon="share" onClick={() => void shareSpec(spec)}>
              Partager l’app (sans mes saisies)
            </Button>
            <Button
              variant="ghost"
              icon="trash"
              onClick={() => {
                if (!deleting) return setDeleting(true);
                saveMiniApp(deleteMiniApp(app));
                toast({ message: `« ${spec.name} » supprimée` });
                navigate('/mes-apps', { replace: true });
              }}
            >
              {deleting ? `Confirmer : supprimer et effacer ${app.entries.length} saisie${app.entries.length > 1 ? 's' : ''}` : 'Supprimer l’app'}
            </Button>
          </div>
        </Reveal>
      </div>
    </Screen>
  );
}

const DAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/**
 * Rappel de l'app (V4, F2) : écrit par l'appareil à l'heure choisie, jamais le jour où une saisie existe déjà. Le serveur
 * ne reçoit qu'une heure de réveil, sans savoir de quoi il s'agit.
 */
function ReminderCard({ app }: { app: MiniApp }) {
  const reminder = app.reminder;
  const [busy, setBusy] = useState(false);
  const update = async (next: { minute: number; days: number } | null, subscribe: boolean) => {
    saveMiniApp(setMiniReminder(app, next));
    if (subscribe) {
      setBusy(true);
      try {
        await ensureSubscription(false);
      } catch (e) {
        toast({ message: `${(e as Error).message} Le rappel est gardé : il sonnera dès que les notifications marcheront.` });
      } finally {
        setBusy(false);
      }
    }
    await refreshReminders();
  };
  return (
    <Card>
      <ToggleRow
        label="Me le rappeler"
        hint={reminder ? `À ${hhmm(reminder.minute).replace(':', ' h ')}, sauf si c’est déjà noté. Écrit par ton appareil : le serveur ne sait pas de quoi.` : 'Une notification à l’heure choisie, les jours où tu n’as rien noté.'}
        checked={!!reminder}
        onChange={(on) => void update(on ? { minute: 21 * 60, days: EVERY_DAY } : null, on)}
      />
      {reminder && (
        <div className="mt-3 flex flex-col gap-3">
          <TextField label="Heure" type="time" value={hhmm(reminder.minute)} onChange={(v) => {
            const [h, m] = v.split(':').map(Number);
            if (Number.isInteger(h) && Number.isInteger(m)) void update({ minute: h! * 60 + m!, days: reminder.days }, false);
          }} />
          <div className="flex gap-1.5" role="group" aria-label="Jours du rappel">
            {DAY_LETTERS.map((letter, i) => {
              const on = (reminder.days & (1 << i)) !== 0;
              return (
                <Chip key={i} small selected={on} label={`${on ? 'Retirer' : 'Ajouter'} le ${DAY_NAMES[i]}`} onClick={() => {
                  const days = reminder.days ^ (1 << i);
                  if (days) void update({ minute: reminder.minute, days }, false);
                }}>
                  {letter}
                </Chip>
              );
            })}
          </div>
          {busy && <p className="t-caption text-muted">Activation des notifications…</p>}
        </div>
      )}
    </Card>
  );
}

const STAT_OPTIONS: { value: StatId | ''; label: string }[] = [
  { value: '', label: 'Aucune' },
  ...STATS.filter((s) => s.id !== 'constance').map((s) => ({ value: s.id, label: s.name })),
  ...DECLARED_STATS.map((s) => ({ value: s.id, label: s.name })),
];

/** La stat du Personnage que chaque saisie fait un peu monter (V4) : quelques points, jamais le poids d'une séance. */
function StatChoice({ app }: { app: MiniApp }) {
  const spec = app.spec!;
  return (
    <Card>
      <SelectField
        label="Fait monter ton Personnage"
        value={spec.stat ?? ''}
        onChange={(v) => {
          const { stat: _old, ...rest } = spec;
          void _old;
          saveMiniApp({ ...app, at: Date.now(), spec: v ? { ...rest, stat: v } : rest });
          toast({ message: v ? `Chaque saisie fait monter : ${STAT_OPTIONS.find((o) => o.value === v)?.label}` : 'Ne fait plus monter de stat' });
        }}
        options={STAT_OPTIONS}
        hint={`${XP.miniEntry} points par saisie, ${XP.miniEntryCap} saisies comptées par semaine au plus.`}
      />
    </Card>
  );
}

