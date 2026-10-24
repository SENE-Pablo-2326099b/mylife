import { useEffect, useMemo, useState } from 'react';
import {
  RECIPE_PROMPT,
  STARTER_RECIPES,
  afterCooking,
  expiringSoon,
  extractJson,
  localToday,
  parseRecipe,
  parseRecipeText,
  rankRecipes,
  scaleRecipe,
  stepTimers,
  weekStart,
  type Availability,
  type Recipe,
} from '../vendor/lumen';
import { cooked, pantry, recipes } from '../myChefData';
import { Icon } from '../ui/icons';
import { Badge, Button, Card, EmptyState, Group, Reveal, Row, SectionTitle, Segmented, Sheet, toast } from '../ui/index';
import { publishStats } from '../ui/stats';

/**
 * MyChef, palier 2 : tes recettes et « qu'est-ce que je fais avec ce que j'ai ? ». Moteur : packages/lumen/src/recipes.ts.
 * `addToList` : ajoute un aliment à la liste de courses active (la tienne ou celle du foyer).
 */
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
const STARTER_IDS = STARTER_RECIPES.map((_, i) => `fournie-${i}`);
const qtyText = (q?: number, unit?: string) => (q === undefined ? '' : `${String(q).replace('.', ',')}${unit ? ` ${unit}` : ''} `);

function statusBadge(a: Availability) {
  if (a.status === 'ready') return <Badge tone="success" icon="check">Tout est là</Badge>;
  if (a.status === 'almost') return <Badge tone="warning">Il manque {a.missing.length}</Badge>;
  return null;
}

/** Les compteurs de MyChef pour le Personnage (Vitalité) : repas faits maison et gaspillage évité, par semaine. */
function useChefStats() {
  const meals = cooked.useList();
  useEffect(() => {
    const weeks: Record<string, Record<string, number>> = {};
    for (const m of meals) {
      const w = (weeks[weekStart(m.value.day)] ??= {});
      w.meals = (w.meals ?? 0) + 1;
      if (m.value.saved) w.saved = (w.saved ?? 0) + 1;
    }
    if (meals.length) publishStats('chef', { weeks });
  }, [meals]);
}

function AddRecipe({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [how, setHow] = useState<'texte' | 'ia'>('texte');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const read = (): Recipe | null => {
    setError(null);
    if (how === 'texte') {
      const r = parseRecipeText(input);
      if (!r.recipe) setError('Je n’ai pas trouvé d’ingrédients : le titre en première ligne, puis une ligne par ingrédient (« 200 g de farine »).');
      return r.recipe;
    }
    try {
      const r = parseRecipe(extractJson(input));
      if (!r) setError('La réponse ne contient pas de recette lisible (titre et ingrédients).');
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  };
  const save = () => {
    const r = read();
    if (!r) return;
    recipes.put(newId(), r);
    toast({ message: `« ${r.title} » ajoutée (${r.ingredients.length} ingrédient${r.ingredients.length > 1 ? 's' : ''})`, tone: 'gold' });
    setInput('');
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Ajouter une recette"
      footer={
        <Button size="lg" className="w-full" disabled={!input.trim()} onClick={save}>
          Ajouter la recette
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented label="Comment" value={how} onChange={setHow} options={[{ value: 'texte', label: 'Coller le texte' }, { value: 'ia', label: 'Avec une IA' }]} />
        {how === 'ia' ? (
          <>
            <p className="t-small text-secondary">Copie la demande, colle-la dans l’IA gratuite de ton choix avec ta recette (texte, photo d’un livre, capture), puis colle sa réponse ici.</p>
            <Button variant="secondary" icon="copy" onClick={() => void navigator.clipboard.writeText(RECIPE_PROMPT).then(() => toast({ message: 'Demande copiée', tone: 'gold' }), () => toast({ message: 'Copie impossible' }))}>
              Copier la demande pour l’IA
            </Button>
          </>
        ) : (
          <p className="t-small text-secondary">Le titre en première ligne, puis les ingrédients (« 200 g de farine », « 3 œufs ») et les étapes. Ce qui n’est pas compris est laissé de côté.</p>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="t-label text-muted">{how === 'ia' ? 'Réponse de l’IA' : 'Ta recette'}</span>
          <textarea className="field-input min-h-[180px]" value={input} onChange={(e) => setInput(e.target.value)} placeholder={how === 'ia' ? '{ "format": "mychef-recipe", … }' : 'Pâtes carbonara\nPour 2 personnes\n200 g de spaghetti\n…'} />
        </label>
        {error && <p className="t-small text-danger">{error}</p>}
      </div>
    </Sheet>
  );
}

/** Le mode cuisine : une étape par écran, gros texte, minuteurs, écran gardé allumé. */
function CookMode({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [timers, setTimers] = useState<{ id: number; end: number; label: string }[]>([]);
  const [, tick] = useState(0);
  const step = recipe.steps[i] ?? '';
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    void (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => undefined);
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      clearInterval(id);
      void lock?.release();
    };
  }, []);
  const now = Date.now();
  useEffect(() => {
    for (const t of timers) {
      if (t.end <= now) {
        navigator.vibrate?.([300, 150, 300]);
        toast({ message: `Minuteur terminé : ${t.label}`, tone: 'gold' });
      }
    }
    setTimers((list) => (list.some((t) => t.end <= now) ? list.filter((t) => t.end > now) : list));
  }, [now, timers]);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <div className="flex flex-col gap-4">
      <p className="t-label text-muted">
        Étape {i + 1} sur {recipe.steps.length}
      </p>
      <p className="t-title leading-snug">{step}</p>
      <div className="flex flex-wrap gap-2">
        {stepTimers(step).map((s, k) => (
          <Button key={k} variant="secondary" icon="time" onClick={() => setTimers((l) => [...l, { id: Date.now() + k, end: Date.now() + s * 1000, label: `${Math.round(s / 60)} min` }])}>
            Minuteur {Math.round(s / 60)} min
          </Button>
        ))}
      </div>
      {timers.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-live="polite">
          {timers.map((t) => (
            <Badge key={t.id} tone="gold" icon="time">
              {fmt(Math.max(0, (t.end - now) / 1000))}
            </Badge>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" icon="chevron-back" disabled={i === 0} onClick={() => setI(i - 1)}>
          Précédente
        </Button>
        {i < recipe.steps.length - 1 ? (
          <Button onClick={() => setI(i + 1)}>Suivante</Button>
        ) : (
          <Button icon="check" onClick={onClose}>
            Terminé
          </Button>
        )}
      </div>
    </div>
  );
}

function RecipeDetail({ id, recipe, availability, mine, addToList, onClose }: { id: string; recipe: Recipe; availability: Availability; mine: boolean; addToList: (name: string) => void; onClose: () => void }) {
  const [servings, setServings] = useState(recipe.servings);
  const [cooking, setCooking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const r = scaleRecipe(recipe, servings);
  const missing = new Set(availability.missing.map((m) => m.name));
  const cookedIt = () => {
    const today = localToday();
    const items = pantry.list();
    const soon = new Set(expiringSoon(items, today).map((i) => i.id));
    const changes = afterCooking(r, items);
    for (const c of changes) pantry.put(c.id, c.value);
    cooked.put(newId(), { v: 1, title: recipe.title, day: today, ...(changes.some((c) => soon.has(c.id)) ? { saved: true } : {}) });
    toast({ message: `Bon appétit ! ${changes.length} aliment${changes.length > 1 ? 's' : ''} mis à jour dans le garde-manger`, tone: 'gold' });
    onClose();
  };
  if (cooking && r.steps.length) return <CookMode recipe={r} onClose={() => setCooking(false)} />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {statusBadge(availability)}
        {recipe.minutes && <span className="t-small text-secondary">{recipe.minutes} min</span>}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" aria-label="Une personne de moins" disabled={servings <= 1} onClick={() => setServings(servings - 1)}>
          −
        </Button>
        <span className="t-small num">{servings} pers.</span>
        <Button size="sm" variant="ghost" aria-label="Une personne de plus" onClick={() => setServings(Math.min(20, servings + 1))}>
          +
        </Button>
      </div>
      <Group>
        {r.ingredients.map((ing, k) => (
          <Row
            key={k}
            title={`${qtyText(ing.qty, ing.unit)}${ing.name}`}
            subtitle={ing.optional ? 'facultatif' : missing.has(ing.name) ? 'à acheter' : undefined}
            right={missing.has(ing.name) ? <Icon name="close" className="text-warning" /> : <Icon name="check" className="text-success" />}
          />
        ))}
      </Group>
      {availability.missing.length > 0 && (
        <Button variant="secondary" icon="add" onClick={() => {
          for (const m of availability.missing) addToList(m.name);
          toast({ message: `${availability.missing.length} ingrédient${availability.missing.length > 1 ? 's' : ''} ajouté${availability.missing.length > 1 ? 's' : ''} à la liste` });
        }}>
          Ajouter les manquants à la liste
        </Button>
      )}
      {r.steps.length > 0 && (
        <>
          <SectionTitle>Étapes</SectionTitle>
          <ol className="t-body list-decimal space-y-2 pl-5 text-secondary">
            {r.steps.map((s, k) => (
              <li key={k}>{s}</li>
            ))}
          </ol>
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" icon="play" disabled={!r.steps.length} onClick={() => setCooking(true)}>
          Mode cuisine
        </Button>
        <Button icon="check" onClick={cookedIt}>
          J’ai cuisiné
        </Button>
      </div>
      {mine && (
        <Button variant="ghost" icon="trash" onClick={() => {
          if (!deleting) return setDeleting(true);
          recipes.remove(id);
          onClose();
        }}>
          {deleting ? 'Confirmer la suppression' : 'Supprimer la recette'}
        </Button>
      )}
    </div>
  );
}

export function ChefRecipes({ addToList }: { addToList: (name: string) => void }) {
  useChefStats();
  const mine = recipes.useList();
  const stock = pantry.useList();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<'possible' | 'toutes'>('possible');
  const today = localToday();
  const all = useMemo(() => [...mine.map((m) => ({ id: m.id, value: m.value, mine: true })), ...STARTER_RECIPES.map((r, k) => ({ id: STARTER_IDS[k]!, value: r, mine: false }))], [mine]);
  const ranked = useMemo(() => rankRecipes(all, stock.map((s) => s.value), expiringSoon(stock, today).map((i) => i.value.name)), [all, stock, today]);
  const shown = filter === 'possible' ? ranked.filter((r) => r.availability.status !== 'no') : ranked;
  const current = ranked.find((r) => r.id === open) ?? null;
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <p className="t-body-strong">Qu’est-ce que je fais avec ce que j’ai ?</p>
        <p className="t-small mt-1 text-secondary">Les recettes faisables avec ton garde-manger d’abord, puis celles à un ou deux ingrédients près ; celles qui sauvent un aliment qui périme passent devant.</p>
        <Button className="mt-3 w-full" variant="secondary" icon="add" onClick={() => setAdding(true)}>
          Ajouter une recette
        </Button>
      </Card>
      <Segmented label="Recettes" value={filter} onChange={setFilter} options={[{ value: 'possible', label: 'Possibles maintenant' }, { value: 'toutes', label: `Toutes (${ranked.length})` }]} />
      {shown.length === 0 ? (
        <Card>
          <EmptyState icon="leaf" title="Rien de faisable pour l’instant" body="Ajoute ce que tu as dans le garde-manger, ou regarde toutes les recettes : MyChef te dit ce qui manque." />
        </Card>
      ) : (
        <Reveal>
          <Group>
            {shown.map((r) => (
              <Row
                key={r.id}
                onClick={() => setOpen(r.id)}
                title={r.value.title}
                subtitle={
                  <>
                    {r.value.minutes ? `${r.value.minutes} min` : ''}
                    {r.availability.status === 'almost' && <span className="text-warning">{r.value.minutes ? ' · ' : ''}il manque {r.availability.missing.map((m) => m.name.toLowerCase()).join(', ')}</span>}
                    {r.availability.usesExpiring > 0 && <span className="text-success"> · sauve ce qui périme</span>}
                    {r.mine ? ' · à toi' : ''}
                  </>
                }
                right={r.availability.status === 'ready' ? <Icon name="check-circle" className="text-success" /> : undefined}
              />
            ))}
          </Group>
        </Reveal>
      )}
      <AddRecipe open={adding} onClose={() => setAdding(false)} />
      <Sheet open={current !== null} onClose={() => setOpen(null)} title={current?.value.title}>
        {current && <RecipeDetail id={current.id} recipe={current.value} availability={current.availability} mine={current.mine} addToList={addToList} onClose={() => setOpen(null)} />}
      </Sheet>
    </div>
  );
}
