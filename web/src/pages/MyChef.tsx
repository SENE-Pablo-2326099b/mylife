import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PLACES,
  byAisle,
  daysUntil,
  estimateList,
  expiringSoon,
  findFood,
  foodId,
  isRunningLow,
  localToday,
  newPantryItem,
  parseShoppingItem,
  staplesToBuy,
  stockAfterPurchase,
  suggestFoods,
  type Level,
  type PantryItem,
  type Place,
  type ShoppingItem,
} from '../vendor/lumen';
import type { Space } from '../vendor/mylife-sync';
import { listItemFor, pantry, prices, shopping } from '../myChefData';
import { TicketImport } from './ChefTicket';
import { formatCents } from '../ui/money';
import { ChefRecipes } from './ChefRecipes';
import { ChefWeek } from './ChefWeek';
import { CREW_URL, client, loadCrews, useCrews } from '../crew';
import { forgetSpace, useSpaceData, writeSpace } from '../spaceSync';
import { useSession } from '../ui/session';
import { Icon } from '../ui/icons';
import { Badge, Button, Card, Chip, EmptyState, Group, Reveal, Row, SectionTitle, Segmented, SelectField, Sheet, TextField, ToggleRow, toast } from '../ui/index';
import { Screen } from '../ui/Screen';

/**
 * MyChef (V4, 3.4), palier 1 : la liste de courses et le garde-manger. Les indispensables bientôt finis reviennent seuls
 * sur la liste ; un article coché en magasin entre dans le stock. Moteur : packages/lumen/src/chef.ts.
 */
type Tab = 'courses' | 'stock' | 'recettes' | 'semaine';
const LEVEL: Record<Level, string> = { ok: 'En stock', low: 'Bientôt fini', out: 'Fini' };

function when(expires: string, today: string): { text: string; tone: 'danger' | 'warning' | 'muted' } {
  const d = daysUntil(expires, today);
  if (d < 0) return { text: 'périmé', tone: 'danger' };
  if (d === 0) return { text: 'aujourd’hui', tone: 'warning' };
  if (d === 1) return { text: 'demain', tone: 'warning' };
  if (d <= 3) return { text: `dans ${d} jours`, tone: 'warning' };
  return { text: `jusqu’au ${new Date(`${expires}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`, tone: 'muted' };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const STOCKED_KEY = 'mylife:app:chef:stocked';
function readStocked(): Record<string, number> {
  try {
    return (JSON.parse(localStorage.getItem(STOCKED_KEY) ?? '{}') as Record<string, number>) ?? {};
  } catch {
    return {};
  }
}

interface ListItem {
  id: string;
  value: ShoppingItem;
}

/**
 * La liste de courses : la tienne (synchronisée entre tes appareils), ou celle de ton foyer (espace chiffré de type
 * « liste », lignes ouvertes : chaque membre ajoute, coche, retire ; hors ligne d'abord).
 */
function useShoppingList(): { items: ListItem[]; put: (id: string, v: ShoppingItem) => void; remove: (id: string) => void; shared: Space | null; members: number; uid: string | null } {
  const crews = useCrews();
  useEffect(() => {
    if (crews.status === 'idle') void loadCrews();
  }, [crews.status]);
  const space = crews.lists[0];
  const data = useSpaceData(space);
  const personal = shopping.useList();
  if (space && crews.uid) {
    const uid = crews.uid;
    const items = data.records.filter((r) => r.tbl === 'item').flatMap((r) => {
      const v = parseShoppingItem(r.row);
      return v ? [{ id: r.rid, value: v }] : [];
    });
    return { items, put: (id, v) => writeSpace(space, uid, 'item', id, v, true), remove: (id) => writeSpace(space, uid, 'item', id, null, true), shared: space, members: data.members.length, uid };
  }
  return { items: personal, put: (id, v) => shopping.put(id, v), remove: (id) => shopping.remove(id), shared: null, members: 0, uid: crews.uid };
}

async function shareLink(link: string): Promise<void> {
  if (navigator.share) {
    try {
      return await navigator.share({ title: 'Courses du foyer', text: 'Rejoins notre liste de courses sur MyLife', url: link });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    toast({ message: 'Lien copié : envoie-le à ton foyer', tone: 'gold' });
  } catch {
    toast({ message: 'Copie impossible : sélectionne le lien affiché' });
  }
}

/** Partager la liste avec son foyer (ou la quitter). */
function FoyerCard({ list }: { list: ReturnType<typeof useShoppingList> }) {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const invite = async (space: Space) => {
    const c = client();
    if (!c) return;
    const r = await c.invite(space, CREW_URL());
    setLink(r.link);
    await shareLink(r.link);
  };
  const share = async () => {
    const c = client();
    if (!c || !list.uid || !session) return;
    setBusy(true);
    try {
      const pseudo = session.login.charAt(0).toUpperCase() + session.login.slice(1);
      const space = await c.create('liste', 'Courses du foyer', pseudo, list.uid);
      // Ta liste devient celle du foyer.
      for (const i of shopping.list()) writeSpace(space, list.uid, 'item', i.id, i.value, true);
      for (const i of shopping.list()) shopping.remove(i.id);
      await loadCrews();
      await invite(space);
    } catch (e) {
      toast({ message: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  const leave = async () => {
    const c = client();
    const space = list.shared;
    if (!c || !space) return;
    if (!leaving) return setLeaving(true);
    setBusy(true);
    try {
      await c.leave(space);
      forgetSpace(space.id);
      await loadCrews();
      toast({ message: 'Tu as quitté la liste du foyer' });
    } catch (e) {
      toast({ message: errorText(e) });
    } finally {
      setBusy(false);
      setLeaving(false);
    }
  };
  if (!list.shared)
    return (
      <Card>
        <p className="t-body-strong">Faire les courses à plusieurs</p>
        <p className="t-small mt-1 text-secondary">Partage ta liste avec ton foyer : chacun ajoute et coche, même sans réseau au magasin, et ce que l’un coche entre dans le garde-manger de chacun. Chiffrée : le serveur ne la lit pas.</p>
        <Button className="mt-3 w-full" variant="secondary" icon="people" disabled={busy || !list.uid} onClick={() => void share()}>
          {busy ? 'Un instant…' : 'Partager avec mon foyer'}
        </Button>
      </Card>
    );
  const others = Math.max(0, list.members - 1);
  return (
    <Card>
      <div className="flex items-center gap-2">
        <Icon name="people-fill" className="text-gold" />
        <p className="t-body-strong min-w-0 flex-1">Liste du foyer</p>
        <span className="t-caption text-muted">{others ? `avec ${others} personne${others > 1 ? 's' : ''}` : 'personne d’autre pour l’instant'}</span>
      </div>
      {link && <p className="t-caption mt-2 break-all text-muted">{link}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button size="sm" variant="secondary" icon="share" disabled={busy} onClick={() => void invite(list.shared!).catch((e) => toast({ message: errorText(e) }))}>
          Inviter
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void leave()}>
          {leaving ? 'Confirmer' : 'Quitter'}
        </Button>
      </div>
    </Card>
  );
}

/** Champ d'ajout avec les suggestions du catalogue. */
function AddFood({ label, onAdd }: { label: string; onAdd: (name: string) => void }) {
  const [text, setText] = useState('');
  const suggestions = suggestFoods(text, 5);
  const add = (name: string) => {
    if (!name.trim()) return;
    onAdd(name.trim());
    setText('');
  };
  return (
    <Card>
      <TextField label={label} value={text} onChange={setText} enterKeyHint="done" placeholder="Lait, pâtes, œufs…" />
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.map((f) => (
            <Chip key={f.name} small onClick={() => add(f.name)}>
              {f.name}
            </Chip>
          ))}
        </div>
      )}
      <Button className="mt-3 w-full" icon="add" disabled={!text.trim()} onClick={() => add(text)}>
        Ajouter
      </Button>
    </Card>
  );
}

function Shopping({ today }: { today: string }) {
  const src = useShoppingList();
  const list = src.items;
  const stock = pantry.useList();
  const groups = byAisle(list);
  const done = list.filter((l) => l.value.done);
  const get = (id: string) => list.find((l) => l.id === id)?.value ?? null;
  // Les indispensables bientôt finis passent tout seuls sur la liste.
  useEffect(() => {
    for (const p of staplesToBuy(stock, list)) src.put(foodId(p.value.name), { v: 1, name: p.value.name, aisle: p.value.aisle, auto: true });
  }, [stock, list]); // eslint-disable-line react-hooks/exhaustive-deps
  // Coché = acheté : l'article entre dans le garde-manger, une seule fois par coche, que ce soit toi ou un membre du foyer.
  useEffect(() => {
    const stocked = readStocked();
    let changed = false;
    for (const l of list) {
      if (!l.value.done || !l.value.doneAt || stocked[l.id] === l.value.doneAt) continue;
      pantry.put(l.id, stockAfterPurchase(pantry.get(l.id), l.value, today));
      stocked[l.id] = l.value.doneAt;
      changed = true;
    }
    if (changed) {
      try {
        localStorage.setItem(STOCKED_KEY, JSON.stringify(Object.fromEntries(Object.entries(stocked).slice(-500))));
      } catch {
        /* stockage plein */
      }
    }
  }, [list, today]);
  const add = (name: string) => {
    const id = foodId(name);
    const existing = get(id);
    if (existing && !existing.done) return toast({ message: `${existing.name} est déjà sur la liste` });
    const food = findFood(name);
    src.put(id, { v: 1, name: food?.name ?? name, aisle: food?.aisle ?? 'autre' });
  };
  const toggle = (id: string) => {
    const item = get(id);
    if (!item) return;
    const { done: _d, doneAt: _a, ...rest } = item;
    void _d;
    void _a;
    src.put(id, item.done ? rest : { ...rest, done: true, doneAt: Date.now() });
  };
  return (
    <div className="flex flex-col gap-3">
      <FoyerCard list={src} />
      <AddFood label="Ajouter à la liste" onAdd={add} />
      <ListCost list={list} />
      {list.length === 0 ? (
        <Card>
          <EmptyState icon="leaf" title="Liste vide" body="Ajoute ce qu’il te faut. Marque tes indispensables dans le garde-manger : ils reviendront tout seuls quand ils seront bientôt finis." />
        </Card>
      ) : (
        groups.map((g) => (
          <Reveal key={g.aisle}>
            <SectionTitle action={<span className="t-caption text-muted">{g.items.filter((i) => !i.value.done).length}</span>}>{g.name}</SectionTitle>
            <Group>
              {g.items.map((i) => (
                <Row
                  key={i.id}
                  onClick={() => toggle(i.id)}
                  title={<span className={i.value.done ? 'text-muted line-through' : ''}>{i.value.name}</span>}
                  subtitle={i.value.auto && !i.value.done ? 'Indispensable à racheter' : i.value.qty !== undefined ? `${String(i.value.qty).replace('.', ',')} ${i.value.unit ?? ''}` : undefined}
                  right={
                    <span role="checkbox" aria-checked={!!i.value.done} aria-label={`${i.value.name} : ${i.value.done ? 'pris' : 'à prendre'}`} className={`flex h-7 w-7 items-center justify-center rounded-full border ${i.value.done ? 'border-transparent bg-accent text-white' : 'border-line'}`}>
                      {i.value.done && <Icon name="check" size={16} />}
                    </span>
                  }
                />
              ))}
            </Group>
          </Reveal>
        ))
      )}
      {done.length > 0 && (
        <Button
          variant="ghost"
          icon="trash"
          onClick={() => {
            for (const d of done) src.remove(d.id);
            toast({ message: `${done.length} article${done.length > 1 ? 's' : ''} retiré${done.length > 1 ? 's' : ''} de la liste (déjà dans le garde-manger)` });
          }}
        >
          Retirer les {done.length} article{done.length > 1 ? 's' : ''} pris
        </Button>
      )}
    </div>
  );
}

function PantryEditor({ id, item, onClose }: { id: string; item: PantryItem; onClose: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const save = (patch: Partial<PantryItem>) => pantry.put(id, { ...item, ...patch });
  return (
    <div className="flex flex-col gap-3">
      <Segmented label="Où en est le stock" value={item.level} onChange={(level) => save({ level })} options={(Object.keys(LEVEL) as Level[]).map((l) => ({ value: l, label: LEVEL[l] }))} />
      <SelectField label="Rangé" value={item.place} onChange={(place: Place) => save({ place })} options={PLACES.map((p) => ({ value: p.id, label: p.name }))} />
      <TextField label="À consommer avant (facultatif)" type="date" value={item.expires ?? ''} onChange={(v) => save(v ? { expires: v } : { expires: undefined })} />
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Quantité (facultatif)" inputMode="decimal" value={item.qty === undefined ? '' : String(item.qty).replace('.', ',')} onChange={(v) => {
          const n = Number(v.replace(',', '.'));
          save(v.trim() && Number.isFinite(n) ? { qty: n } : { qty: undefined });
        }} />
        <TextField label="Unité" value={item.unit ?? ''} onChange={(unit) => save({ unit: unit || undefined })} placeholder="g, L, pièce…" />
      </div>
      <ToggleRow label="Indispensable" hint="Revient tout seul sur la liste quand il est bientôt fini." checked={!!item.staple} onChange={(staple) => save({ staple: staple || undefined })} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon="add" onClick={() => {
          shopping.put(id, { v: 1, name: item.name, aisle: item.aisle });
          toast({ message: `${item.name} ajouté à la liste` });
        }}>
          Ajouter à la liste
        </Button>
        <Button variant="ghost" icon="trash" onClick={() => {
          if (!deleting) return setDeleting(true);
          pantry.remove(id);
          onClose();
        }}>
          {deleting ? 'Confirmer' : 'Retirer du garde-manger'}
        </Button>
      </div>
    </div>
  );
}

/** Coût estimé de la liste, avec les prix retenus des tickets. */
function ListCost({ list }: { list: ListItem[] }) {
  const known = prices.useList();
  if (!known.length || !list.some((l) => !l.value.done)) return null;
  const e = estimateList(list, new Map(known.map((p) => [p.id, p.value])));
  if (!e.priced) return null;
  return (
    <p className="t-small px-1 text-secondary">
      Environ <strong className="text-ink">{formatCents(e.total)}</strong> pour {e.priced} article{e.priced > 1 ? 's' : ''}
      {e.unknown > 0 && <> ({e.unknown} sans prix connu)</>}, d’après tes derniers tickets.
    </p>
  );
}

function Pantry({ today, onBought }: { today: string; onBought: (ids: string[]) => void }) {
  const [ticketOpen, setTicketOpen] = useState(false);
  const items = pantry.useList();
  const [open, setOpen] = useState<string | null>(null);
  const soon = expiringSoon(items, today);
  const current = items.find((i) => i.id === open) ?? null;
  const add = (name: string) => {
    const id = foodId(name);
    const existing = pantry.get(id);
    if (existing) {
      pantry.put(id, { ...existing, level: 'ok' });
      return toast({ message: `${existing.name} : remis « en stock »` });
    }
    pantry.put(id, newPantryItem(name, today));
  };
  const row = (i: (typeof items)[number]) => {
    const exp = i.value.expires ? when(i.value.expires, today) : null;
    return (
      <Row
        key={i.id}
        onClick={() => setOpen(i.id)}
        title={i.value.name}
        subtitle={
          <>
            <span className={i.value.level === 'ok' ? '' : 'text-warning'}>{i.value.qty !== undefined ? `${String(i.value.qty).replace('.', ',')} ${i.value.unit ?? ''}` : LEVEL[i.value.level]}</span>
            {exp && <span className={exp.tone === 'danger' ? ' text-danger' : exp.tone === 'warning' ? ' text-warning' : ''}> · {exp.text}</span>}
            {i.value.staple && ' · indispensable'}
          </>
        }
      />
    );
  };
  return (
    <div className="flex flex-col gap-3">
      <AddFood label="Ajouter au garde-manger" onAdd={add} />
      <Button variant="secondary" icon="upload" onClick={() => setTicketOpen(true)}>
        Importer un ticket de caisse
      </Button>
      <TicketImport open={ticketOpen} onClose={() => setTicketOpen(false)} bought={onBought} />
      {soon.length > 0 && (
        <Reveal>
          <SectionTitle action={<Badge tone="warning">{soon.length}</Badge>}>À finir vite</SectionTitle>
          <Group>{soon.map(row)}</Group>
        </Reveal>
      )}
      {items.length === 0 ? (
        <Card>
          <EmptyState icon="leaf" title="Garde-manger vide" body="Ajoute ce que tu as chez toi, ou coche tes courses : elles y entrent toutes seules." />
        </Card>
      ) : (
        PLACES.map((pl) => {
          const here = items.filter((i) => i.value.place === pl.id && i.value.level !== 'out').sort((a, b) => Number(!isRunningLow(b.value)) - Number(!isRunningLow(a.value)) || a.value.name.localeCompare(b.value.name));
          return here.length ? (
            <Reveal key={pl.id}>
              <SectionTitle action={<span className="t-caption text-muted">{here.length}</span>}>{pl.name}</SectionTitle>
              <Group>{here.map(row)}</Group>
            </Reveal>
          ) : null;
        })
      )}
      {items.some((i) => i.value.level === 'out') && (
        <Reveal>
          <SectionTitle>Finis</SectionTitle>
          <Group>{items.filter((i) => i.value.level === 'out').map(row)}</Group>
        </Reveal>
      )}
      <Sheet open={current !== null} onClose={() => setOpen(null)} title={current?.value.name}>
        {current && <PantryEditor id={current.id} item={current.value} onClose={() => setOpen(null)} />}
      </Sheet>
    </div>
  );
}

export function MyChefPage() {
  const [params, setParams] = useSearchParams();
  const vue = params.get('vue');
  const tab: Tab = vue === 'stock' || vue === 'recettes' || vue === 'semaine' ? vue : 'courses';
  const today = localToday();
  const list = useShoppingList();
  const toBuy = list.items.filter((l) => !l.value.done).length;
  const addToList = (name: string, qty?: number, unit?: string) => {
    const { id, item } = listItemFor(name);
    if (!list.items.some((i) => i.id === id && !i.value.done)) list.put(id, { ...item, ...(qty !== undefined ? { qty, ...(unit ? { unit } : {}) } : {}) });
  };
  const soon = expiringSoon(pantry.useList(), today).length;
  return (
    <Screen stack title="MyChef" kicker="Courses, garde-manger, recettes" mood="today" back="/">
      <div className="flex flex-col gap-3">
        <Segmented
          label="Vue"
          value={tab}
          onChange={(v) => setParams(v === 'courses' ? {} : { vue: v }, { replace: true })}
          options={[
            { value: 'courses', label: toBuy ? `Courses (${toBuy})` : 'Courses' },
            { value: 'stock', label: soon ? `Stock (${soon})` : 'Stock' },
            { value: 'recettes', label: 'Recettes' },
            { value: 'semaine', label: 'Semaine' },
          ]}
        />
        {tab === 'courses' ? <Shopping today={today} /> : tab === 'stock' ? <Pantry today={today} onBought={(ids) => list.items.filter((i) => ids.includes(i.id) && !i.value.done).forEach((i) => list.remove(i.id))} /> : tab === 'recettes' ? <ChefRecipes addToList={addToList} /> : <ChefWeek addToList={addToList} />}
      </div>
    </Screen>
  );
}
