import { useEffect, useMemo, useState } from 'react';
import {
  AGENDA_EVENT,
  SLOTS,
  addDaysIso,
  eventsOn,
  expiringSoon,
  localToday,
  mealId,
  proposeWeek,
  rankRecipes,
  readAgenda,
  shoppingForPlan,
  writeAgenda,
  type DayContext,
  type PlannedMeal,
  type Slot,
} from '../vendor/lumen';
import { pantry, plan, recipes, withStarters } from '../myChefData';
import { Icon } from '../ui/icons';
import { Button, Card, Group, Row, SectionTitle, Segmented, Sheet, toast } from '../ui/index';
import { RecipeDetail } from './ChefRecipes';

/**
 * MyChef, palier 3 : la semaine. Les sept prochains jours, midi et soir ; une proposition automatique (ce qui périme
 * d'abord, des restes, pas de dîner un soir de sortie, protéiné un jour de séance) ; les courses qui en découlent.
 * Moteur : packages/lumen/src/mealplan.ts. Les repas prévus vont dans l'agenda commun (« Ta journée »).
 */
const SLOT_NAME: Record<Slot, string> = { midi: 'Midi', soir: 'Soir' };
const SLOTS_KEY = 'mylife:app:chef:slots';
const dayName = (iso: string, today: string) => (iso === today ? 'Aujourd’hui' : iso === addDaysIso(today, 1) ? 'Demain' : new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' }));

export function ChefWeek({ addToList }: { addToList: (name: string, qty?: number, unit?: string) => void }) {
  const today = localToday();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysIso(today, i)), [today]);
  const meals = plan.useList();
  const mine = recipes.useList();
  const stock = pantry.useList();
  const all = useMemo(() => withStarters(mine), [mine]);
  const [both, setBoth] = useState(() => {
    try {
      return localStorage.getItem(SLOTS_KEY) === 'both';
    } catch {
      return false;
    }
  });
  const [cell, setCell] = useState<{ day: string; slot: Slot } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const slots: Slot[] = both ? ['midi', 'soir'] : ['soir'];
  // L'agenda commun peut arriver après l'ouverture (sorties téléchargées par l'accueil) : on le relit quand il change.
  const [agendaTick, setAgendaTick] = useState(0);
  useEffect(() => {
    const bump = () => setAgendaTick((n) => n + 1);
    window.addEventListener(AGENDA_EVENT, bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener(AGENDA_EVENT, bump);
      window.removeEventListener('storage', bump);
    };
  }, []);
  // Ce que dit l'agenda commun : une sortie ce soir-là, une séance ce jour-là.
  const context = useMemo(() => {
    const v = readAgenda(today, days[6]!, today);
    const ctx: Record<string, DayContext> = {};
    for (const d of days) {
      const ev = eventsOn(v.events, d);
      const out = ev.find((e) => e.kind === 'sortie');
      ctx[d] = { ...(out ? { outTonight: out.title } : {}), ...(ev.some((e) => e.kind === 'session') ? { training: true } : {}) };
    }
    return ctx;
  }, [today, days, agendaTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(meals.map((m) => [m.id, m.value]));
  // Les repas prévus dans l'agenda commun (« Ta journée » : « Ce soir : poulet au curry »).
  useEffect(() => {
    writeAgenda(
      'chef',
      today,
      meals.filter((m) => m.value.day >= today).map((m) => ({ id: m.id, kind: 'meal' as const, title: `${SLOT_NAME[m.value.slot]} : ${m.value.title}`, date: m.value.day, time: m.value.slot === 'midi' ? '12:30' : '19:30', url: '/chef?vue=semaine' })),
    );
  }, [meals, today]);

  const propose = () => {
    const planned = meals.filter((m) => days.includes(m.value.day)).map((m) => m.value);
    const added = proposeWeek({ days, planned, recipes: all, pantry: stock.map((s) => s.value), expiring: expiringSoon(stock, today).map((i) => i.value.name), context, slots });
    for (const m of added) plan.put(mealId(m.day, m.slot), m);
    toast({ message: added.length ? `${added.length} repas proposé${added.length > 1 ? 's' : ''} : change ce qui ne te va pas` : 'Ta semaine est déjà remplie', tone: 'gold' });
  };
  const shop = () => {
    const week = meals.filter((m) => days.includes(m.value.day)).map((m) => m.value);
    const need = shoppingForPlan(week, all, stock.map((s) => s.value), []);
    for (const n of need) addToList(n.name, n.qty, n.unit);
    toast({ message: need.length ? `${need.length} ingrédient${need.length > 1 ? 's' : ''} ajouté${need.length > 1 ? 's' : ''} à la liste` : 'Tu as déjà tout ce qu’il faut', tone: 'gold' });
  };
  const ranked = useMemo(() => rankRecipes(all, stock.map((s) => s.value), expiringSoon(stock, today).map((i) => i.value.name)), [all, stock, today]);
  const choose = (recipeId: string | null) => {
    if (!cell) return;
    const id = mealId(cell.day, cell.slot);
    if (!recipeId) plan.remove(id);
    else {
      const r = all.find((x) => x.id === recipeId)!;
      plan.put(id, { v: 1, day: cell.day, slot: cell.slot, recipeId, title: r.value.title, servings: 2 } satisfies PlannedMeal);
    }
    setCell(null);
  };
  const viewed = viewing ? ranked.find((r) => r.id === viewing) : null;

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <Segmented label="Repas à prévoir" value={both ? 'both' : 'soir'} onChange={(v) => {
          setBoth(v === 'both');
          try {
            localStorage.setItem(SLOTS_KEY, v);
          } catch {
            /* stockage indisponible */
          }
        }} options={[{ value: 'soir', label: 'Les soirs' }, { value: 'both', label: 'Midis et soirs' }]} />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button icon="sparkles" onClick={propose}>
            Proposer ma semaine
          </Button>
          <Button variant="secondary" icon="add" onClick={shop}>
            Les courses
          </Button>
        </div>
        <p className="t-caption mt-2 text-muted">La proposition utilise d’abord ce qui périme, prévoit des restes, saute les soirs de sortie et pense protéines les jours de séance.</p>
      </Card>
      {days.map((d) => (
        <div key={d}>
          <SectionTitle action={context[d]?.outTonight ? <span className="t-caption text-gold">Sortie : {context[d]!.outTonight}</span> : context[d]?.training ? <span className="t-caption text-secondary">Séance</span> : undefined}>{dayName(d, today)}</SectionTitle>
          <Group>
            {SLOTS.filter((s) => slots.includes(s) || byId.has(mealId(d, s))).map((s) => {
              const m = byId.get(mealId(d, s));
              return (
                <Row
                  key={s}
                  onClick={() => (m?.recipeId ? setViewing(m.recipeId) : setCell({ day: d, slot: s }))}
                  title={m ? m.title : <span className="text-muted">{s === 'soir' && context[d]?.outTonight ? 'Dehors ce soir' : 'Rien de prévu'}</span>}
                  subtitle={SLOT_NAME[s] + (m?.leftover ? ' · restes, rien à cuisiner' : '')}
                  right={
                    <button type="button" className="flex h-9 w-9 items-center justify-center text-muted" aria-label={`Changer le repas : ${dayName(d, today)}, ${SLOT_NAME[s].toLowerCase()}`} onClick={(e) => (e.stopPropagation(), setCell({ day: d, slot: s }))}>
                      <Icon name={m ? 'options' : 'add'} size={18} />
                    </button>
                  }
                />
              );
            })}
          </Group>
        </div>
      ))}
      <Sheet open={cell !== null} onClose={() => setCell(null)} title={cell ? `${dayName(cell.day, today)}, ${SLOT_NAME[cell.slot].toLowerCase()}` : undefined}>
        <div className="flex flex-col gap-2">
          {cell && byId.has(mealId(cell.day, cell.slot)) && (
            <Button variant="ghost" icon="trash" onClick={() => choose(null)}>
              Ne rien prévoir
            </Button>
          )}
          <Group>
            {ranked.slice(0, 30).map((r) => (
              <Row key={r.id} onClick={() => choose(r.id)} title={r.value.title} subtitle={r.availability.status === 'ready' ? 'Tout est là' : `il manque ${r.availability.missing.length}`} right={r.availability.usesExpiring > 0 ? <span className="t-caption text-success">sauve ce qui périme</span> : undefined} />
            ))}
          </Group>
        </div>
      </Sheet>
      <Sheet open={viewed != null} onClose={() => setViewing(null)} title={viewed?.value.title}>
        {viewed && <RecipeDetail id={viewed.id} recipe={viewed.value} availability={viewed.availability} mine={false} addToList={(n) => addToList(n)} onClose={() => setViewing(null)} />}
      </Sheet>
    </div>
  );
}
