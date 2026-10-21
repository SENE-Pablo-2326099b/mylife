import { useSyncExternalStore } from 'react';
import { todayISO } from '../lib/dates';
import { haptic } from '../ui/motion';
import { advance, repairHistory, resolveApproval, userMessage, type AssistantMode, type CreateMessage, type Msg, type PendingApproval, type TurnOutcome } from './agent';
import type { AssistantContext } from './tools';

/**
 * État de la conversation avec l'assistant. La clé API, le modèle choisi et l'historique restent sur
 * cet appareil (stockage du navigateur) : ils ne passent ni par la synchro du compte ni par les
 * sauvegardes. Seul l'échange avec l'API Claude, fait avec la clé de l'utilisateur, quitte l'appareil.
 */

const KEY = 'myfinances-anthropic-key';
const HISTORY = 'myfinances-assistant-history';
const MODE = 'myfinances-assistant-mode';

export interface AssistantState {
  apiKey: string | null;
  messages: Msg[];
  pending: PendingApproval | null;
  decisions: Record<string, boolean>;
  busy: boolean;
  error: string | null;
  notice: string | null;
  /** Changements appliqués pendant cette conversation. */
  applied: string[];
  mode: AssistantMode;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Stockage indisponible : rien n'est gardé.
  }
}

function isMsg(v: unknown): v is Msg {
  if (typeof v !== 'object' || v === null || !('role' in v) || !('content' in v)) return false;
  return (v.role === 'user' || v.role === 'assistant') && (typeof v.content === 'string' || Array.isArray(v.content));
}

function restore(): Msg[] {
  const raw = read(HISTORY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isMsg) ? repairHistory(parsed) : [];
  } catch {
    return [];
  }
}

const persist = (messages: Msg[]) => write(HISTORY, messages.length === 0 ? null : JSON.stringify(messages));

let state: AssistantState = {
  apiKey: read(KEY),
  messages: restore(),
  pending: null,
  decisions: {},
  busy: false,
  error: null,
  notice: null,
  applied: [],
  mode: read(MODE) === 'fast' ? 'fast' : 'deep',
};
const listeners = new Set<() => void>();
const set = (patch: Partial<AssistantState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useAssistant(): AssistantState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

// ---------------------------------------------------------------- contexte et transport

/** Fourni par l'écran de l'assistant : les chiffres qu'il affiche (budget, patrimoine…). */
let contextSource: (() => AssistantContext) | null = null;
export function setAssistantContext(source: (() => AssistantContext) | null): void {
  contextSource = source;
}
const ctx = (): AssistantContext => {
  if (!contextSource) throw new Error('Données pas encore chargées');
  return contextSource();
};

/** Point d'injection pour les tests : remplace l'appel réseau. */
let createOverride: CreateMessage | null = null;
export function setAssistantTransportForTests(create: CreateMessage | null): void {
  createOverride = create;
}

/** Le SDK Claude n'est téléchargé qu'au premier message : l'app n'en paie pas le poids au lancement. */
let clientModule: Promise<typeof import('./client')> | null = null;
const loadClient = () => (clientModule ??= import('./client'));

function transport(): CreateMessage | null {
  if (createOverride) return createOverride;
  const key = state.apiKey;
  if (!key) return null;
  let client: CreateMessage | null = null;
  return async (params) => {
    client ??= (await loadClient()).createAssistantClient(key);
    return client(params);
  };
}

function settle(outcome: TurnOutcome) {
  persist(outcome.messages);
  if (outcome.kind === 'approval') {
    haptic('warning');
    set({ messages: outcome.messages, pending: outcome.pending, decisions: {}, busy: false });
  } else {
    set({ messages: outcome.messages, pending: null, decisions: {}, busy: false, notice: outcome.notice });
  }
}

async function run(task: (create: CreateMessage) => Promise<void>) {
  const create = transport();
  if (!create) {
    set({ error: 'Ajoute ta clé API Anthropic pour parler à l’assistant.' });
    return;
  }
  set({ busy: true, error: null, notice: null });
  try {
    await task(create);
  } catch (e) {
    const { describeAssistantError } = await loadClient();
    set({ busy: false, error: describeAssistantError(e) });
  }
}

// ---------------------------------------------------------------- actions

export function setApiKey(key: string | null): void {
  const clean = key?.trim() || null;
  write(KEY, clean);
  set({ apiKey: clean, error: null });
}

export function setMode(mode: AssistantMode): void {
  write(MODE, mode);
  set({ mode });
}

export async function send(text: string): Promise<void> {
  const trimmed = text.trim();
  if (trimmed === '' || state.busy || state.pending) return;
  const next = [...state.messages, userMessage(trimmed, todayISO())];
  set({ messages: next });
  persist(next);
  await run(async (create) => settle(await advance(next, create, ctx, state.mode)));
}

export async function decide(toolUseId: string, accept: boolean): Promise<void> {
  const { pending, decisions, messages } = state;
  if (!pending || state.busy) return;
  const next = { ...decisions, [toolUseId]: accept };
  set({ decisions: next });
  if (!pending.changes.every((c) => next[c.toolUseId] !== undefined)) return;
  await run(async (create) => {
    const { outcome, applied } = await resolveApproval(messages, pending, new Map(Object.entries(next)), create, ctx, state.mode);
    if (applied.length) haptic('success');
    set({ applied: [...state.applied, ...applied] });
    settle(outcome);
  });
}

/** Après une erreur de l'API : le dernier tour est un message (ou des décisions prises) — on relance. */
export async function retry(): Promise<void> {
  const { messages, pending, decisions } = state;
  if (pending) {
    const first = pending.changes[0];
    if (first && decisions[first.toolUseId] !== undefined) await decide(first.toolUseId, decisions[first.toolUseId] === true);
    return;
  }
  if (messages[messages.length - 1]?.role !== 'user') return;
  await run(async (create) => settle(await advance(messages, create, ctx, state.mode)));
}

export function resetConversation(): void {
  persist([]);
  set({ messages: [], pending: null, decisions: {}, error: null, notice: null, applied: [] });
}
