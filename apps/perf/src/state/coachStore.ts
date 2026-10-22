import * as Haptics from 'expo-haptics';
import { create } from 'zustand';

import { today } from '@/domain/dates';
import { getKv, setKv } from '@/db/repos/settings';
import { advance, repairHistory, resolveApproval, userMessage, type CoachMode, type CreateMessage, type Msg, type PendingApproval, type TurnOutcome } from '@/services/coach/agent';
import { loadApiKey, saveApiKey } from '@/services/coach/apiKey';

const HISTORY_KEY = 'coach_history';
const MODE_KEY = 'coach_mode';

interface CoachState {
  /** undefined while loading from the keychain. */
  apiKey: string | null | undefined;
  messages: Msg[];
  pending: PendingApproval | null;
  decisions: Record<string, boolean>;
  busy: boolean;
  error: string | null;
  notice: string | null;
  /** Changes applied during this conversation (shown as confirmations). */
  applied: string[];
  /** 'auto' (Sonnet, default) or 'deep' (Opus, kept for one message, costly). */
  mode: CoachMode;

  init: () => Promise<void>;
  setApiKey: (key: string | null) => Promise<void>;
  setMode: (mode: CoachMode) => void;
  send: (text: string) => Promise<void>;
  decide: (toolUseId: string, accept: boolean) => Promise<void>;
  retry: () => Promise<void>;
  reset: () => void;
}

/** Test seam: replace the network call. */
let createOverride: CreateMessage | null = null;
export function setCoachTransportForTests(create: CreateMessage | null): void {
  createOverride = create;
}

function persist(messages: Msg[]) {
  setKv(HISTORY_KEY, messages.length === 0 ? null : JSON.stringify(messages));
}

function isMsg(v: unknown): v is Msg {
  if (typeof v !== 'object' || v === null || !('role' in v) || !('content' in v)) return false;
  return (v.role === 'user' || v.role === 'assistant') && (typeof v.content === 'string' || Array.isArray(v.content));
}

function restore(): Msg[] {
  const raw = getKv(HISTORY_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isMsg) ? repairHistory(parsed) : [];
  } catch {
    return [];
  }
}

/**
 * Le SDK Claude (lourd) n'est chargé qu'au premier message envoyé au coach : l'ouverture de l'app
 * (surtout la version web) ne le télécharge pas.
 */
let clientModule: Promise<typeof import('@/services/coach/client')> | null = null;
const coachClient = () => (clientModule ??= import('@/services/coach/client'));

export const useCoach = create<CoachState>((set, get) => {
  const transport = (): CreateMessage | null => {
    if (createOverride !== null) return createOverride;
    const key = get().apiKey;
    if (typeof key !== 'string' || key === '') return null;
    let client: CreateMessage | null = null;
    return async (params) => {
      client ??= (await coachClient()).createCoachClient(key);
      return client(params);
    };
  };

  const settle = (outcome: TurnOutcome) => {
    persist(outcome.messages);
    if (outcome.kind === 'approval') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      set({ messages: outcome.messages, pending: outcome.pending, decisions: {}, busy: false });
    } else {
      set({ messages: outcome.messages, pending: null, decisions: {}, busy: false, notice: outcome.notice });
    }
  };

  const run = async (task: (create: CreateMessage) => Promise<void>) => {
    const create = transport();
    if (create === null) {
      set({ error: 'Ajoute ta clé API Anthropic pour parler au coach.' });
      return;
    }
    set({ busy: true, error: null, notice: null });
    try {
      await task(create);
    } catch (e) {
      const { describeCoachError } = await coachClient();
      set({ busy: false, error: describeCoachError(e) });
    }
  };

  return {
    apiKey: undefined,
    messages: [],
    pending: null,
    decisions: {},
    busy: false,
    error: null,
    notice: null,
    applied: [],
    mode: 'auto',

    init: async () => {
      const key = await loadApiKey().catch(() => null);
      const savedMode = getKv(MODE_KEY) === 'deep' ? 'deep' : 'auto';
      set({ apiKey: key, messages: restore(), mode: savedMode });
    },

    setApiKey: async (key) => {
      await saveApiKey(key);
      set({ apiKey: key === null || key.trim() === '' ? null : key.trim(), error: null });
    },

    setMode: (mode) => {
      setKv(MODE_KEY, mode);
      set({ mode });
    },

    send: async (text) => {
      const trimmed = text.trim();
      const { busy, pending, messages } = get();
      if (trimmed === '' || busy || pending !== null) return;
      const next = [...messages, userMessage(trimmed, today())];
      set({ messages: next });
      persist(next);
      await run(async (create) => settle(await advance(next, create, today(), get().mode)));
    },

    decide: async (toolUseId, accept) => {
      const { pending, decisions, messages } = get();
      if (pending === null || get().busy) return;
      const nextDecisions = { ...decisions, [toolUseId]: accept };
      set({ decisions: nextDecisions });
      if (!pending.changes.every((c) => nextDecisions[c.toolUseId] !== undefined)) return;
      await run(async (create) => {
        const { outcome, applied } = await resolveApproval(messages, pending, new Map(Object.entries(nextDecisions)), create, today(), get().mode);
        if (applied.length > 0) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        set((s) => ({ applied: [...s.applied, ...applied] }));
        settle(outcome);
      });
    },

    /** After an API error: the last turn is a user message (or decided approvals) — ask again. */
    retry: async () => {
      const { messages, pending, decisions } = get();
      if (pending !== null) {
        const first = pending.changes[0];
        if (first !== undefined && decisions[first.toolUseId] !== undefined) await get().decide(first.toolUseId, decisions[first.toolUseId] === true);
        return;
      }
      const last = messages[messages.length - 1];
      if (last?.role !== 'user') return;
      await run(async (create) => settle(await advance(messages, create, today(), get().mode)));
    },

    reset: () => {
      persist([]);
      set({ messages: [], pending: null, decisions: {}, error: null, notice: null, applied: [] });
    },
  };
});
