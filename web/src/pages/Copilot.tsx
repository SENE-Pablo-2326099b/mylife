import Anthropic from '@anthropic-ai/sdk';
import { useEffect, useRef, useState } from 'react';
import { localToday, readCopilotCard } from '../vendor/lumen';
import { readAiKey, writeAiKey } from '../vendor/mylife-sync/aiKey';
import { advance, textOf, userMessage, type CopilotSources, type Msg } from '../copilot';
import { loadCrews, useCrews } from '../crew';
import { sortieDigests } from '../sortieDigest';
import { Icon } from '../ui/icons';
import { Button, Card, Disclosure, Reveal, TextField } from '../ui/index';
import { Screen } from '../ui/Screen';
import { readGames, readMusic, useStatsInput } from '../ui/stats';
import { toast } from '../ui/toastStore';

/**
 * Copilot : une seule IA pour toutes tes apps, avec ta clé (la même que l'assistant de MyFinances et le coach
 * de MyPerf), depuis ton appareil. Lecture seule : elle lit tes résumés et propose. Logique : web/src/copilot.ts.
 */

const HISTORY_KEY = 'mylife:copilot:history';
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
  const end = useRef<HTMLDivElement>(null);

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
              <p className="t-small mt-1 text-secondary">Copilot lit ton budget, tes séances, tes bilans, ta musique, tes jeux et tes sorties pour te répondre. Il propose, il ne modifie rien.</p>
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
