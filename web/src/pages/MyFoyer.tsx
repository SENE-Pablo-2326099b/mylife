import { useEffect, useMemo, useState } from 'react';
import {
  balances,
  choreDoneId,
  choresByWeek,
  localToday,
  nextBill,
  parseBill,
  parseChore,
  parseChoreDone,
  parseExpense,
  settle,
  todayForHome,
  turnOf,
  weekStart,
  type Bill,
  type Chore,
  type Expense,
} from '../vendor/lumen';
import { loadCrews, useCrews } from '../crew';
import { createFoyer, inviteFoyer, leaveFoyer } from '../foyerSpace';
import { newRid, useSpaceData, writeSpace } from '../spaceSync';
import { Icon } from '../ui/icons';
import { Badge, Button, Card, EmptyState, Group, Reveal, Row, SectionTitle, SelectField, Sheet, TextField, toast } from '../ui/index';
import { formatCents, tryDecimalToCents } from '../ui/money';
import { Screen } from '../ui/Screen';
import { useSession } from '../ui/session';
import { publishStats } from '../ui/stats';

/**
 * MyFoyer (V4, 3.3) : dépenses communes, corvées tournantes et factures du foyer, dans le même espace chiffré que la
 * liste de courses de MyChef. Moteur : packages/lumen/src/foyer.ts (et le budget des Sorties pour les dépenses).
 */
const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

function NoFoyer({ uid }: { uid: string | null }) {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  return (
    <Card level="raised" glow>
      <EmptyState icon="home" title="Ton foyer, à plusieurs" body="Couple, coloc, famille : la liste de courses, les dépenses communes avec qui doit quoi, les corvées chacun son tour et les factures du logement. Chiffré : seuls les membres le voient." />
      <Button className="mt-3 w-full" icon="people" disabled={busy || !uid || !session} onClick={() => {
        if (!uid || !session) return;
        setBusy(true);
        void createFoyer(uid, session.login)
          .then((space) => inviteFoyer(space))
          .catch((e: unknown) => toast({ message: errorText(e) }))
          .finally(() => setBusy(false));
      }}>
        {busy ? 'Un instant…' : 'Créer mon foyer'}
      </Button>
    </Card>
  );
}

export function MyFoyerPage() {
  const crews = useCrews();
  useEffect(() => {
    if (crews.status === 'idle') void loadCrews();
  }, [crews.status]);
  const space = crews.lists[0];
  const data = useSpaceData(space);
  const uid = crews.uid;
  const today = localToday();
  const [sheet, setSheet] = useState<'expense' | 'chore' | 'bill' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const pseudo = useMemo(() => new Map(data.members.map((m) => [m.uid, m.pseudo])), [data.members]);
  const members = data.members.map((m) => m.uid);
  const name = (u: string) => (u === uid ? 'toi' : (pseudo.get(u) ?? 'un ancien membre'));
  const expenses = data.records.filter((r) => r.tbl === 'expense').flatMap((r) => (parseExpense(r.rid, r.row) ? [parseExpense(r.rid, r.row)!] : [])).sort((a, b) => b.at - a.at);
  const chores = data.records.filter((r) => r.tbl === 'chore').flatMap((r) => (parseChore(r.row) ? [{ id: r.rid, value: parseChore(r.row)! }] : []));
  const done = data.records.filter((r) => r.tbl === 'chore_done').flatMap((r) => (parseChoreDone(r.row) ? [{ rid: r.rid, value: parseChoreDone(r.row)! }] : []));
  const bills = data.records.filter((r) => r.tbl === 'bill').flatMap((r) => (parseBill(r.row) ? [{ id: r.rid, value: parseBill(r.row)! }] : []));
  // Personnage : la stat Foyer compte mes corvées faites (jamais les montants, jamais de classement).
  useEffect(() => {
    if (uid && done.length) publishStats('foyer', { weeks: choresByWeek(done, uid) });
  }, [uid, done.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!space || !uid)
    return (
      <Screen stack title="MyFoyer" kicker="La maison, à plusieurs" mood="today" back="/">
        {crews.status === 'ready' || crews.status === 'error' ? <NoFoyer uid={uid} /> : <p className="t-small px-1 text-muted">Chargement…</p>}
      </Screen>
    );

  const write = (tbl: string, rid: string, row: unknown | null, open = false) => writeSpace(space, uid, tbl, rid, row, open);
  const board = todayForHome({ chores, done: new Set(done.map((d) => d.rid)), bills, members, today, uid });
  const owed = settle(balances(expenses, members));
  const others = Math.max(0, members.length - 1);

  return (
    <Screen stack title="MyFoyer" kicker={others ? `Avec ${others} personne${others > 1 ? 's' : ''}` : 'Invite ton foyer'} mood="today" back="/">
      <div className="flex flex-col gap-3">
        <Reveal index={0}>
          <Card level="raised">
            <p className="t-label text-muted">Aujourd’hui pour la maison</p>
            {board.mine.length === 0 && board.billsSoon.length === 0 ? (
              <p className="t-body mt-1 text-secondary">Rien à faire pour toi cette semaine.</p>
            ) : (
              <div className="mt-1 flex flex-col gap-2">
                {board.mine.map((m) => (
                  <div key={m.id} className="flex items-center gap-2">
                    <Icon name="home" size={16} className="text-gold" />
                    <span className="t-body min-w-0 flex-1">
                      {m.chore.name} <span className="t-small text-secondary">· ton tour, {WEEKDAYS[m.chore.weekday]}</span>
                    </span>
                    <Button size="sm" icon="check" onClick={() => {
                      write('chore_done', choreDoneId(m.id, today), { by: uid, at: Date.now() }, true);
                      toast({ message: `${m.chore.name} : fait`, tone: 'gold' });
                    }}>
                      Fait
                    </Button>
                  </div>
                ))}
                {board.billsSoon.map((b) => (
                  <p key={b.id} className="t-small text-secondary">
                    <Icon name="card" size={14} className="mr-1.5 inline text-gold" />
                    {b.bill.label} le {shortDate(b.date)}
                    {b.bill.cents ? ` · ${formatCents(b.bill.cents)}` : ''}
                  </p>
                ))}
              </div>
            )}
            {board.others.length > 0 && <p className="t-caption mt-2 text-muted">Cette semaine : {board.others.map((o) => `${o.chore.name} pour ${name(o.who)}`).join(', ')}.</p>}
            <p className="t-caption mt-2 text-muted">La liste de courses du foyer est dans MyChef.</p>
          </Card>
        </Reveal>

        <SectionTitle action={<Button size="sm" variant="ghost" icon="add" onClick={() => setSheet('expense')}>Ajouter</Button>}>Dépenses communes</SectionTitle>
        <Card>
          {owed.length === 0 ? (
            <p className="t-body text-secondary">{expenses.length ? 'Tout le monde est à l’équilibre.' : 'Aucune dépense pour l’instant.'}</p>
          ) : (
            owed.map((o, i) => (
              <p key={i} className="t-body">
                <strong className="text-ink">{name(o.from) === 'toi' ? 'Tu dois' : `${name(o.from)} doit`}</strong> {formatCents(o.cents)} à {name(o.to)}
              </p>
            ))
          )}
        </Card>
        {expenses.length > 0 && (
          <Group>
            {expenses.slice(0, 20).map((e) => (
              <Row key={e.id} title={e.label} subtitle={`payé par ${name(e.paidBy)}${e.forUids.length ? ` pour ${e.forUids.map(name).join(', ')}` : ', partagé par tous'}`} right={<span className="num t-small">{formatCents(e.cents)}</span>} onClick={e.paidBy === uid ? () => {
                write('expense', e.id, null);
                toast({ message: `${e.label} supprimée` });
              } : undefined} />
            ))}
          </Group>
        )}

        <SectionTitle action={<Button size="sm" variant="ghost" icon="add" onClick={() => setSheet('chore')}>Ajouter</Button>}>Corvées</SectionTitle>
        {chores.length === 0 ? (
          <Card><p className="t-small text-secondary">Les poubelles, la salle de bain, les courses : chacun son tour, une semaine sur deux ou trois selon le nombre de membres.</p></Card>
        ) : (
          <Group>
            {chores.map((c) => {
              const isDone = done.some((d) => d.rid === choreDoneId(c.id, today));
              return (
                <Row key={c.id} title={c.value.name} subtitle={`le ${WEEKDAYS[c.value.weekday]}`} right={isDone ? <Badge tone="success" icon="check">Faite</Badge> : <span className="t-small text-secondary">{(() => { const who = turnOf(c.value, today, members); return who ? name(who) : ''; })()}</span>} />
              );
            })}
          </Group>
        )}

        <SectionTitle action={<Button size="sm" variant="ghost" icon="add" onClick={() => setSheet('bill')}>Ajouter</Button>}>Factures du logement</SectionTitle>
        {bills.length === 0 ? (
          <Card><p className="t-small text-secondary">Loyer, énergie, internet, assurance : leur jour, et elles s’affichent la semaine où elles tombent.</p></Card>
        ) : (
          <Group>
            {bills.map((b) => (
              <Row key={b.id} title={b.value.label} subtitle={`prochaine le ${shortDate(nextBill(b.value, today))}`} right={b.value.cents ? <span className="num t-small">{formatCents(b.value.cents)}</span> : undefined} />
            ))}
          </Group>
        )}

        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button variant="secondary" icon="share" onClick={() => void inviteFoyer(space).catch((e: unknown) => toast({ message: errorText(e) }))}>
            Inviter
          </Button>
          <Button variant="ghost" onClick={() => {
            if (!leaving) return setLeaving(true);
            void leaveFoyer(space).then(() => toast({ message: 'Tu as quitté le foyer' }), (e: unknown) => toast({ message: errorText(e) }));
          }}>
            {leaving ? 'Confirmer : quitter' : 'Quitter le foyer'}
          </Button>
        </div>
      </div>

      <AddExpense open={sheet === 'expense'} onClose={() => setSheet(null)} onSave={(label, cents) => write('expense', newRid(), { label, cents, paidBy: uid, forUids: [], at: Date.now() } satisfies Omit<Expense, 'id'>)} />
      <AddChore open={sheet === 'chore'} onClose={() => setSheet(null)} onSave={(name, weekday) => write('chore', newRid(), { v: 1, name, weekday, order: [uid, ...members.filter((m) => m !== uid)], start: weekStart(today) } satisfies Chore, true)} />
      <AddBill open={sheet === 'bill'} onClose={() => setSheet(null)} onSave={(label, day, cents) => write('bill', newRid(), { v: 1, label, day, ...(cents ? { cents } : {}) } satisfies Bill, true)} />
    </Screen>
  );
}

function AddExpense({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (label: string, cents: number) => void }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const cents = tryDecimalToCents(amount);
  return (
    <Sheet open={open} onClose={onClose} title="Une dépense commune" footer={<Button size="lg" className="w-full" disabled={!cents || cents <= 0} onClick={() => { onSave(label.trim() || 'Dépense', cents!); setLabel(''); setAmount(''); onClose(); }}>Ajouter</Button>}>
      <div className="flex flex-col gap-3">
        <TextField label="Quelle dépense" value={label} onChange={setLabel} placeholder="Courses, électricité…" />
        <TextField label="Montant (€)" inputMode="decimal" value={amount} onChange={setAmount} />
        <p className="t-caption text-muted">Payée par toi, partagée à parts égales entre les membres du foyer.</p>
      </div>
    </Sheet>
  );
}

function AddChore({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (name: string, weekday: number) => void }) {
  const [name, setName] = useState('');
  const [weekday, setWeekday] = useState('0');
  return (
    <Sheet open={open} onClose={onClose} title="Une corvée" footer={<Button size="lg" className="w-full" disabled={!name.trim()} onClick={() => { onSave(name.trim(), Number(weekday)); setName(''); onClose(); }}>Ajouter</Button>}>
      <div className="flex flex-col gap-3">
        <TextField label="Quelle corvée" value={name} onChange={setName} placeholder="Poubelles, salle de bain…" />
        <SelectField label="Quel jour" value={weekday} onChange={setWeekday} options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} hint="Chacun son tour, une semaine chacun, en commençant par toi." />
      </div>
    </Sheet>
  );
}

function AddBill({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (label: string, day: number, cents?: number) => void }) {
  const [label, setLabel] = useState('');
  const [day, setDay] = useState('1');
  const [amount, setAmount] = useState('');
  const d = Number(day);
  return (
    <Sheet open={open} onClose={onClose} title="Une facture du logement" footer={<Button size="lg" className="w-full" disabled={!label.trim() || !(d >= 1 && d <= 31)} onClick={() => { onSave(label.trim(), d, tryDecimalToCents(amount) ?? undefined); setLabel(''); setAmount(''); onClose(); }}>Ajouter</Button>}>
      <div className="flex flex-col gap-3">
        <TextField label="Quelle facture" value={label} onChange={setLabel} placeholder="Loyer, électricité, internet…" />
        <TextField label="Jour du mois" inputMode="numeric" value={day} onChange={setDay} />
        <TextField label="Montant habituel (€, facultatif)" inputMode="decimal" value={amount} onChange={setAmount} />
      </div>
    </Sheet>
  );
}
