import { defineCollection, syncCollections } from '@legacy/ui/collectionSync';
import type { Msg } from '@legacy/copilot';

/**
 * Les conversations de Copilot : une ligne par conversation, synchronisée entre les appareils du compte et chiffrée de
 * bout en bout (collection `copilot/conversations`, app de synchro `copilot`). La clé d'API, elle, ne quitte jamais
 * l'appareil. Chaque conversation a un domaine (Finances, Sport, MyRave, Général…) qui oriente ce que Copilot lit
 * d'abord, sans l'empêcher de croiser les modules quand c'est utile.
 */
export type Domain = 'general' | 'finances' | 'sport' | 'rave';

export interface DomainSpec {
  id: Domain;
  label: string;
  /** Ce que Copilot reçoit avec chaque question de ce domaine (hors du préfixe mis en cache). */
  hint: string;
  suggestions: string[];
}

/** Les domaines : en ajouter un, c'est ajouter une ligne ici. */
export const DOMAINS: readonly DomainSpec[] = [
  { id: 'general', label: 'Général', hint: 'Conversation générale : lis ce qui est utile à la question, tous modules confondus.', suggestions: ['Résume ma semaine.', 'Qu’est-ce qui m’attend cette semaine ?', 'Quelle semaine alléger avant ma prochaine sortie ?'] },
  { id: 'finances', label: 'Finances', hint: 'Conversation sur les finances : lis d’abord le budget (get_finances) ; croise avec l’entraînement, l’agenda ou les sorties seulement si la question l’appelle.', suggestions: ['Je peux me payer un billet à 80 € ce mois-ci ?', 'Est-ce que je tiens mon budget ce cycle ?', 'Quelles dépenses ont le plus pesé ce mois-ci ?'] },
  { id: 'sport', label: 'Sport', hint: 'Conversation sur l’entraînement : lis d’abord les séances (get_training) ; croise avec l’agenda ou les sorties seulement si la question l’appelle.', suggestions: ['Comment se passe mon programme ?', 'Quelle séance faire aujourd’hui ?', 'Je progresse au développé couché ?'] },
  { id: 'rave', label: 'MyRave', hint: 'Conversation sur les sorties : lis d’abord les sorties (list_sorties) et l’agenda ; croise avec le budget ou l’entraînement seulement si la question l’appelle.', suggestions: ['Quelle est ma prochaine sortie ?', 'Combien m’a coûté ma dernière sortie ?', 'Je peux faire ma séance avant la sortie de samedi ?'] },
];
export const domainOf = (id: string | null | undefined): DomainSpec => DOMAINS.find((d) => d.id === id) ?? DOMAINS[0]!;

export interface Conversation {
  title: string;
  domain: Domain;
  messages: Msg[];
  createdAt: number;
  updatedAt: number;
}

const MAX_BYTES = 150_000;

function parse(raw: unknown): Conversation | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<Conversation>;
  if (typeof c.title !== 'string' || !Array.isArray(c.messages) || typeof c.createdAt !== 'number') return null;
  return { title: c.title.slice(0, 120), domain: domainOf(c.domain).id, messages: c.messages as Msg[], createdAt: c.createdAt, updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : c.createdAt };
}

export const conversations = defineCollection<Conversation>({ app: 'copilot', name: 'conversations', parse, max: 300 });

const isUserText = (m: Msg) => m.role === 'user' && typeof m.content !== 'string' && (m.content as { type: string }[])[0]?.type === 'text';

/**
 * Ce qui est gardé d'une conversation : sans la réflexion des tours passés (l'API n'en a pas besoin pour la suite),
 * et sous une taille raisonnable (les plus anciens échanges partent d'abord, en recommençant par une question).
 */
export function compact(messages: readonly Msg[]): Msg[] {
  let out = messages.map((m) => (m.role === 'assistant' && typeof m.content !== 'string' ? { ...m, content: m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking') } : m)).filter((m) => typeof m.content === 'string' || m.content.length > 0);
  while (out.length > 2 && JSON.stringify(out).length > MAX_BYTES) {
    let start = 1;
    while (start < out.length && !isUserText(out[start]!)) start++;
    if (start >= out.length) break;
    out = out.slice(start);
  }
  return out;
}

/** Un titre : le début de la première question. */
export function titleOf(question: string): string {
  const t = question.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57).trimEnd()}…` : t || 'Nouvelle conversation';
}

export const newConversationId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** La conversation d'avant (une seule, gardée sur l'appareil) devient la première de l'historique, une fois. */
export function adoptOldHistory(key = 'mylife:copilot:history'): void {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const messages = JSON.parse(raw) as Msg[];
    localStorage.removeItem(key);
    const first = messages.find(isUserText);
    if (!first || typeof first.content === 'string') return;
    const text = (first.content[0] as { text?: string }).text ?? '';
    const now = Date.now();
    conversations.put(newConversationId(), { title: titleOf(text), domain: 'general', messages: compact(messages), createdAt: now, updatedAt: now });
  } catch {
    /* illisible : laissée de côté */
  }
}

export const syncConversations = () => syncCollections();
