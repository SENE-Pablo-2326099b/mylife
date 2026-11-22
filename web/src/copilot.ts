import type Anthropic from '@anthropic-ai/sdk';
import { parseActionSpec, readAgenda, type ActionSpec } from './vendor/lumen';

/**
 * Copilot : l'IA de l'accueil MyLife, qui voit toutes les apps (avec la clé de l'utilisateur, depuis son
 * appareil, comme l'assistant de MyFinances et le coach de MyPerf). Il lit des résumés (fiches de contexte de
 * MyFinances et MyPerf, agenda commun, sorties) et propose ; il peut préparer des actions
 * (`propose_action`) que l'utilisateur valide, exécutées ensuite par l'app concernée (actions.ts de lumen) : il ne
 * modifie jamais rien lui-même. Ce module n'a pas d'interface : les sources de données lui sont fournies.
 */

export const COPILOT_MODEL = 'claude-opus-5-5';
const MAX_STEPS = 8;

export type Msg = Anthropic.Beta.BetaMessageParam;
export type CreateMessage = (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;

/** Une sortie, résumée pour Copilot (déjà déchiffrée sur l'appareil). */
export interface SortieDigest {
  id: string;
  name: string;
  place: string;
  start: string;
  end: string;
  decided: boolean;
  chaud: number;
  myAnswer: string | null;
  sets: { day: string; start: string; end: string; stage: string; artist: string; goers: string[] }[];
  /** Ce que je dois (négatif) ou ce qu'on me doit (positif), en euros. */
  myBalance: number;
  totalSpent: number;
  itemsLeft: string[];
}

export interface CopilotSources {
  today: string;
  finances: Record<string, unknown> | null;
  perf: Record<string, unknown> | null;
  sorties: SortieDigest[];
}

export const COPILOT_SYSTEM = `Tu es Copilot, l'assistant de MyLife : une app qui réunit le budget (MyFinances), la musculation (MyPerf) et les sorties entre amis (Sorties, MyRave).

Ce que tu fais :
- Tu réponds aux questions de l'utilisateur sur sa vie à partir de SES données, que tu lis avec tes outils. Lis avant de répondre : ne devine jamais un chiffre.
- Tu croises les apps : un achat face au budget et à l'épargne, une semaine d'entraînement face à une sortie prévue.
- Tu proposes, tu ne fais rien seul. Pour quelques gestes, tu peux préparer une **action** avec l'outil propose_action : sauter un récurrent ce mois (MyFinances), décaler une séance prévue (MyPerf). L'action s'affiche comme une carte que l'utilisateur valide ou refuse ; elle n'est faite qu'après sa validation, par l'app concernée. Ne dis jamais qu'une action est faite : dis qu'elle attend sa validation. Prends les identifiants dans tes lectures (recurring de get_finances, planned de get_training), n'en invente jamais. Une action par geste, seulement si l'utilisateur le demande ou si c'est la suite évidente de sa question. Pour le reste, dis précisément où le faire (« dans MyFinances, Réglages → … »).

Règles :
- Réponds en français, tutoie, sois concret et bref : quelques phrases ou une courte liste. Les montants en euros, les dates en clair.
- Si une donnée manque (fiche absente ou ancienne, app jamais ouverte), dis-le et indique quelle app ouvrir pour la mettre à jour.
- Budget : le « reste à dépenser aujourd'hui » et le budget par jour sont des repères de vie courante ; l'épargne prévue n'est pas de l'argent à dépenser. Ne pousse jamais à s'endetter.
- Entraînement : prudence avec la santé ; pas de diagnostic médical. Pour alléger avant un événement, raisonne en séries et en charge, pas en conseils généraux.
- Les données d'autres personnes (membres d'une sortie) sont des pseudos : n'en déduis rien d'autre.`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  { name: 'get_overview', description: 'Vue d’ensemble : date, quelles apps ont une fiche et de quand elle date, nombre de sorties.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_finances', description: 'Fiche MyFinances (en euros) : reste à dépenser aujourd’hui, budget du jour, cycle de paie (dates, jours restants), enveloppe, dépensé, projection de fin de cycle, épargne prévue, argent réellement libre, prochaines sorties d’argent.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_training', description: 'Fiche MyPerf : objectif de séances par semaine, séances faites cette semaine, séances prévues (21 jours), cycle en cours (semaine, deload), dernières séances, records, mouvements principaux (e1RM), mouvements qui stagnent.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_agenda', description: 'Agenda commun des apps sur les N prochains jours (1 à 35, 7 par défaut) : séances prévues (MyPerf), paie, prélèvements et investissements (MyFinances, montants en euros), sorties ; et le jour où chaque app a été ouverte (stale : à rouvrir).', input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 35 } }, additionalProperties: false } },
  {
    name: 'propose_action',
    description:
      'Prépare une action que l’utilisateur validera (elle n’est faite qu’après sa validation, par l’app concernée). kind : finances.skipRecurring (params : itemId de get_finances → recurring, skip true pour sauter ce mois / false pour l’attendre de nouveau) ; perf.movePlanned (params : plannedId de get_training → planned, date AAAA-MM-JJ). summary : la phrase montrée à l’utilisateur, au tutoiement (« Sauter le plan Bitcoin ce mois »).',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['finances.skipRecurring', 'perf.movePlanned'] },
        params: { type: 'object' },
        summary: { type: 'string' },
      },
      required: ['kind', 'params', 'summary'],
      additionalProperties: false,
    },
  },
  { name: 'list_sorties', description: 'Les sorties (festivals, week-ends) de l’utilisateur : dates, lieu, décision (« ça se fait »), sa réponse, planning des sets avec qui y va, budget partagé (son solde), choses à emporter restantes.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
];

const age = (card: Record<string, unknown> | null, today: string) => (card && typeof card.day === 'string' ? (card.day === today ? 'aujourd’hui' : `du ${card.day}`) : null);

/** Exécute un outil ; renvoie du JSON (ou une explication) à donner à Claude. */
export function runTool(name: string, input: Record<string, unknown>, src: CopilotSources): { content: string; isError?: boolean } {
  const json = (v: unknown) => ({ content: JSON.stringify(v) });
  switch (name) {
    case 'get_overview':
      return json({ today: src.today, cards: { finances: age(src.finances, src.today), training: age(src.perf, src.today) }, sorties: src.sorties.length });
    case 'get_finances':
      return src.finances ? json(src.finances) : { content: 'Pas de fiche MyFinances sur cet appareil : ouvre MyFinances (écran Aujourd’hui) une fois.', isError: true };
    case 'get_training':
      return src.perf ? json(src.perf) : { content: 'Pas de fiche MyPerf sur cet appareil : ouvre MyPerf une fois (sur ce navigateur).', isError: true };
    case 'list_sorties':
      return json(src.sorties);
    case 'get_agenda': {
      const days = Math.max(1, Math.min(35, typeof input.days === 'number' ? Math.round(input.days) : 7));
      const to = new Date(`${src.today}T12:00:00`);
      to.setDate(to.getDate() + days - 1);
      const v = readAgenda(src.today, to.toISOString().slice(0, 10), src.today);
      return json({ from: src.today, days, events: v.events.map((e) => ({ date: e.date, end: e.end, time: e.time, kind: e.kind, title: e.title, app: e.app, euros: e.amount === undefined ? undefined : e.amount / 100 })), appsLastOpened: v.sources, stale: v.stale });
    }
    case 'propose_action': {
      const parsed = parseActionSpec(input);
      if (!parsed.action) return { content: parsed.error, isError: true };
      return { content: 'Proposition affichée à l’utilisateur : elle attend sa validation (rien n’est encore fait).' };
    }
    default:
      return { content: `Outil inconnu : ${name}`, isError: true };
  }
}

function markCached(m: Msg): Msg {
  if (typeof m.content === 'string') return { ...m, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] };
  const content = [...m.content];
  const last = content[content.length - 1];
  if (last && last.type !== 'thinking' && last.type !== 'redacted_thinking') content[content.length - 1] = { ...last, cache_control: { type: 'ephemeral' } } as typeof last;
  return { ...m, content };
}

/** `model` : celui choisi par l'utilisateur (Opus 5.5 par défaut, ou Sonnet 5.5). */
export function requestParams(messages: readonly Msg[], model: string = COPILOT_MODEL): Anthropic.Beta.MessageCreateParamsNonStreaming {
  // Trois marqueurs de cache : système, outils, dernier message (la conversation se relit du cache).
  const tools = TOOLS.map((t, i) => (i === TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t));
  const last = messages[messages.length - 1];
  return {
    model,
    max_tokens: 16000,
    system: [{ type: 'text', text: COPILOT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools,
    messages: last === undefined ? [...messages] : [...messages.slice(0, -1), markCached(last)],
    // Réflexion adaptative (par défaut sur Opus 5.5 comme sur Sonnet 5.5) ; effort explicite.
    output_config: { effort: 'medium' },
    // Si un filtre de sécurité décline la demande, l'API la relance sur un modèle de repli.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
}

/** Message de l'utilisateur, avec la date du jour à part (hors du préfixe mis en cache). */
export function userMessage(text: string, today: string): Msg {
  return { role: 'user', content: [{ type: 'text', text }, { type: 'text', text: `<contexte>Date du jour : ${today}</contexte>` }] };
}

export interface TurnResult {
  messages: Msg[];
  /** Outils lus pendant ce tour (pour l'afficher). */
  read: string[];
  note: string | null;
  /** Actions préparées pendant ce tour, à valider par l'utilisateur (identifiant = celui de l'appel d'outil). */
  proposals: { id: string; action: ActionSpec }[];
}

/** Fait tourner Claude jusqu'à la fin de son tour (lectures comprises). `messages` finit par l'utilisateur. */
export async function advance(messages: readonly Msg[], create: CreateMessage, sources: () => CopilotSources, model: string = COPILOT_MODEL): Promise<TurnResult> {
  const history = [...messages];
  const read: string[] = [];
  const proposals: TurnResult['proposals'] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await create(requestParams(history, model));
    history.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'refusal') return { messages: history, read, note: 'Cette demande a été déclinée par les filtres de sécurité.', proposals };
    if (response.stop_reason === 'max_tokens') return { messages: history, read, note: 'Réponse coupée (trop longue) : demande plus court.', proposals };
    if (response.stop_reason === 'pause_turn') continue;
    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || uses.length === 0) return { messages: history, read, note: null, proposals };
    const src = sources();
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = uses.map((u) => {
      read.push(u.name);
      const input = typeof u.input === 'object' && u.input !== null && !Array.isArray(u.input) ? (u.input as Record<string, unknown>) : {};
      const r = runTool(u.name, input, src);
      if (u.name === 'propose_action' && !r.isError) proposals.push({ id: u.id, action: parseActionSpec(input).action! });
      return { type: 'tool_result', tool_use_id: u.id, content: r.content, ...(r.isError ? { is_error: true } : {}) };
    });
    history.push({ role: 'user', content: results });
  }
  return { messages: history, read, note: 'Trop d’étapes pour une seule réponse : reformule ta question.', proposals };
}

/** Le texte à afficher d'un message de Claude. */
export function textOf(m: Msg): string {
  if (typeof m.content === 'string') return m.content;
  return m.content
    .filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
    .trim();
}
