/**
 * The coach's agent loop (Claude API, manual tool loop). Read tools run immediately; write tools
 * pause the loop until the user approves or declines each proposed change in the chat.
 * The history is append-only: assistant turns are stored exactly as returned (thinking blocks
 * included), which the API requires to keep reasoning across turns.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { COACH_SYSTEM } from './prompt';
import { COACH_TOOLS, prepareCoachChange, runReadTool, ToolInputError, WRITE_TOOL_NAMES, type CoachChange } from './tools';

/**
 * Models the coach can run on. Default is Sonnet, both for quality (very capable on tool loops,
 * same tools and same prompt) and for cost (Opus is ~5× more expensive input and output). Opus is
 * one tap away for the questions that need a deeper analysis.
 */
export const COACH_MODELS = {
  auto: 'claude-sonnet-5-5',
  deep: 'claude-opus-5-5',
} as const;
export type CoachMode = keyof typeof COACH_MODELS;
/** Kept as a named export: used across the app and in tests to say "the usual Claude model". */
export const COACH_MODEL = COACH_MODELS.auto;
const MAX_STEPS = 16;

export type Msg = Anthropic.Beta.BetaMessageParam;
export type CreateMessage = (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;

export interface ProposedChange extends Omit<CoachChange, 'apply'> {
  toolUseId: string;
  apply: () => string;
}

/** A turn waiting on the user: results of the read tools already run, and the changes to decide. */
export interface PendingApproval {
  ready: Anthropic.Beta.BetaToolResultBlockParam[];
  changes: ProposedChange[];
}

export type TurnOutcome =
  | { kind: 'done'; messages: Msg[]; notice: string | null }
  | { kind: 'approval'; messages: Msg[]; pending: PendingApproval };

/**
 * Marks the end of a cached chunk on a message's last content block. Everything up to that marker
 * is cached on the server. Combined with the markers on the system and the tools, a tool loop
 * replays its history almost for free: only the newest turn pays full price.
 */
/** Blocks on which the API accepts cache_control: text, tool_use, tool_result, image, document. */
const CACHEABLE_BLOCKS = new Set(['text', 'tool_use', 'tool_result', 'image', 'document']);

function markCached(message: Msg): Msg {
  if (typeof message.content === 'string') {
    return { ...message, content: [{ type: 'text', text: message.content, cache_control: { type: 'ephemeral' } }] };
  }
  const content = [...message.content];
  // Thinking blocks reject cache_control; find the last block that accepts it.
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i];
    if (b !== undefined && CACHEABLE_BLOCKS.has(b.type)) {
      content[i] = { ...b, cache_control: { type: 'ephemeral' } } as typeof b;
      return { ...message, content };
    }
  }
  return message;
}

export function requestParams(messages: Msg[], mode: CoachMode = 'auto'): Anthropic.Beta.MessageCreateParamsNonStreaming {
  // The API accepts up to four cache markers. We use three: system, tools, and the last message.
  // On the next turn the previous "last" marker is still inside the recent prefix the server kept,
  // so the whole conversation up to the newest turn is read from cache (~90 % cheaper on input).
  const tools = COACH_TOOLS.map((t, i) => (i === COACH_TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t));
  const last = messages[messages.length - 1];
  const cachedMessages = last === undefined ? messages : [...messages.slice(0, -1), markCached(last)];
  return {
    model: COACH_MODELS[mode],
    max_tokens: 16000,
    system: [{ type: 'text', text: COACH_SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools,
    messages: cachedMessages,
    output_config: { effort: 'medium' },
    // If a request is declined by a safety classifier, the API retries it on a fallback model.
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

/** User message carrying the typed text and, separately, the context the model needs (today's date). */
export function userMessage(text: string, today: string): Msg {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'text', text: `<contexte>Date du jour : ${today}</contexte>` },
    ],
  };
}

/**
 * Calls Claude until it ends its turn or proposes changes. `messages` must end with a user turn.
 * Errors from the API propagate (typed SDK errors) — the caller shows them.
 */
export async function advance(messages: readonly Msg[], create: CreateMessage, today: string, mode: CoachMode = 'auto'): Promise<TurnOutcome> {
  const history = [...messages];
  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await create(requestParams(history, mode));
    history.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'pause_turn') continue;
    if (response.stop_reason === 'refusal') {
      return { kind: 'done', messages: history, notice: 'Le modèle a refusé de répondre à cette demande. Reformule-la ou démarre une nouvelle conversation.' };
    }
    if (response.stop_reason === 'max_tokens') {
      return { kind: 'done', messages: history, notice: 'Réponse coupée (trop longue). Demande la suite ou précise ta question.' };
    }
    if (response.stop_reason !== 'tool_use') return { kind: 'done', messages: history, notice: null };

    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    const ready: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    const changes: ProposedChange[] = [];
    for (const use of uses) {
      const input = toolInput(use.input);
      try {
        if (WRITE_TOOL_NAMES.has(use.name)) {
          const change = prepareCoachChange(use.name, input);
          changes.push({ ...change, toolUseId: use.id });
        } else {
          ready.push(textResult(use.id, JSON.stringify(runReadTool(use.name, input, today))));
        }
      } catch (e) {
        const message = e instanceof ToolInputError ? e.message : `Erreur interne : ${e instanceof Error ? e.message : String(e)}`;
        ready.push(textResult(use.id, message, true));
      }
    }
    if (changes.length > 0) return { kind: 'approval', messages: history, pending: { ready, changes } };
    // Every result of one assistant turn goes back in a single user message.
    history.push({ role: 'user', content: ready });
  }
  return { kind: 'done', messages: history, notice: 'Le coach a fait trop d’étapes d’affilée ; pose une question plus précise.' };
}

/** Applies or declines each proposed change, then lets Claude continue. */
export async function resolveApproval(
  messages: readonly Msg[],
  pending: PendingApproval,
  decisions: ReadonlyMap<string, boolean>,
  create: CreateMessage,
  today: string,
  mode: CoachMode = 'auto',
): Promise<{ outcome: TurnOutcome; applied: string[] }> {
  const applied: string[] = [];
  const results = [...pending.ready];
  for (const c of pending.changes) {
    if (decisions.get(c.toolUseId) === true) {
      try {
        const done = c.apply();
        applied.push(done);
        results.push(textResult(c.toolUseId, `${done}. L'utilisateur a validé ce changement.`));
      } catch (e) {
        results.push(textResult(c.toolUseId, `Échec de l'application : ${e instanceof Error ? e.message : String(e)}`, true));
      }
    } else {
      results.push(textResult(c.toolUseId, "L'utilisateur a refusé ce changement : rien n'a été modifié."));
    }
  }
  const outcome = await advance([...messages, { role: 'user', content: results }], create, today, mode);
  return { outcome, applied };
}

/**
 * A history restored after the app was killed may end on tool calls without results (a pending
 * approval lost). Close them so the next request is valid.
 */
export function repairHistory(messages: readonly Msg[]): Msg[] {
  const last = messages[messages.length - 1];
  if (last === undefined || last.role !== 'assistant' || typeof last.content === 'string') return [...messages];
  const open = last.content.filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === 'tool_use');
  if (open.length === 0) return [...messages];
  return [...messages, { role: 'user', content: open.map((b) => textResult(b.id, "Interrompu (l'application a été fermée) : rien n'a été modifié.")) }];
}

/** Visible text of a message (user: the typed text only; assistant: its text blocks). */
export function visibleText(m: Msg): string {
  if (typeof m.content === 'string') return m.content;
  const texts = m.content.filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === 'text').map((b) => b.text);
  return m.role === 'user' ? (texts[0] ?? '') : texts.join('\n\n');
}

/** Tool input as a plain record (the SDK types it as unknown). */
export function toolInput(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input));
}
