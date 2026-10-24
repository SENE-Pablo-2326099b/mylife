import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PLACES,
  byAisle,
  daysUntil,
  expiringSoon,
  findFood,
  foodId,
  isRunningLow,
  localToday,
  newPantryItem,
  staplesToBuy,
  stockAfterPurchase,
  suggestFoods,
  type Level,
  type PantryItem,
  type Place,
} from '../vendor/lumen';
import { pantry, shopping } from '../myChefData';
import { Icon } from '../ui/icons';
import { Badge, Button, Card, Chip, EmptyState, Group, Reveal, Row, SectionTitle, Segmented, SelectField, Sheet, TextField, ToggleRow, toast } from '../ui/index';
import { Screen } from '../ui/Screen';

/**
 * MyChef (V4, 3.4), palier 1 : la liste de courses et le garde-manger. Les indispensables bientôt finis reviennent seuls
 * sur la liste ; un article coché en magasin entre dans le stock. Moteur : packages/lumen/src/chef.ts.
 */
type Tab = 'courses' | 'stock';
const LEVEL: Record<Level, string> = { ok: 'En stock', low: 'Bientôt fini', out: 'Fini' };

function when(expires: string, today: string): { text: string; tone: 'danger' | 'warning' | 'muted' } {
  const d = daysUntil(expires, today);
  if (d < 0) return { text: 'périmé', tone: 'danger' };
  if (d === 0) return { text: 'aujourd’hui', tone: 'warning' };
  if (d === 1) return { text: 'demain', tone: 'warning' };
  if (d <= 3) return { text: `dans ${d} jours`, tone: 'warning' };
  return { text: `jusqu’au ${new Date(`${expires}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`, tone: 'muted' };
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
  const list = shopping.useList();
  const stock = pantry.useList();
  const groups = byAisle(list);
  const done = list.filter((l) => l.value.done);
  // Les indispensables bientôt finis passent tout seuls sur la liste.
  useEffect(() => {
    for (const p of staplesToBuy(stock, list)) shopping.put(foodId(p.value.name), { v: 1, name: p.value.name, aisle: p.value.aisle, auto: true });
  }, [stock, list]);
  const add = (name: string) => {
    const id = foodId(name);
    const existing = shopping.get(id);
    if (existing && !existing.done) return toast({ message: `${existing.name} est déjà sur la liste` });
    const food = findFood(name);
    shopping.put(id, { v: 1, name: food?.name ?? name, aisle: food?.aisle ?? 'autre' });
  };
  const toggle = (id: string) => {
    const item = shopping.get(id);
    if (!item) return;
    shopping.put(id, { ...item, done: !item.done });
    // Coché = acheté : il entre dans le garde-manger.
    if (!item.done) pantry.put(id, stockAfterPurchase(pantry.get(id), item, today));
  };
  return (
    <div className="flex flex-col gap-3">
      <AddFood label="Ajouter à la liste" onAdd={add} />
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
            for (const d of done) shopping.remove(d.id);
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

function Pantry({ today }: { today: string }) {
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
  const tab: Tab = params.get('vue') === 'stock' ? 'stock' : 'courses';
  const today = localToday();
  const toBuy = shopping.useList().filter((l) => !l.value.done).length;
  const soon = expiringSoon(pantry.useList(), today).length;
  return (
    <Screen stack title="MyChef" kicker="Courses et garde-manger" mood="today" back="/">
      <div className="flex flex-col gap-3">
        <Segmented
          label="Vue"
          value={tab}
          onChange={(v) => setParams(v === 'stock' ? { vue: 'stock' } : {}, { replace: true })}
          options={[
            { value: 'courses', label: toBuy ? `Courses (${toBuy})` : 'Courses' },
            { value: 'stock', label: soon ? `Garde-manger (${soon} à finir)` : 'Garde-manger' },
          ]}
        />
        {tab === 'courses' ? <Shopping today={today} /> : <Pantry today={today} />}
      </div>
    </Screen>
  );
}
