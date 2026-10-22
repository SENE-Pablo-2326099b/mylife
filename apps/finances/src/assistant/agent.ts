/**
 * Boucle de l'assistant (API Claude, boucle d'outils manuelle). Les outils de lecture s'exécutent
 * aussitôt ; les outils d'écriture mettent la boucle en pause jusqu'à ce que l'utilisateur valide ou
 * refuse chaque changement proposé. L'historique ne fait que s'allonger : les tours de l'assistant
 * sont gardés exactement tels que renvoyés (blocs de réflexion compris), ce que l'API exige pour
 * conserver son raisonnement d'un tour à l'autre.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { ASSISTANT_SYSTEM } from './prompt';
import { ASSISTANT_TOOLS, prepareChange, runReadTool, ToolInputError, WRITE_TOOL_NAMES, type AssistantChange, type AssistantContext } from './tools';

/**
 * Modèles : Claude Opus 5.5 par défaut (analyse la plus fiable de tes données), Claude Sonnet 5.5
 * pour des réponses plus rapides et environ deux fois moins chères.
 */
export const ASSISTANT_MODELS = {
  deep: 'claude-opus-5-5',
  fast: 'claude-sonnet-5-5',
} as const;
export type AssistantMode = keyof typeof ASSISTANT_MODELS;
const MAX_STEPS = 16;

export type Msg = Anthropic.Beta.BetaMessageParam;
export type CreateMessage = (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;

export interface ProposedChange extends Omit<AssistantChange, 'apply'> {
  toolUseId: string;
  apply: () => Promise<string>;
}

/** Un tour en attente de l'utilisateur : résultats des lectures déjà faites et changements à décider. */
export interface PendingApproval {
  ready: Anthropic.Beta.BetaToolResultBlockParam[];
  changes: ProposedChange[];
}

export type TurnOutcome = { kind: 'done'; messages: Msg[]; notice: string | null } | { kind: 'approval'; messages: Msg[]; pending: PendingApproval };

/** Blocs qui acceptent un marqueur de cache (pas les blocs de réflexion). */
const CACHEABLE_BLOCKS = new Set(['text', 'tool_use', 'tool_result', 'image', 'document']);

/** Marque la fin d'un morceau mis en cache sur le dernier bloc d'un message. */
function markCached(message: Msg): Msg {
  if (typeof message.content === 'string') return { ...message, content: [{ type: 'text', text: message.content, cache_control: { type: 'ephemeral' } }] };
  const content = [...message.content];
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i];
    if (b !== undefined && CACHEABLE_BLOCKS.has(b.type)) {
      content[i] = { ...b, cache_control: { type: 'ephemeral' } } as typeof b;
      return { ...message, content };
    }
  }
  return message;
}

export function requestParams(messages: Msg[], mode: AssistantMode = 'deep'): Anthropic.Beta.MessageCreateParamsNonStreaming {
  // Trois marqueurs de cache : système, outils, dernier message. Au tour suivant, le précédent
  // « dernier » est encore dans le préfixe gardé par le serveur : la conversation se relit du cache.
  const tools = ASSISTANT_TOOLS.map((t, i) => (i === ASSISTANT_TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t));
  const last = messages[messages.length - 1];
  const cachedMessages = last === undefined ? messages : [...messages.slice(0, -1), markCached(last)];
  return {
    model: ASSISTANT_MODELS[mode],
    max_tokens: 16000,
    system: [{ type: 'text', text: ASSISTANT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools,
    messages: cachedMessages,
    // Réflexion adaptative (toujours active sur ces modèles) ; effort explicite.
    output_config: { effort: 'medium' },
    // Si un filtre de sécurité décline la demande, l'API la relance sur un modèle de repli.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
}

const textResult = (toolUseId: string, content: string, isError = false): Anthropic.Beta.BetaToolResultBlockParam => ({
  type: 'tool_result',
  tool_use_id: toolUseId,
  content,
  ...(isError ? { is_error: true } : {}),
});

/** Message de l'utilisateur : le texte tapé et, à part, le contexte du tour (date du jour). */
export function userMessage(text: string, today: string): Msg {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'text', text: `<contexte>Date du jour : ${today}</contexte>` },
    ],
  };
}

/** Entrée d'un outil sous forme d'objet simple (le SDK la type en unknown). */
export function toolInput(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input));
}

/**
 * Appelle Claude jusqu'à la fin de son tour ou une proposition de changements. `messages` doit finir
 * par un tour de l'utilisateur. Les erreurs de l'API remontent (erreurs typées du SDK).
 */
export async function advance(messages: readonly Msg[], create: CreateMessage, ctx: () => AssistantContext, mode: AssistantMode = 'deep'): Promise<TurnOutcome> {
  const history = [...messages];
  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await create(requestParams(history, mode));
    history.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'pause_turn') continue;
    if (response.stop_reason === 'refusal') return { kind: 'done', messages: history, notice: 'Le modèle a refusé de répondre à cette demande. Reformule-la ou démarre une nouvelle conversation.' };
    if (response.stop_reason === 'max_tokens') return { kind: 'done', messages: history, notice: 'Réponse coupée (trop longue). Demande la suite ou précise ta question.' };
    if (response.stop_reason !== 'tool_use') return { kind: 'done', messages: history, notice: null };

    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    const ready: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    const changes: ProposedChange[] = [];
    for (const use of uses) {
      const input = toolInput(use.input);
      try {
        if (WRITE_TOOL_NAMES.has(use.name)) changes.push({ ...(await prepareChange(use.name, input, ctx())), toolUseId: use.id });
        else ready.push(textResult(use.id, JSON.stringify(await runReadTool(use.name, input, ctx()))));
      } catch (e) {
        ready.push(textResult(use.id, e instanceof ToolInputError ? e.message : `Erreur interne : ${e instanceof Error ? e.message : String(e)}`, true));
      }
    }
    if (changes.length > 0) return { kind: 'approval', messages: history, pending: { ready, changes } };
    // Tous les résultats d'un même tour repartent dans un seul message.
    history.push({ role: 'user', content: ready });
  }
  return { kind: 'done', messages: history, notice: 'L’assistant a fait trop d’étapes d’affilée ; pose une question plus précise.' };
}

/** Applique ou refuse chaque changement proposé, puis laisse Claude continuer. */
export async function resolveApproval(
  messages: readonly Msg[],
  pending: PendingApproval,
  decisions: ReadonlyMap<string, boolean>,
  create: CreateMessage,
  ctx: () => AssistantContext,
  mode: AssistantMode = 'deep',
): Promise<{ outcome: TurnOutcome; applied: string[] }> {
  const applied: string[] = [];
  const results = [...pending.ready];
  for (const c of pending.changes) {
    if (decisions.get(c.toolUseId) === true) {
      try {
        const done = await c.apply();
        applied.push(done);
        results.push(textResult(c.toolUseId, `${done}. L'utilisateur a validé ce changement.`));
      } catch (e) {
        results.push(textResult(c.toolUseId, `Échec de l'application : ${e instanceof Error ? e.message : String(e)}`, true));
      }
    } else {
      results.push(textResult(c.toolUseId, "L'utilisateur a refusé ce changement : rien n'a été modifié."));
    }
  }
  const outcome = await advance([...messages, { role: 'user', content: results }], create, ctx, mode);
  return { outcome, applied };
}

/**
 * Un historique rechargé après fermeture de l'app peut finir sur des appels d'outils sans résultat
 * (validation perdue) : on les clôt pour que la requête suivante soit valide.
 */
export function repairHistory(messages: readonly Msg[]): Msg[] {
  const last = messages[messages.length - 1];
  if (last === undefined || last.role !== 'assistant' || typeof last.content === 'string') return [...messages];
  const open = last.content.filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === 'tool_use');
  if (open.length === 0) return [...messages];
  return [...messages, { role: 'user', content: open.map((b) => textResult(b.id, "Interrompu (l'application a été fermée) : rien n'a été modifié.")) }];
}

/** Texte visible d'un message (utilisateur : le texte tapé seulement ; assistant : ses blocs de texte). */
export function visibleText(m: Msg): string {
  if (typeof m.content === 'string') return m.content;
  const texts = m.content.filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === 'text').map((b) => b.text);
  return m.role === 'user' ? (texts[0] ?? '') : texts.join('\n\n');
}
