import Anthropic from '@anthropic-ai/sdk';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Field, Glass, Icon, ListRow, ModuleCard, Notice, ScreenHeader } from '@mylife/kit';
import { ACTION_APP, ACTION_APP_NAME, ACTIONS_EVENT, ACTIONS_KEY, enqueueAction, localToday, readActions, readCopilotCard, type ActionSpec } from '@mylife/lumen';
import { readAiKey, writeAiKey } from '@mylife/core/aiKey';
import { advance, textOf, userMessage, type CopilotSources, type Msg } from '@legacy/copilot';
import { sortieDigests } from '@legacy/sortieDigest';
import { loadSpaces, useSpaces } from '@legacy/spaces';

/**
 * Copilot : une seule IA pour tous tes modules, avec ta clé, depuis ton appareil. Elle lit tes résumés et propose ;
 * ses actions s’affichent en cartes que tu valides, exécutées ensuite par le module concerné. La logique (outils,
 * boucle, actions) est partagée avec l’ancien accueil (`@legacy/copilot`) jusqu’à ce qu’il disparaisse.
 */
const HISTORY_KEY = 'mylife:copilot:history';
const PROPOSALS_KEY = 'mylife:copilot:proposals';
const SUGGESTIONS = ['Je peux me payer un billet à 80 € ce mois-ci ?', 'Résume ma semaine.', 'Quelle semaine alléger avant ma prochaine sortie ?', 'Qu’est-ce qui m’attend cette semaine ?'];
const READ_LABEL: Record<string, string> = { get_overview: 'tes modules', get_finances: 'ton budget', get_training: 'ton entraînement', list_sorties: 'tes sorties', get_agenda: 'ton agenda', propose_action: 'une action à valider' };
const APP_PATH = { finances: '/finances/', perf: '/perf/' } as const;

interface Proposal {
  id: string;
  action: ActionSpec;
  state: 'proposed' | 'refused' | 'validated';
  undone?: boolean;
  at: number;
}

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage plein : reste en mémoire */
  }
};
const loadProposals = (): Proposal[] => readJson<Proposal[]>(PROPOSALS_KEY, []).filter((p) => p && typeof p.id === 'string' && p.action && ACTION_APP[p.action.kind]);
const loadHistory = (): Msg[] => readJson<Msg[]>(HISTORY_KEY, []);
function saveHistory(m: Msg[]) {
  // Les 40 derniers messages, en commençant par un message de l’utilisateur qui ne soit pas un résultat d’outil.
  let start = Math.max(0, m.length - 40);
  while (start < m.length && !(m[start]!.role === 'user' && typeof m[start]!.content !== 'string' && (m[start]!.content as { type: string }[])[0]?.type === 'text')) start++;
  writeJson(HISTORY_KEY, m.slice(start));
}

function describe(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Clé API refusée : vérifie-la (« Ta clé », plus bas).';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Cette clé n’a pas accès au modèle : vérifie ton compte Anthropic.';
  if (e instanceof Anthropic.RateLimitError) return 'Trop de requêtes pour le moment : réessaie dans une minute.';
  if (e instanceof Anthropic.BadRequestError) return `Requête refusée par l’API : ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Pas de connexion à l’API Claude : vérifie ton réseau.';
  if (e instanceof Anthropic.APIError) return `Erreur de l’API Claude (${e.status ?? '?'}) : réessaie.`;
  return `Erreur inattendue : ${e instanceof Error ? e.message : String(e)}`;
}

function bubbles(messages: Msg[]): { role: 'user' | 'assistant'; text: string }[] {
  const out: { role: 'user' | 'assistant'; text: string }[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      if (typeof m.content === 'string') out.push({ role: 'user', text: m.content });
      else if (m.content[0]?.type === 'text') out.push({ role: 'user', text: m.content[0].text });
    } else {
      const t = textOf(m);
      if (t) out.push({ role: 'assistant', text: t });
    }
  }
  return out;
}

/** Une action proposée : la valider ou la refuser ; ensuite son état en direct (le module l’exécute). */
function ActionCard({ p, onChange }: { p: Proposal; onChange: (next: Proposal) => void }) {
  const app = ACTION_APP[p.action.kind];
  const queued = readActions().find((a) => a.id === p.id);
  const undo = readActions().find((a) => a.id === `${p.id}:annule`);
  return (
    <ModuleCard tone={app === 'finances' ? 'finances' : 'perf'}>
      <div className="pad stack" style={{ gap: 8 }}>
        <Badge>Action · {ACTION_APP_NAME[app]}</Badge>
        <span className="t-strong">{p.action.summary}</span>
        {p.state === 'proposed' && (
          <>
            <span className="t-small muted">Rien n’est fait sans ta validation. C’est {ACTION_APP_NAME[app]} qui l’exécutera.</span>
            <div className="grid-2">
              <Button
                variant="action"
                onClick={() => {
                  enqueueAction(p.action, p.id);
                  onChange({ ...p, state: 'validated' });
                }}
              >
                Valider
              </Button>
              <Button onClick={() => onChange({ ...p, state: 'refused' })}>Refuser</Button>
            </div>
          </>
        )}
        {p.state === 'validated' &&
          (!queued || queued.status === 'pending' ? (
            <>
              <span className="t-small muted">Validée : {ACTION_APP_NAME[app]} l’applique dès son ouverture.</span>
              <Button href={APP_PATH[app]}>Ouvrir {ACTION_APP_NAME[app]}</Button>
            </>
          ) : queued.status === 'failed' ? (
            <Notice tone="bad">Pas faite : {queued.error}</Notice>
          ) : p.undone ? (
            <span className="t-small muted">{undo?.status === 'done' ? 'Annulée.' : undo?.status === 'failed' ? `Annulation impossible : ${undo.error}` : `Annulation validée : ${ACTION_APP_NAME[app]} l’applique dès son ouverture.`}</span>
          ) : (
            <div className="row">
              <span className="grow t-small c-ok">Fait par {ACTION_APP_NAME[app]}.</span>
              {queued.undo && (
                <Button
                  variant="quiet"
                  onClick={() => {
                    enqueueAction(queued.undo!, `${p.id}:annule`);
                    onChange({ ...p, undone: true });
                  }}
                >
                  Annuler
                </Button>
              )}
            </div>
          ))}
      </div>
    </ModuleCard>
  );
}

function KeyCard({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState('');
  return (
    <ModuleCard tone="neutral">
      <div className="pad stack">
        <span className="t-card">Ta clé API Anthropic</span>
        <span className="t-small muted">Copilot parle à Claude avec ta propre clé (la même que l’assistant de MyFinances et le coach de MyPerf). Elle reste sur cet appareil : jamais synchronisée, jamais envoyée ailleurs qu’à Anthropic.</span>
        <Field id="api-key" label="Clé API" hint="Une clé se crée sur console.anthropic.com (API Keys). Chaque question est facturée sur ton compte Anthropic.">
          <input id="api-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" />
        </Field>
        <Button
          variant="action"
          block
          disabled={!key.trim().startsWith('sk-')}
          onClick={() => {
            writeAiKey(key);
            setKey('');
            onSaved();
          }}
        >
          Enregistrer la clé
        </Button>
      </div>
    </ModuleCard>
  );
}

export function CopilotPage() {
  const spaces = useSpaces();
  const [apiKey, setApiKey] = useState<string | null>(() => readAiKey());
  const [messages, setMessages] = useState<Msg[]>(loadHistory);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>(loadProposals);
  const [, tick] = useState(0);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bump = () => tick((n) => n + 1);
    const onStorage = (e: StorageEvent) => e.key === ACTIONS_KEY && bump();
    window.addEventListener(ACTIONS_EVENT, bump);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', bump);
    return () => {
      window.removeEventListener(ACTIONS_EVENT, bump);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', bump);
    };
  }, []);
  useEffect(() => {
    if (spaces.status === 'idle') void loadSpaces();
  }, [spaces.status]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, busy]);

  const updateProposals = (fn: (list: Proposal[]) => Proposal[]) =>
    setProposals((list) => {
      const out = fn(list);
      writeJson(PROPOSALS_KEY, out.slice(-30));
      return out;
    });
  const sources = (): CopilotSources => ({ today: localToday(), finances: readCopilotCard('finances'), perf: readCopilotCard('perf'), sorties: sortieDigests(spaces.sorties, spaces.uid) });

  const ask = async (question: string) => {
    if (!apiKey || !question.trim() || busy) return;
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 180_000 });
    const next = [...messages, userMessage(question.trim(), localToday())];
    setMessages(next);
    setText('');
    setBusy(true);
    setNote(null);
    setReading([]);
    try {
      const r = await advance(next, (params) => client.beta.messages.create(params), sources);
      setMessages(r.messages);
      saveHistory(r.messages);
      setReading([...new Set(r.read)]);
      setNote(r.note);
      if (r.proposals.length) updateProposals((list) => [...list, ...r.proposals.map((p) => ({ id: p.id, action: p.action, state: 'proposed' as const, at: Date.now() }))]);
    } catch (e) {
      setMessages(messages);
      setText(question);
      setNote(describe(e));
    } finally {
      setBusy(false);
    }
  };
  const shown = bubbles(messages);

  return (
    <>
      <ScreenHeader kicker="Une IA pour tous tes modules" title="Copilot" />
      {!apiKey && <KeyCard onSaved={() => setApiKey(readAiKey())} />}
      {apiKey && shown.length === 0 && (
        <ModuleCard tone="neutral">
          <div className="pad stack">
            <span className="t-card">Pose une question sur ta vie</span>
            <span className="t-small muted">Copilot lit ton budget, tes séances, ton agenda et tes sorties pour te répondre. Il peut préparer une action (sauter un récurrent, décaler une séance) : rien n’est fait sans ta validation.</span>
            <div className="tile" style={{ padding: '0 14px' }}>
              {SUGGESTIONS.map((s) => (
                <ListRow key={s} title={s} onClick={() => void ask(s)} />
              ))}
            </div>
          </div>
        </ModuleCard>
      )}
      {shown.map((b, i) =>
        b.role === 'user' ? (
          <div key={i} className="btn-action" style={{ alignSelf: 'flex-end', maxWidth: '85%', padding: '10px 14px', borderRadius: 18, background: 'var(--action)', color: '#fff', boxShadow: 'none', whiteSpace: 'pre-wrap' }}>
            {b.text}
          </div>
        ) : (
          <Glass key={i} className="pad">
            <p className="t-body" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{b.text}</p>
          </Glass>
        ),
      )}
      {proposals
        .filter((p) => p.state !== 'refused')
        .slice(-6)
        .map((p) => (
          <ActionCard key={p.id} p={p} onChange={(next) => updateProposals((list) => list.map((x) => (x.id === next.id ? next : x)))} />
        ))}
      {busy && (
        <span className="t-small muted row" aria-live="polite">
          <Icon name="copilot" size={14} /> Copilot lit tes données et réfléchit…
        </span>
      )}
      {!busy && reading.length > 0 && <span className="t-small muted">A lu : {reading.map((r) => READ_LABEL[r] ?? r).join(', ')}</span>}
      {note && (
        <Notice tone="warn">{note}</Notice>
      )}
      <div ref={end} />
      {apiKey && (
        <form
          className="stack"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            void ask(text);
          }}
        >
          <Field id="question" label="Ta question">
            <input id="question" value={text} onChange={(e) => setText(e.target.value)} placeholder="Pose ta question" enterKeyHint="send" />
          </Field>
          <button type="submit" className="btn btn-action btn-block" disabled={busy || !text.trim()}>
            {busy ? 'Réflexion…' : 'Demander'}
          </button>
        </form>
      )}
      {apiKey && (
        <details className="glass" style={{ padding: '4px 16px' }}>
          <summary className="t-strong" style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>Réglages de Copilot</summary>
          <div className="stack" style={{ padding: '4px 0 12px' }}>
            <Button
              disabled={!messages.length}
              onClick={() => {
                setMessages([]);
                saveHistory([]);
                setReading([]);
                updateProposals(() => []);
              }}
            >
              Nouvelle conversation
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                writeAiKey(null);
                setApiKey(null);
              }}
            >
              Retirer la clé de cet appareil
            </Button>
            <span className="t-small muted">La conversation reste sur cet appareil. Les questions et les résumés lus partent vers l’API Claude d’Anthropic, avec ta clé.</span>
          </div>
        </details>
      )}
    </>
  );
}
