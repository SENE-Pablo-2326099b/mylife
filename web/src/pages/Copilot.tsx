import Anthropic from '@anthropic-ai/sdk';
import { useEffect, useRef, useState } from 'react';
import { ACTION_APP, ACTION_APP_NAME, ACTIONS_EVENT, ACTIONS_KEY, enqueueAction, localToday, readActions, readCopilotCard, type ActionSpec } from '../vendor/lumen';
import { runHomeActions } from '../actionsHome';
import { objectives } from '../myObjectifsData';
import { openMyLifeApp } from '../ui/app';
import { readAiKey, writeAiKey } from '../vendor/mylife-sync/aiKey';
import { advance, textOf, userMessage, type CopilotSources, type Msg } from '../copilot';
import { loadCrews, useCrews } from '../crew';
import { sortieDigests } from '../sortieDigest';
import { Icon } from '../ui/icons';
import { Badge, Button, Card, Disclosure, Reveal, TextField } from '../ui/index';
import { Screen } from '../ui/Screen';
import { readGames, readMiniApps, readMusic, useStatsInput } from '../ui/stats';
import { toast } from '../ui/toastStore';

/**
 * Copilot : une seule IA pour toutes tes apps, avec ta clé (la même que l'assistant de MyFinances et le coach
 * de MyPerf), depuis ton appareil. Elle lit tes résumés et propose ; ses actions préparées s'affichent en cartes que
 * tu valides, exécutées ensuite par l'app concernée (V4, F1). Logique : web/src/copilot.ts.
 */

const HISTORY_KEY = 'mylife:copilot:history';
/** Actions proposées par Copilot et ce que tu en as fait (sur l'appareil, effacé avec le reste). */
const PROPOSALS_KEY = 'mylife:copilot:proposals';

interface Proposal {
  id: string;
  action: ActionSpec;
  state: 'proposed' | 'refused' | 'validated';
  /** Annulée après coup (l'action inverse a été validée). */
  undone?: boolean;
  at: number;
}

function loadProposals(): Proposal[] {
  try {
    const v = JSON.parse(localStorage.getItem(PROPOSALS_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as Proposal[]).filter((p) => p && typeof p.id === 'string' && p.action && ACTION_APP[p.action.kind]) : [];
  } catch {
    return [];
  }
}
function saveProposals(list: Proposal[]) {
  try {
    localStorage.setItem(PROPOSALS_KEY, JSON.stringify(list.slice(-30)));
  } catch {
    /* stockage plein */
  }
}

const APP_PATH = { finances: '/finances/', perf: '/perf/' } as const;

/** Une action proposée : la valider ou la refuser ; ensuite son état en direct (l'app concernée l'exécute). */
function ActionCard({ p, onChange }: { p: Proposal; onChange: (next: Proposal) => void }) {
  const app = ACTION_APP[p.action.kind];
  const queued = readActions().find((a) => a.id === p.id);
  const undo = readActions().find((a) => a.id === `${p.id}:annule`);
  const validate = async () => {
    enqueueAction(p.action, p.id);
    onChange({ ...p, state: 'validated' });
    if (app === 'home') await runHomeActions();
  };
  const cancel = async () => {
    if (!queued?.undo) return;
    enqueueAction(queued.undo, `${p.id}:annule`);
    onChange({ ...p, undone: true });
    if (app === 'home') await runHomeActions();
  };
  return (
    <Card>
      <div className="flex items-center gap-2">
        <Badge tone="accent" icon="sparkles">
          Action · {ACTION_APP_NAME[app]}
        </Badge>
      </div>
      <p className="t-body-strong mt-2">{p.action.summary}</p>
      {p.state === 'proposed' && (
        <>
          <p className="t-caption mt-1 text-muted">Rien n’est fait sans ta validation. C’est {ACTION_APP_NAME[app]} qui l’exécutera.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button icon="check" onClick={() => void validate()}>
              Valider
            </Button>
            <Button variant="secondary" onClick={() => onChange({ ...p, state: 'refused' })}>
              Refuser
            </Button>
          </div>
        </>
      )}
      {p.state === 'refused' && <p className="t-small mt-1 text-muted">Refusée.</p>}
      {p.state === 'validated' && (
        <div className="mt-1 flex flex-col gap-2">
          {!queued || queued.status === 'pending' ? (
            <>
              <p className="t-small text-secondary">Validée : {ACTION_APP_NAME[app]} l’applique dès son ouverture.</p>
              {app !== 'home' && (
                <Button size="sm" variant="secondary" onClick={() => openMyLifeApp(APP_PATH[app])}>
                  Ouvrir {ACTION_APP_NAME[app]}
                </Button>
              )}
            </>
          ) : queued.status === 'failed' ? (
            <p className="t-small text-danger">Pas faite : {queued.error}</p>
          ) : p.undone ? (
            <p className="t-small text-secondary">{undo?.status === 'done' ? 'Annulée.' : undo?.status === 'failed' ? `Annulation impossible : ${undo.error}` : `Annulation validée : ${ACTION_APP_NAME[app]} l’applique dès son ouverture.`}</p>
          ) : (
            <div className="flex items-center gap-2">
              <p className="t-small flex-1 text-success">Fait par {ACTION_APP_NAME[app]}.</p>
              {queued.undo && (
                <Button size="sm" variant="ghost" onClick={() => void cancel()}>
                  Annuler
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
const SUGGESTIONS = [
  'Je peux me payer un billet à 80 € ce mois-ci ?',
  'Résume ma semaine.',
  'Quelle semaine alléger avant ma prochaine sortie ?',
  'Où part mon temps ce mois-ci ?',
  'Qu’est-ce que j’écoute le plus en ce moment ?',
];
const READ_LABEL: Record<string, string> = {
  get_overview: 'ton personnage',
  get_finances: 'ton budget',
  get_training: 'ton entraînement',
  get_recap: 'tes bilans',
  get_music: 'ta musique',
  get_games: 'tes jeux',
  get_time_split: 'ton temps',
  list_sorties: 'tes sorties',
  get_my_apps: 'tes apps',
  get_agenda: 'ton agenda',
  get_objectives: 'tes objectifs',
  propose_action: 'une action à valider',
};

function loadHistory(): Msg[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as Msg[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(m: Msg[]) {
  try {
    // Les 40 derniers messages, en commençant par un message de l'utilisateur qui ne soit pas un résultat d'outil.
    let start = Math.max(0, m.length - 40);
    while (start < m.length && !(m[start]!.role === 'user' && typeof m[start]!.content !== 'string' && (m[start]!.content as { type: string }[])[0]?.type === 'text')) start++;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(m.slice(start)));
  } catch {
    /* stockage plein : la conversation reste en mémoire */
  }
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

/** Les messages à afficher : questions et réponses (pas les lectures d'outils). */
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

function KeyCard({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState('');
  return (
    <Card level="raised">
      <p className="t-headline">Ta clé API Anthropic</p>
      <p className="t-small mt-1 text-secondary">Copilot parle à Claude avec ta propre clé (la même que l’assistant de MyFinances et le coach de MyPerf). Elle reste sur cet appareil : jamais synchronisée, jamais envoyée ailleurs qu’à Anthropic.</p>
      <div className="mt-3 flex flex-col gap-2">
        <TextField label="Clé API" type="password" value={key} onChange={setKey} placeholder="sk-ant-…" autoComplete="off" />
        <Button
          disabled={!key.trim().startsWith('sk-')}
          onClick={() => {
            writeAiKey(key);
            setKey('');
            onSaved();
          }}
        >
          Enregistrer la clé
        </Button>
        <p className="t-caption text-muted">Une clé se crée sur console.anthropic.com (API Keys). Chaque question est facturée sur ton compte Anthropic.</p>
      </div>
    </Card>
  );
}

export function CopilotPage() {
  const { stats, rest } = useStatsInput();
  const crews = useCrews();
  const [apiKey, setApiKey] = useState<string | null>(() => readAiKey());
  const [messages, setMessages] = useState<Msg[]>(() => loadHistory());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>(() => loadProposals());
  const [, tick] = useState(0);
  const end = useRef<HTMLDivElement>(null);

  // L'état des actions validées change quand une app les exécute (autre onglet, ou ici pour « Mes apps »).
  useEffect(() => {
    void runHomeActions().then(() => tick((n) => n + 1));
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
  const updateProposal = (next: Proposal) =>
    setProposals((list) => {
      const out = list.map((p) => (p.id === next.id ? next : p));
      saveProposals(out);
      return out;
    });

  useEffect(() => {
    if (crews.status === 'idle') void loadCrews();
  }, [crews.status]);
  useEffect(() => {
    // Accolades : scrollIntoView renvoie une promesse dans les navigateurs récents, pas une fonction de nettoyage.
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, busy]);

  const sources = (): CopilotSources => ({
    today: localToday(),
    stats,
    rest,
    finances: readCopilotCard('finances'),
    perf: readCopilotCard('perf'),
    music: readMusic(),
    games: readGames(),
    sorties: sortieDigests(crews.sorties, crews.uid),
    miniApps: Object.values(readMiniApps()),
    objectives: objectives.list().map((i) => i.value),
  });

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
      if (r.proposals.length)
        setProposals((list) => {
          const out = [...list, ...r.proposals.map((p) => ({ id: p.id, action: p.action, state: 'proposed' as const, at: Date.now() }))];
          saveProposals(out);
          return out;
        });
    } catch (e) {
      setMessages(messages);
      setText(question);
      toast({ message: describe(e) });
    } finally {
      setBusy(false);
    }
  };

  const shown = bubbles(messages);

  return (
    <Screen stack title="Copilot" kicker="Une IA pour toutes tes apps" mood="today" back="/">
      <div className="flex flex-col gap-3">
        {!apiKey && <KeyCard onSaved={() => setApiKey(readAiKey())} />}

        {apiKey && shown.length === 0 && (
          <Reveal index={0}>
            <Card level="raised" glow>
              <p className="t-title">Pose une question sur ta vie</p>
              <p className="t-small mt-1 text-secondary">Copilot lit ton budget, tes séances, tes bilans, ta musique, tes jeux et tes sorties pour te répondre. Il peut préparer une action (sauter un récurrent, décaler une séance, noter une saisie) : rien n’est fait sans ta validation.</p>
              <div className="mt-3 flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} variant="secondary" size="sm" className="justify-start text-left" onClick={() => void ask(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </Card>
          </Reveal>
        )}

        {shown.map((b, i) => (
          <div key={i} className={b.role === 'user' ? 'ml-10 self-end' : 'mr-4'}>
            <div className={`rounded-lg px-4 py-3 ${b.role === 'user' ? 'text-white' : 'glass glass-raised'}`} style={b.role === 'user' ? { background: 'linear-gradient(140deg, var(--accent-g0), var(--accent-g1))' } : undefined}>
              <p className="t-body whitespace-pre-wrap">{b.text}</p>
            </div>
          </div>
        ))}

        {proposals
          .filter((p) => p.state !== 'refused')
          .slice(-6)
          .map((p) => (
            <ActionCard key={p.id} p={p} onChange={updateProposal} />
          ))}

        {busy && (
          <p className="t-small flex items-center gap-2 px-1 text-muted" aria-live="polite">
            <Icon name="sparkles" size={14} className="text-gold" /> Copilot lit tes données et réfléchit…
          </p>
        )}
        {!busy && reading.length > 0 && <p className="t-caption px-1 text-muted">A lu : {reading.map((r) => READ_LABEL[r] ?? r).join(', ')}</p>}
        {note && <p className="t-small px-1 text-warning">{note}</p>}
        <div ref={end} />

        {apiKey && (
          <div className="flex flex-col gap-2">
            <TextField label="Ta question" value={text} onChange={setText} placeholder="Je peux me payer… ? Comment s’est passée ma semaine ?" enterKeyHint="send" />
            <Button icon="sparkles" disabled={busy || !text.trim()} onClick={() => void ask(text)}>
              {busy ? 'Réflexion…' : 'Demander'}
            </Button>
          </div>
        )}

        {apiKey && (
          <Disclosure title="Réglages" summary="Conversation, clé">
            <div className="flex flex-col gap-2">
              <Button
                variant="secondary"
                icon="trash"
                disabled={!messages.length}
                onClick={() => {
                  setMessages([]);
                  saveHistory([]);
                  setReading([]);
                  setProposals([]);
                  saveProposals([]);
                }}
              >
                Nouvelle conversation
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  writeAiKey(null);
                  setApiKey(null);
                }}
              >
                Retirer la clé de cet appareil
              </Button>
              <p className="t-caption text-muted">La conversation reste sur cet appareil. Les questions et les résumés lus partent vers l’API Claude d’Anthropic, avec ta clé.</p>
            </div>
          </Disclosure>
        )}
      </div>
    </Screen>
  );
}
