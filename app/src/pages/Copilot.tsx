import Anthropic from '@anthropic-ai/sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Field, Glass, Icon, List, ListRow, ModuleCard, Notice, ScreenHeader } from '@mylife/kit';
import { ACTION_APP, ACTION_APP_NAME, ACTIONS_EVENT, ACTIONS_KEY, enqueueAction, localToday, readActions, readCopilotCard, type ActionSpec } from '@mylife/lumen';
import { AI_MODELS, readAiKey, readAiModel, writeAiKey, writeAiModel, type AiModel } from '@mylife/core/aiKey';
import { advance, textOf, userMessage, type CopilotSources, type Msg } from '@legacy/copilot';
import { sortieDigests } from '@legacy/sortieDigest';
import { loadSpaces, useSpaces } from '@legacy/spaces';
import { adoptOldHistory, compact, conversations, DOMAINS, domainOf, newConversationId, syncConversations, titleOf, type Domain } from './copilotStore';

/**
 * Copilot : une seule IA pour tous tes modules, avec ta clé, depuis ton appareil. Elle lit tes résumés et propose ;
 * ses actions s’affichent en cartes que tu valides, exécutées ensuite par le module concerné. Les conversations sont
 * gardées et suivent sur tous tes appareils (`copilotStore.ts`, chiffrées de bout en bout) ; chacune a un domaine.
 * Un module peut ouvrir Copilot avec une question préparée : `/copilot?domaine=finances&q=…` (modifiable avant envoi). La logique (outils,
 * boucle, actions) est partagée avec l’ancien accueil (`@legacy/copilot`) jusqu’à ce qu’il disparaisse.
 */
const PROPOSALS_KEY = 'mylife:copilot:proposals';
const READ_LABEL: Record<string, string> = { get_overview: 'tes modules', get_finances: 'ton budget', get_training: 'ton entraînement', list_sorties: 'tes sorties', get_agenda: 'ton agenda', propose_action: 'une action à valider' };
const APP_PATH = { finances: '/argent', perf: '/perf/' } as const;

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

/** Opus 5.5 (le plus capable) ou Sonnet 5.5 (plus rapide, moins cher) : le même choix pour toutes les IA de MyLife. */
function ModelChoice({ value, onChange }: { value: AiModel; onChange: (m: AiModel) => void }) {
  return (
    <div className="row" style={{ gap: 10 }}>
      <span className="t-small muted">Modèle</span>
      <div className="glass segmented grow" role="group" aria-label="Modèle de Claude">
        {AI_MODELS.map((m) => (
          <button key={m.id} type="button" aria-pressed={value === m.id} title={m.hint} onClick={() => onChange(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function KeyCard({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState('');
  return (
    <ModuleCard tone="neutral">
      <div className="pad stack">
        <span className="t-card">Ta clé API Anthropic</span>
        <span className="t-small muted">Copilot parle à Claude avec ta propre clé (la même que l’assistant de MyFinances et le coach de MyPerf). Elle reste sur cet appareil : jamais synchronisée, jamais envoyée ailleurs qu’à Anthropic, effacée si tu te déconnectes.</span>
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

const when = (t: number) => {
  const d = new Date(t);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

/** La question, avec la date du jour et le domaine de la conversation à part (hors du préfixe mis en cache). */
function question(text: string, domain: Domain): Msg {
  const m = userMessage(text, localToday());
  if (typeof m.content === 'string') return m;
  return { ...m, content: [...m.content, { type: 'text', text: `<domaine>${domainOf(domain).hint}</domaine>` }] };
}

export function CopilotPage() {
  const spaces = useSpaces();
  const [params, setParams] = useSearchParams();
  const [apiKey, setApiKey] = useState<string | null>(() => readAiKey());
  const [model, setModel] = useState<AiModel>(() => readAiModel());
  const all = conversations.useList();
  const list = useMemo(() => [...all].sort((a, b) => b.value.updatedAt - a.value.updatedAt), [all]);
  const [current, setCurrent] = useState<string | null>(null);
  const [draftDomain, setDraftDomain] = useState<Domain>('general');
  const [view, setView] = useState<'chat' | 'list'>('chat');
  const [pending, setPending] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>(loadProposals);
  const [, tick] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    adoptOldHistory();
    void syncConversations();
  }, []);
  // Ouvert par un module avec une question préparée : une nouvelle conversation dans son domaine, question à relire.
  useEffect(() => {
    const q = params.get('q');
    const d = params.get('domaine');
    if (!q && !d) return;
    setCurrent(null);
    setView('chat');
    setDraftDomain(domainOf(d).id);
    if (q) setText(q);
    setParams({}, { replace: true });
    setTimeout(() => input.current?.focus(), 50);
  }, [params, setParams]);
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

  const conv = current ? (conversations.get(current) ?? null) : null;
  const domain = conv?.domain ?? draftDomain;
  const messages = conv?.messages ?? [];
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, busy, pending]);

  const updateProposals = (fn: (list: Proposal[]) => Proposal[]) =>
    setProposals((items) => {
      const out = fn(items);
      writeJson(PROPOSALS_KEY, out.slice(-30));
      return out;
    });
  const sources = (): CopilotSources => ({ today: localToday(), finances: readCopilotCard('finances'), perf: readCopilotCard('perf'), sorties: sortieDigests(spaces.sorties, spaces.uid) });

  const start = (d: Domain = 'general') => {
    setCurrent(null);
    setDraftDomain(d);
    setView('chat');
    setReading([]);
    setNote(null);
    setText('');
  };

  const ask = async (q: string) => {
    if (!apiKey || !q.trim() || busy) return;
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 180_000 });
    const id = current ?? newConversationId();
    const base = conv ?? { title: titleOf(q), domain, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    const next = [...base.messages, question(q.trim(), base.domain)];
    setPending(q.trim());
    setText('');
    setBusy(true);
    setNote(null);
    setReading([]);
    try {
      const r = await advance(next, (p) => client.beta.messages.create(p), sources, model);
      conversations.put(id, { ...base, messages: compact(r.messages), updatedAt: Date.now() });
      setCurrent(id);
      setReading([...new Set(r.read)]);
      setNote(r.note);
      if (r.proposals.length) updateProposals((items) => [...items, ...r.proposals.map((p) => ({ id: p.id, action: p.action, state: 'proposed' as const, at: Date.now() }))]);
    } catch (e) {
      setText(q);
      setNote(describe(e));
    } finally {
      setPending(null);
      setBusy(false);
    }
  };
  const shown = bubbles(messages);
  const spec = domainOf(domain);

  if (view === 'list')
    return (
      <>
        <ScreenHeader kicker="Copilot" title="Conversations" right={<Button onClick={() => start()}>Nouvelle</Button>} />
        {list.length === 0 ? (
          <span className="t-small muted">Aucune conversation pour l’instant. Elles sont gardées ici et suivent sur tous tes appareils.</span>
        ) : (
          DOMAINS.filter((d) => list.some((c) => c.value.domain === d.id)).map((d) => (
            <section key={d.id} className="stack" style={{ gap: 6 }}>
              <span className="t-label muted">{d.label}</span>
              <List>
                {list
                  .filter((c) => c.value.domain === d.id)
                  .map((c) =>
                    confirm === c.id ? (
                      <div key={c.id} className="list-row" style={{ flexWrap: 'wrap' }}>
                        <span className="grow t-small">Supprimer « {c.value.title} » sur tous tes appareils ?</span>
                        <Button
                          variant="danger"
                          onClick={() => {
                            conversations.remove(c.id);
                            if (current === c.id) setCurrent(null);
                            setConfirm(null);
                          }}
                        >
                          Supprimer
                        </Button>
                        <Button variant="quiet" onClick={() => setConfirm(null)}>
                          Garder
                        </Button>
                      </div>
                    ) : (
                      <div key={c.id} className="row" style={{ gap: 4 }}>
                        <div className="grow" style={{ minWidth: 0 }}>
                          <ListRow
                            title={c.value.title}
                            detail={`${when(c.value.updatedAt)} · ${bubbles(c.value.messages).length} message${bubbles(c.value.messages).length > 1 ? 's' : ''}`}
                            onClick={() => {
                              setCurrent(c.id);
                              setView('chat');
                              setReading([]);
                              setNote(null);
                            }}
                          />
                        </div>
                        <button type="button" className="icon-btn tile" aria-label={`Supprimer « ${c.value.title} »`} onClick={() => setConfirm(c.id)}>
                          <Icon name="close" size={16} />
                        </button>
                      </div>
                    ),
                  )}
              </List>
            </section>
          ))
        )}
        <span className="t-small muted">Les conversations sont chiffrées sur ton appareil avant de partir vers ton compte : le serveur ne peut pas les lire. Ta clé d’API, elle, reste sur cet appareil.</span>
      </>
    );

  return (
    <>
      <ScreenHeader
        kicker={conv ? `${spec.label} · ${when(conv.createdAt)}` : 'Une IA pour tous tes modules'}
        title={conv ? conv.title : 'Copilot'}
        right={
          <div className="row" style={{ gap: 8 }}>
            <Button variant="quiet" icon="list" onClick={() => setView('list')}>
              {`Historique${list.length ? ` (${list.length})` : ''}`}
            </Button>
            {conv && <Button onClick={() => start(conv.domain)}>Nouvelle</Button>}
          </div>
        }
      />
      {!apiKey && <KeyCard onSaved={() => setApiKey(readAiKey())} />}
      {apiKey && <ModelChoice value={model} onChange={(m) => { writeAiModel(m); setModel(m); }} />}
      {!conv && (
        <div className="glass segmented" role="group" aria-label="Domaine de la conversation" style={{ gridAutoColumns: 'minmax(0, 1fr)' }}>
          {DOMAINS.map((d) => (
            <button key={d.id} type="button" aria-pressed={draftDomain === d.id} onClick={() => setDraftDomain(d.id)} style={{ padding: '0 4px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {d.label}
            </button>
          ))}
        </div>
      )}
      {apiKey && shown.length === 0 && !pending && (
        <ModuleCard tone="neutral">
          <div className="pad stack">
            <span className="t-card">{spec.id === 'general' ? 'Pose une question sur ta vie' : `Parle de ${spec.id === 'finances' ? 'tes finances' : spec.id === 'sport' ? 'ton entraînement' : 'tes sorties'}`}</span>
            <span className="t-small muted">Copilot lit {spec.id === 'general' ? 'ton budget, tes séances, ton agenda et tes sorties' : 'd’abord ce domaine, et croise avec le reste quand c’est utile'} pour te répondre. Il peut préparer une action (sauter un récurrent, décaler une séance) : rien n’est fait sans ta validation.</span>
            <div className="tile" style={{ padding: '0 14px' }}>
              {spec.suggestions.map((sug) => (
                <ListRow key={sug} title={sug} onClick={() => void ask(sug)} />
              ))}
            </div>
          </div>
        </ModuleCard>
      )}
      {[...shown, ...(pending ? [{ role: 'user' as const, text: pending }] : [])].map((b, i) =>
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
          <ActionCard key={p.id} p={p} onChange={(next) => updateProposals((items) => items.map((x) => (x.id === next.id ? next : x)))} />
        ))}
      {busy && (
        <span className="t-small muted row" aria-live="polite">
          <Icon name="copilot" size={14} /> Copilot lit tes données et réfléchit…
        </span>
      )}
      {!busy && reading.length > 0 && <span className="t-small muted">A lu : {reading.map((r) => READ_LABEL[r] ?? r).join(', ')}</span>}
      {note && <Notice tone="warn">{note}</Notice>}
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
            <input ref={input} id="question" value={text} onChange={(e) => setText(e.target.value)} placeholder="Pose ta question" enterKeyHint="send" />
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
              variant="quiet"
              onClick={() => {
                writeAiKey(null);
                setApiKey(null);
              }}
            >
              Retirer la clé de cet appareil
            </Button>
            <span className="t-small muted">Tes conversations suivent sur tous tes appareils, chiffrées. Les questions et les résumés lus partent vers l’API Claude d’Anthropic, avec ta clé, qui reste sur cet appareil.</span>
          </div>
        </details>
      )}
    </>
  );
}
