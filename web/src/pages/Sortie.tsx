import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  addWeeks,
  balances,
  decide,
  localToday,
  memoryOf,
  parseAnswer,
  parseExpense,
  parseGoing,
  parseIdNote,
  parseInfo,
  parseItem,
  parseSet,
  phaseOf,
  setAt,
  settle,
  sortSets,
  weekStart,
  type Answer,
  type Expense,
  type IdNote,
  type Item,
  type SortieInfo,
  type SortieSet,
} from '../vendor/lumen';
import type { Space } from '../vendor/mylife-sync';
import { CREW_URL, client, loadCrews, useCrews } from '../crew';
import { forgetSpace, newRid, useSpaceData, writeSpace, type CachedRecord } from '../spaceSync';
import { Icon } from '../ui/icons';
import { formatCents, tryDecimalToCents } from '../ui/money';
import { Badge, Button, Card, Disclosure, EmptyState, Reveal, Segmented, SectionTitle, SelectField, TextField, ToggleRow } from '../ui/index';
import { Screen } from '../ui/Screen';
import { useSession } from '../ui/session';
import { publishStats } from '../ui/stats';
import { toast } from '../ui/toastStore';

/**
 * Sortie : un festival, un week-end, une soirée, organisé à plusieurs dans un espace chiffré. « Chaud ? »,
 * planning set par set, budget partagé, liste à emporter, carnet d'ID, souvenir. Fonctionne hors ligne
 * (spaceSync). Logique : packages/lumen/src/sortie.ts.
 */

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const euros = (c: number) => formatCents(c);
const dayLabel = (iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat('fr-FR', opts).format(new Date(`${iso}T12:00:00`));
const ANSWERS: { value: Answer; label: string }[] = [
  { value: 'chaud', label: 'Chaud' },
  { value: 'peutetre', label: 'Peut-être' },
  { value: 'non', label: 'Non' },
];

function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 31; ) {
    out.push(d);
    d = new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }
  return out;
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function shareLink(link: string, name: string): Promise<void> {
  if (navigator.share) {
    try {
      return await navigator.share({ title: name, text: `On fait « ${name} » ? Réponds ici`, url: link });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    toast({ message: 'Lien copié : envoie-le à ta bande', tone: 'gold' });
  } catch {
    toast({ message: 'Copie impossible : sélectionne le lien affiché' });
  }
}

// ---------------------------------------------------------------- liste et création

export function SortiesPage() {
  const session = useSession();
  const spaces = useCrews();
  const navigate = useNavigate();
  const today = localToday();
  const [form, setForm] = useState({ name: '', place: '', start: today, end: today });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void loadCrews();
  }, []);

  const create = async () => {
    const c = client();
    if (!c || !spaces.uid || !session) return;
    setBusy(true);
    try {
      const pseudo = session.login.charAt(0).toUpperCase() + session.login.slice(1);
      const space = await c.create('sortie', form.name.trim(), pseudo, spaces.uid);
      const info: SortieInfo = { name: form.name.trim(), place: form.place.trim(), start: form.start, end: form.end >= form.start ? form.end : form.start, notes: '', threshold: 3 };
      await c.sync(space, Number.MAX_SAFE_INTEGER, [
        { tbl: 'info', rid: 'main', row: info },
        { tbl: 'rsvp', rid: spaces.uid, row: { answer: 'chaud' } },
      ]);
      await loadCrews();
      navigate(`/sorties/${space.id}?inviter=1`);
    } catch (e) {
      toast({ message: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen stack title="Sorties" kicker="Festivals, week-ends, soirées" mood="today" back="/">
      <div className="flex flex-col gap-3">
        {spaces.sorties.length > 0 && (
          <Reveal index={0}>
            <div className="flex flex-col gap-2">
              {spaces.sorties.map((s) => (
                <Card key={s.id} to={`/sorties/${s.id}`} label={`Sortie ${s.name}`}>
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] text-white" style={{ background: 'linear-gradient(150deg, var(--accent-g0), var(--gold))' }} aria-hidden>
                      <Icon name="flag-fill" size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="t-body-strong block truncate">{s.name}</span>
                      <span className="t-small block text-secondary">
                        {s.members} membre{s.members > 1 ? 's' : ''}
                      </span>
                    </span>
                    <Icon name="chevron-forward" className="text-muted" />
                  </div>
                </Card>
              ))}
            </div>
          </Reveal>
        )}
        {spaces.status === 'ready' && spaces.sorties.length === 0 && <EmptyState icon="flag" title="Aucune sortie" body="Propose la prochaine : ta bande répond « chaud », et tout s’organise au même endroit." />}

        <Reveal index={1}>
          <SectionTitle>Proposer une sortie</SectionTitle>
          <Card>
            <div className="flex flex-col gap-3">
              <TextField label="Quoi" value={form.name} onChange={(name) => setForm({ ...form, name })} placeholder="Festival, week-end, soirée…" />
              <TextField label="Où (facultatif)" value={form.place} onChange={(place) => setForm({ ...form, place })} />
              <div className="grid grid-cols-2 gap-2">
                <TextField label="Du" type="date" value={form.start} onChange={(start) => setForm({ ...form, start, end: form.end < start ? start : form.end })} />
                <TextField label="Au" type="date" value={form.end} onChange={(end) => setForm({ ...form, end })} />
              </div>
              <Button icon="flag" disabled={busy || !form.name.trim() || !spaces.uid} onClick={() => void create()}>
                {busy ? 'Création…' : 'Proposer et inviter'}
              </Button>
            </div>
          </Card>
          <p className="t-caption mt-2 px-1 text-muted">Tout est chiffré : seuls les membres de la sortie voient les réponses, le planning et le budget.</p>
        </Reveal>
      </div>
    </Screen>
  );
}

// ---------------------------------------------------------------- une sortie

interface Parsed {
  info: SortieInfo | null;
  infoAuthor: string | null;
  answers: Map<string, Answer>;
  sets: SortieSet[];
  going: Map<string, string[]>;
  expenses: (Expense & { author: string })[];
  items: Item[];
  ids: IdNote[];
}

function parseAll(records: readonly CachedRecord[]): Parsed {
  const p: Parsed = { info: null, infoAuthor: null, answers: new Map(), sets: [], going: new Map(), expenses: [], items: [], ids: [] };
  for (const r of records) {
    if (r.tbl === 'info' && r.rid === 'main') {
      p.info = parseInfo(r.row);
      p.infoAuthor = r.author;
    } else if (r.tbl === 'rsvp' && r.rid === r.author) {
      const a = parseAnswer(r.row);
      if (a) p.answers.set(r.author, a);
    } else if (r.tbl === 'set') {
      const s = parseSet(r.rid, r.row);
      if (s) p.sets.push(s);
    } else if (r.tbl === 'going' && r.rid === r.author) p.going.set(r.author, parseGoing(r.row));
    else if (r.tbl === 'expense') {
      const e = parseExpense(r.rid, r.row);
      if (e) p.expenses.push({ ...e, author: r.author });
    } else if (r.tbl === 'item') {
      const i = parseItem(r.rid, r.row);
      if (i) p.items.push(i);
    } else if (r.tbl === 'id') {
      const n = parseIdNote(r.rid, r.row);
      if (n) p.ids.push(n);
    }
  }
  p.sets = sortSets(p.sets);
  p.expenses.sort((a, b) => b.at - a.at);
  p.ids.sort((a, b) => b.at - a.at);
  return p;
}

type Tab = 'qui' | 'planning' | 'budget' | 'sac' | 'ids';

export function SortiePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const spaces = useCrews();
  const space: Space | undefined = spaces.sorties.find((s) => s.id === id);
  const data = useSpaceData(space);
  const uid = spaces.uid ?? '';
  const p = useMemo(() => parseAll(data.records), [data.records]);
  const pseudo = useMemo(() => new Map(data.members.map((m) => [m.uid, m.pseudo])), [data.members]);
  const members = data.members.map((m) => m.uid);
  const [tab, setTab] = useState<Tab>('qui');
  const [link, setLink] = useState<string | null>(null);
  const today = localToday();

  useEffect(() => {
    if (spaces.status === 'idle') void loadCrews();
  }, [spaces.status]);

  const invite = async () => {
    const c = client();
    if (!c || !space) return;
    try {
      const r = await c.invite(space, CREW_URL());
      setLink(r.link);
      await shareLink(r.link, p.info?.name ?? space.name);
    } catch (e) {
      toast({ message: errorText(e) });
    }
  };

  useEffect(() => {
    if (space && new URLSearchParams(location.search).get('inviter') === '1' && !link) void invite();
  }, [space?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const decision = p.info ? decide(members, p.answers, p.info.threshold) : null;
  const phase = p.info ? phaseOf(p.info, today) : 'avant';
  const mine = p.answers.get(uid) ?? null;

  // Personnage : une sortie faite (« chaud », ça se fait, commencée) compte dans la stat Social.
  useEffect(() => {
    if (!p.info || !decision?.on || mine !== 'chaud' || phase === 'avant') return;
    const weeks: Record<string, Record<string, number>> = {};
    for (let w = weekStart(p.info.start); w <= weekStart(p.info.end); w = addWeeks(w, 1)) weeks[w] = { groups: 1, friends: Math.max(0, decision.chaud.length - 1) };
    publishStats('raveloc', { weeks });
  }, [p.info, decision?.on, decision?.chaud.length, mine, phase]);

  if (!space) {
    return (
      <Screen stack title="Sortie" mood="today" back="/sorties">
        {spaces.status === 'ready' ? <EmptyState icon="flag" title="Sortie introuvable" body="Tu n’en fais peut-être plus partie." /> : <p className="t-small px-1 text-muted">Chargement…</p>}
      </Screen>
    );
  }

  const write = (tbl: string, rid: string, row: unknown | null, open = false) => writeSpace(space, uid, tbl, rid, row, open);
  const info = p.info;
  const status = !info ? null : phase === 'apres' ? 'Terminé' : phase === 'pendant' ? 'C’est maintenant' : `Dans ${Math.max(1, Math.round((Date.parse(`${info.start}T12:00:00`) - Date.parse(`${today}T12:00:00`)) / 86_400_000))} j`;

  return (
    <Screen stack title={info?.name ?? space.name} kicker={info ? `${info.start === info.end ? dayLabel(info.start) : `${dayLabel(info.start)} → ${dayLabel(info.end)}`}${info.place ? ` · ${info.place}` : ''}` : undefined} mood="today" back="/sorties">
      <div className="flex flex-col gap-3">
        <Reveal index={0}>
          <Card level="raised" glow>
            <div className="flex flex-wrap items-center gap-2">
              {status && <Badge tone={phase === 'pendant' ? 'success' : 'neutral'}>{status}</Badge>}
              {decision && <Badge tone={decision.on ? 'success' : 'warning'}>{decision.on ? `Ça se fait · ${decision.chaud.length} chaud${decision.chaud.length > 1 ? 's' : ''}` : `${decision.chaud.length}/${Math.min(info!.threshold, members.length)} chauds`}</Badge>}
              {data.pending > 0 && <Badge icon="offline">{data.pending} en attente de réseau</Badge>}
            </div>
            <p className="t-label mt-3 text-muted">Toi, tu es…</p>
            <div className="mt-1">
              <Segmented options={ANSWERS} value={mine ?? ('' as Answer)} onChange={(answer) => write('rsvp', uid, { answer })} label="Ta réponse" />
            </div>
          </Card>
        </Reveal>

        {phase === 'apres' && decision?.on && <Memory p={p} members={members} uid={uid} />}

        <Segmented<Tab>
          options={[
            { value: 'qui', label: 'Qui' },
            { value: 'planning', label: 'Planning' },
            { value: 'budget', label: 'Budget' },
            { value: 'sac', label: 'Sac' },
            { value: 'ids', label: 'ID' },
          ]}
          value={tab}
          onChange={setTab}
          label="Partie de la sortie"
        />

        {tab === 'qui' && (
          <div className="flex flex-col gap-3">
            <Card>
              {(['chaud', 'peutetre', 'non'] as const).map((a) => {
                const who = decision?.[a] ?? [];
                return who.length ? (
                  <p key={a} className="t-body py-1">
                    <strong>{ANSWERS.find((x) => x.value === a)!.label}</strong> : {who.map((u) => pseudo.get(u) ?? 'Membre').join(', ')}
                  </p>
                ) : null;
              })}
              {decision && decision.silent.length > 0 && <p className="t-small py-1 text-muted">Pas encore répondu : {decision.silent.map((u) => pseudo.get(u) ?? 'Membre').join(', ')}</p>}
              {info?.notes && <p className="t-small mt-2 text-secondary">{info.notes}</p>}
            </Card>
            <Card>
              <p className="t-body-strong">Inviter la bande</p>
              <p className="t-small mt-1 text-secondary">Un lien valable 7 jours ; la clé de la sortie voyage dedans, le serveur ne peut rien lire.</p>
              <Button className="mt-3 w-full" icon="share" onClick={() => void invite()}>
                Inviter
              </Button>
              {link && <p className="t-caption mt-2 select-all break-all text-muted">{link}</p>}
            </Card>
            <Card to="/raveloc/groupes/nouveau" label="Créer le groupe de localisation dans myRaveLoc">
              <div className="flex items-center gap-3">
                <Icon name="navigate" className="text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="t-body-strong block">Se retrouver sur place</span>
                  <span className="t-small block text-secondary">Crée le groupe dans myRaveLoc : flèche et distance vers chacun.</span>
                </span>
                <Icon name="chevron-forward" className="text-muted" />
              </div>
            </Card>
            <Disclosure title="Quitter la sortie" summary="Tes réponses et ajouts sont effacés">
              <Button
                variant="ghost"
                icon="logout"
                onClick={() =>
                  void client()
                    ?.leave(space)
                    .then(async () => {
                      forgetSpace(space.id);
                      await loadCrews();
                      navigate('/sorties', { replace: true });
                    }, (e: unknown) => toast({ message: errorText(e) }))
                }
              >
                Quitter
              </Button>
            </Disclosure>
          </div>
        )}

        {tab === 'planning' && info && <Planning info={info} p={p} uid={uid} pseudo={pseudo} write={write} />}
        {tab === 'budget' && <Budget p={p} members={members} uid={uid} pseudo={pseudo} write={write} />}
        {tab === 'sac' && <Bag items={p.items} write={write} />}
        {tab === 'ids' && <Ids p={p} today={today} write={write} />}

        {data.error && <p className="t-small px-1 text-danger">{data.error}</p>}
      </div>
    </Screen>
  );
}

type Write = (tbl: string, rid: string, row: unknown | null, open?: boolean) => void;

function Planning({ info, p, uid, pseudo, write }: { info: SortieInfo; p: Parsed; uid: string; pseudo: Map<string, string>; write: Write }) {
  const days = datesBetween(info.start, info.end);
  const [form, setForm] = useState({ day: days[0]!, start: '22:00', end: '23:30', stage: '', artist: '' });
  const mine = p.going.get(uid) ?? [];
  const goers = (setId: string) => [...p.going].filter(([, list]) => list.includes(setId)).map(([u]) => pseudo.get(u) ?? 'Membre');
  const toggle = (setId: string) => write('going', uid, { sets: mine.includes(setId) ? mine.filter((s) => s !== setId) : [...mine, setId] });
  return (
    <div className="flex flex-col gap-3">
      {p.sets.length === 0 && <p className="t-small px-1 text-muted">Ajoute les sets qui vous intéressent : chacun coche ceux où il va, et vous voyez qui sera où.</p>}
      {days.map((d) => {
        const sets = p.sets.filter((s) => s.day === d);
        return sets.length ? (
          <div key={d}>
            <SectionTitle>{dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long' })}</SectionTitle>
            <Card className="divide-y divide-line">
              {sets.map((s) => {
                const who = goers(s.id);
                const going = mine.includes(s.id);
                return (
                  <div key={s.id} className="flex items-start gap-3 py-2.5">
                    <span className="num t-small w-[86px] shrink-0 text-secondary">
                      {s.start}
                      {s.end ? `–${s.end}` : ''}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="t-body-strong">{s.artist}</p>
                      {s.stage && <p className="t-caption text-muted">{s.stage}</p>}
                      {who.length > 0 && <p className="t-small text-secondary">{who.join(', ')}</p>}
                    </div>
                    <Button size="sm" variant={going ? 'primary' : 'secondary'} onClick={() => toggle(s.id)}>
                      {going ? 'J’y vais' : 'Y aller'}
                    </Button>
                  </div>
                );
              })}
            </Card>
          </div>
        ) : null;
      })}
      <Disclosure title="Ajouter un set" summary="Jour, heure, scène, artiste">
        <div className="flex flex-col gap-3">
          <SelectField label="Jour" value={form.day} onChange={(day) => setForm({ ...form, day })} options={days.map((d) => ({ value: d, label: dayLabel(d) }))} />
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Début" type="time" value={form.start} onChange={(start) => setForm({ ...form, start })} />
            <TextField label="Fin" type="time" value={form.end} onChange={(end) => setForm({ ...form, end })} />
          </div>
          <TextField label="Scène" value={form.stage} onChange={(stage) => setForm({ ...form, stage })} />
          <TextField label="Artiste" value={form.artist} onChange={(artist) => setForm({ ...form, artist })} />
          <Button
            icon="add"
            disabled={!form.artist.trim()}
            onClick={() => {
              write('set', newRid(), { day: form.day, start: form.start, end: form.end, stage: form.stage.trim(), artist: form.artist.trim() }, true);
              setForm({ ...form, artist: '' });
            }}
          >
            Ajouter le set
          </Button>
        </div>
      </Disclosure>
    </div>
  );
}

function Budget({ p, members, uid, pseudo, write }: { p: Parsed; members: string[]; uid: string; pseudo: Map<string, string>; write: Write }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState(uid);
  const [everyone, setEveryone] = useState(true);
  const [forUids, setForUids] = useState<string[]>([]);
  const bal = balances(p.expenses, members);
  const transfers = settle(bal);
  const name = (u: string) => pseudo.get(u) ?? 'Membre';
  const total = p.expenses.reduce((n, e) => n + e.cents, 0);
  const add = () => {
    const cents = tryDecimalToCents(amount);
    if (!cents || cents <= 0) return toast({ message: 'Montant invalide' });
    write('expense', newRid(), { label: label.trim() || 'Dépense', cents, paidBy: paidBy || uid, forUids: everyone ? [] : forUids, at: Date.now() });
    setLabel('');
    setAmount('');
  };
  return (
    <div className="flex flex-col gap-3">
      <Card level="raised">
        <p className="t-label text-muted">Total dépensé</p>
        <p className="num font-display text-[32px] font-bold">{euros(total)}</p>
        {transfers.length ? (
          <div className="mt-2 flex flex-col gap-1">
            {transfers.map((t) => (
              <p key={`${t.from}${t.to}`} className="t-body">
                <strong>{name(t.from)}</strong> doit <strong>{euros(t.cents)}</strong> à {name(t.to)}
                {t.from === uid ? <span className="t-small text-muted"> · toi</span> : null}
              </p>
            ))}
          </div>
        ) : (
          <p className="t-small text-secondary">{total ? 'Tout le monde est quitte.' : 'Ajoute la première dépense : chacun voit ce qu’il doit, au centime près.'}</p>
        )}
      </Card>
      {p.expenses.length > 0 && (
        <Card className="divide-y divide-line">
          {p.expenses.map((e) => (
            <div key={e.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="t-body-strong truncate">{e.label}</p>
                <p className="t-small text-secondary">
                  Payé par {name(e.paidBy)} · {e.forUids.length ? `pour ${e.forUids.map(name).join(', ')}` : 'pour tous'}
                </p>
              </div>
              <span className="num t-body-strong shrink-0">{euros(e.cents)}</span>
              {e.author === uid && (
                <button type="button" className="t-caption text-muted" aria-label={`Supprimer ${e.label}`} onClick={() => write('expense', e.id, null)}>
                  <Icon name="trash" size={16} />
                </button>
              )}
            </div>
          ))}
        </Card>
      )}
      <Disclosure title="Ajouter une dépense" summary="Billets, essence, courses…">
        <div className="flex flex-col gap-3">
          <TextField label="Quoi" value={label} onChange={setLabel} placeholder="Billets, essence…" />
          <TextField label="Montant (€)" value={amount} onChange={setAmount} inputMode="decimal" placeholder="0,00" />
          <SelectField label="Payé par" value={paidBy || uid} onChange={setPaidBy} options={members.map((m) => ({ value: m, label: m === uid ? `${name(m)} (toi)` : name(m) }))} />
          <ToggleRow label="Pour tout le monde" checked={everyone} onChange={setEveryone} />
          {!everyone &&
            members.map((m) => (
              <ToggleRow key={m} label={name(m)} checked={forUids.includes(m)} onChange={(on) => setForUids(on ? [...forUids, m] : forUids.filter((x) => x !== m))} />
            ))}
          <Button icon="add" disabled={!amount.trim()} onClick={add}>
            Ajouter
          </Button>
        </div>
      </Disclosure>
    </div>
  );
}

function Bag({ items, write }: { items: Item[]; write: Write }) {
  const [text, setText] = useState('');
  const sorted = [...items].sort((a, b) => Number(a.done) - Number(b.done) || a.text.localeCompare(b.text));
  return (
    <div className="flex flex-col gap-3">
      <Card>
        {sorted.length === 0 && <p className="t-small text-muted">Tente, bouchons d’oreilles, batterie externe… La liste est commune : chacun coche ce qu’il prend.</p>}
        {sorted.map((i) => (
          <ToggleRow key={i.id} label={<span className={i.done ? 'text-muted line-through' : ''}>{i.text}</span>} checked={i.done} onChange={(done) => write('item', i.id, { text: i.text, done }, true)} />
        ))}
      </Card>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <TextField label="Ajouter à la liste" value={text} onChange={setText} placeholder="Ex. tente" />
        </div>
        <Button
          className="self-end"
          icon="add"
          disabled={!text.trim()}
          onClick={() => {
            write('item', newRid(), { text: text.trim(), done: false }, true);
            setText('');
          }}
        >
          Ajouter
        </Button>
      </div>
    </div>
  );
}

function Ids({ p, today, write }: { p: Parsed; today: string; write: Write }) {
  const stages = [...new Set(p.sets.map((s) => s.stage).filter(Boolean))];
  const [stage, setStage] = useState(stages[0] ?? '');
  const capture = () => {
    const s = setAt(p.sets, today, nowHHMM(), stage || undefined) ?? setAt(p.sets, today, nowHHMM());
    write('id', newRid(), { at: Date.now(), setId: s?.id ?? null, stage: s?.stage ?? stage, artist: s?.artist ?? '', note: '', found: '' }, true);
    toast({ message: s ? `ID noté : ${s.artist}${s.stage ? ` · ${s.stage}` : ''}` : 'ID noté', tone: 'gold' });
  };
  const time = (at: number) => new Intl.DateTimeFormat('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(at));
  return (
    <div className="flex flex-col gap-3">
      <Card level="raised" glow className="text-center">
        <p className="t-small text-secondary">Un morceau te retourne le cerveau ? Un toucher : l’heure, la scène et le DJ (d’après le planning) sont notés.</p>
        {stages.length > 1 && (
          <div className="mt-3 text-left">
            <SelectField label="Tu es devant" value={stage} onChange={setStage} options={stages.map((s) => ({ value: s, label: s }))} />
          </div>
        )}
        <Button size="lg" className="mt-3 w-full" icon="sparkles" onClick={capture}>
          ID ?
        </Button>
      </Card>
      {p.ids.map((n) => (
        <Card key={n.id}>
          <p className="t-body-strong">{n.artist || 'Set inconnu'}</p>
          <p className="t-caption text-muted">
            {time(n.at)}
            {n.stage ? ` · ${n.stage}` : ''}
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <TextField label="Ce dont tu te souviens" value={n.note} onCommit={(note) => write('id', n.id, { ...n, note }, true)} placeholder="Voix féminine, break de batterie…" />
            <TextField label="Trouvé ?" value={n.found} onCommit={(found) => write('id', n.id, { ...n, found }, true)} placeholder="Artiste – titre" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function Memory({ p, members, uid }: { p: Parsed; members: string[]; uid: string }) {
  const chaud = [...p.answers].filter(([, a]) => a === 'chaud').map(([u]) => u);
  const m = memoryOf({ chaud, going: p.going, ids: p.ids, expenses: p.expenses, members, me: uid });
  return (
    <Reveal index={1}>
      <Card level="raised">
        <p className="t-label text-gold">Souvenir</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[
            [`${m.people}`, m.people > 1 ? 'dans la bande' : 'présent'],
            [`${m.sets}`, m.sets > 1 ? 'sets prévus' : 'set prévu'],
            [`${m.found}/${m.ids}`, 'ID trouvés'],
            [euros(m.myCents), 'ta part'],
          ].map(([v, l]) => (
            <div key={l} className="rounded-md p-3" style={{ background: 'var(--surface-alt)' }}>
              <p className="num font-display text-[24px] font-bold">{v}</p>
              <p className="t-caption text-muted">{l}</p>
            </div>
          ))}
        </div>
      </Card>
    </Reveal>
  );
}
