import { useState } from 'react';
import { TICKET_PROMPT, extractJson, foodId, localToday, parseTicket, parseTicketText, pricesFromTicket, stockAfterPurchase, ticketAisle, type Ticket } from '../vendor/lumen';
import { pantry, prices } from '../myChefData';
import { Button, Group, Row, Segmented, Sheet, toast } from '../ui/index';
import { formatCents } from '../ui/money';
import { Icon } from '../ui/icons';

/**
 * MyChef, palier 4 : le ticket de caisse → le garde-manger, après un aperçu. Les prix sont retenus (coût estimé de la
 * liste). `bought` : ce qui a été acheté, pour le retirer de la liste de courses.
 */
export function TicketImport({ open, onClose, bought }: { open: boolean; onClose: () => void; bought: (ids: string[]) => void }) {
  const [how, setHow] = useState<'texte' | 'ia'>('texte');
  const [input, setInput] = useState('');
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const read = () => {
    setError(null);
    try {
      const t = how === 'texte' ? parseTicketText(input) : parseTicket(extractJson(input));
      if (!t || !t.lines.length) return setError(how === 'texte' ? 'Aucun article lu : une ligne par article, le prix à la fin (« LAIT 1L 0,99 »).' : 'La réponse ne contient pas d’articles lisibles.');
      setTicket(t);
      setSkip(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const save = () => {
    if (!ticket) return;
    const today = localToday();
    const kept = { ...ticket, lines: ticket.lines.filter((_, i) => !skip.has(i)) };
    const ids: string[] = [];
    for (const l of kept.lines) {
      const id = foodId(l.name);
      ids.push(id);
      pantry.put(id, stockAfterPurchase(pantry.get(id), { v: 1, name: l.name, aisle: ticketAisle(l.name), ...(l.qty !== undefined ? { qty: l.qty } : {}) }, today));
    }
    for (const p of pricesFromTicket(kept, today)) prices.put(p.id, p.value);
    bought(ids);
    toast({ message: `${kept.lines.length} article${kept.lines.length > 1 ? 's' : ''} rangé${kept.lines.length > 1 ? 's' : ''} dans le garde-manger, prix retenus`, tone: 'gold' });
    setTicket(null);
    setInput('');
    onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Importer un ticket"
      footer={
        ticket ? (
          <Button size="lg" className="w-full" onClick={save}>
            Ranger {ticket.lines.length - skip.size} article{ticket.lines.length - skip.size > 1 ? 's' : ''}
          </Button>
        ) : (
          <Button size="lg" className="w-full" disabled={!input.trim()} onClick={read}>
            Lire le ticket
          </Button>
        )
      }
    >
      {ticket ? (
        <div className="flex flex-col gap-2">
          <p className="t-small text-secondary">Décoche ce qui n’est pas à ranger (un cadeau, un article mal lu).</p>
          <Group>
            {ticket.lines.map((l, i) => (
              <Row
                key={i}
                onClick={() => setSkip((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])))}
                title={<span className={skip.has(i) ? 'text-muted line-through' : ''}>{l.qty ? `${l.qty} × ` : ''}{l.name}</span>}
                subtitle={l.price !== undefined ? formatCents(l.price) : undefined}
                right={<span role="checkbox" aria-checked={!skip.has(i)} aria-label={`Ranger ${l.name}`}>{!skip.has(i) && <Icon name="check" className="text-success" />}</span>}
              />
            ))}
          </Group>
          <Button variant="ghost" onClick={() => setTicket(null)}>
            Recommencer
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Segmented label="Comment" value={how} onChange={setHow} options={[{ value: 'texte', label: 'Coller le texte' }, { value: 'ia', label: 'Photo avec une IA' }]} />
          {how === 'ia' ? (
            <>
              <p className="t-small text-secondary">Copie la demande, colle-la dans l’IA gratuite de ton choix avec la photo du ticket, puis colle sa réponse ici.</p>
              <Button variant="secondary" icon="copy" onClick={() => void navigator.clipboard.writeText(TICKET_PROMPT).then(() => toast({ message: 'Demande copiée', tone: 'gold' }), () => toast({ message: 'Copie impossible' }))}>
                Copier la demande pour l’IA
              </Button>
            </>
          ) : (
            <p className="t-small text-secondary">Colle le texte du ticket (ticket dématérialisé, e-mail du drive) : une ligne par article, le prix à la fin.</p>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="t-label text-muted">{how === 'ia' ? 'Réponse de l’IA' : 'Texte du ticket'}</span>
            <textarea className="field-input min-h-[160px]" value={input} onChange={(e) => setInput(e.target.value)} placeholder={how === 'ia' ? '{ "items": [ … ] }' : 'LAIT DEMI ECR 1L   0,99\nPATES PENNE 500G   1,15'} />
          </label>
          {error && <p className="t-small text-danger">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}
