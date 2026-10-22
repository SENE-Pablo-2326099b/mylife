import type Anthropic from '@anthropic-ai/sdk';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toolInput, visibleText, type Msg, type ProposedChange } from '../assistant/agent';
import { decide, resetConversation, retry, send, setApiKey, setAssistantContext, setMode, useAssistant } from '../assistant/store';
import { WRITE_TOOL_NAMES, type AssistantContext } from '../assistant/tools';
import { computeFire } from '../domain/fire';
import { plannedMonthlySavings } from '../domain/plans';
import { useAlerts } from '../domain/useAlerts';
import { useBudget } from '../domain/useBudget';
import { useRecurring } from '../domain/useInsights';
import { useWealth } from '../domain/useWealth';
import { useCategoryMap, useSettings } from '../hooks';
import { todayISO } from '../lib/dates';
import { Button, Card, Chip, Glass, Icon, IconButton, TextField } from '../ui/index';
import { Screen } from '../ui/Screen';

/**
 * Assistant finance : une conversation avec Claude (clé API de l'utilisateur) qui lit les données de
 * l'app avec des outils et propose des changements que l'utilisateur valide un par un.
 */

const SUGGESTIONS = [
  'Où est parti mon argent ce mois-ci ?',
  'Classe mes opérations en attente',
  'Combien me coûtent mes abonnements ?',
  'Comment épargner 100 € de plus par mois ?',
  'Suis-je en bonne voie pour mon indépendance financière ?',
];

/** Libellé court de ce que l'assistant est allé lire. */
function activityLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'get_overview':
      return 'Vue d’ensemble';
    case 'get_categories':
      return 'Catégories';
    case 'search_transactions':
      return typeof input.text === 'string' ? `Opérations « ${input.text} »` : input.uncategorized === true ? 'Opérations à classer' : 'Opérations';
    case 'spending_summary':
      return `Dépenses ${typeof input.from === 'string' ? `du ${input.from}` : ''}`;
    case 'get_budget_cycle':
      return 'Cycle budgétaire';
    case 'get_recurring':
      return 'Récurrents';
    case 'get_wealth':
      return 'Patrimoine';
    case 'get_fire':
      return 'Indépendance financière';
    case 'get_rules':
      return 'Règles';
    default:
      return name;
  }
}

/** Markdown minimal (paragraphes, listes, **gras**) : de quoi lire une réponse sans dépendance. */
function RichText({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="t-body space-y-2">
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d/.test(lines[0] ?? '');
          const items = lines.map((l, k) => <li key={k}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>);
          return ordered ? (
            <ol key={i} className="list-decimal space-y-1 pl-5">
              {items}
            </ol>
          ) : (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {items}
            </ul>
          );
        }
        if (/^#{1,4}\s/.test(block)) return <p key={i} className="t-body-strong">{inline(block.replace(/^#{1,4}\s/, ''))}</p>;
        return (
          <p key={i} className="whitespace-pre-line">
            {inline(block)}
          </p>
        );
      })}
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  if (typeof m.content !== 'string' && m.content.every((b) => b.type === 'tool_result')) return null;
  const text = visibleText(m);
  const reads = m.role === 'assistant' && typeof m.content !== 'string' ? m.content.filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === 'tool_use' && !WRITE_TOOL_NAMES.has(b.name)) : [];
  if (text === '' && reads.length === 0) return null;
  return (
    <div className={`flex flex-col gap-1.5 ${m.role === 'user' ? 'items-end' : 'items-stretch'}`}>
      {text !== '' &&
        (m.role === 'user' ? (
          <div className="t-body max-w-[86%] whitespace-pre-line rounded-lg rounded-br-sm px-4 py-2.5" style={{ background: 'var(--accent-soft)' }}>
            {text}
          </div>
        ) : (
          <Glass className="rounded-lg px-4 py-3">
            <RichText text={text} />
          </Glass>
        ))}
      {reads.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Données lues">
          {reads.map((b) => (
            <span key={b.id} className="t-caption flex h-6 items-center gap-1 rounded-pill px-2.5 text-muted" style={{ background: 'var(--surface-alt)' }}>
              <Icon name="search" size={12} />
              {activityLabel(b.name, toolInput(b.input))}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ChangeCard({ change }: { change: ProposedChange }) {
  const { decisions, busy } = useAssistant();
  const decision = decisions[change.toolUseId];
  return (
    <Card tone="accent" className="space-y-2">
      <p className="t-label flex items-center gap-1.5 text-accent">
        <Icon name="edit" size={14} />
        Proposition
      </p>
      <p className="t-body-strong">{change.title}</p>
      <ul className="t-small space-y-0.5 text-secondary">
        {change.details.map((d) => (
          <li key={d}>• {d}</li>
        ))}
      </ul>
      {change.reason !== '' && <p className="t-small text-muted">{change.reason}</p>}
      {decision === undefined ? (
        <div className="flex gap-2 pt-1">
          <Button variant="secondary" size="sm" className="flex-1" disabled={busy} onClick={() => void decide(change.toolUseId, false)}>
            Refuser
          </Button>
          <Button icon="check" size="sm" className="flex-1" disabled={busy} onClick={() => void decide(change.toolUseId, true)}>
            Appliquer
          </Button>
        </div>
      ) : (
        <p className={`t-small ${decision ? 'text-accent' : 'text-muted'}`}>{decision ? 'Validé' : 'Refusé'}</p>
      )}
    </Card>
  );
}

function ApiKeySetup({ onDone }: { onDone?: () => void }) {
  const [value, setValue] = useState('');
  const valid = value.trim().startsWith('sk-ant-') && value.trim().length > 20;
  return (
    <Card className="space-y-3">
      <p className="t-headline flex items-center gap-2">
        <Icon name="sparkles" className="text-accent" />
        Connecter l’assistant
      </p>
      <p className="t-small text-secondary">
        L’assistant utilise Claude (Anthropic) avec ta propre clé API. Il lit ton budget, tes opérations et ton patrimoine, et te propose des changements (classements, règles, objectifs…) que tu valides avant qu’ils s’appliquent.
      </p>
      <TextField label="Clé API Anthropic" type="password" mono value={value} onChange={setValue} placeholder="sk-ant-…" autoComplete="off" />
      <Button
        icon="key"
        className="w-full"
        disabled={!valid}
        onClick={() => {
          setApiKey(value);
          onDone?.();
        }}
      >
        Enregistrer la clé
      </Button>
      <p className="t-caption text-muted">
        La clé reste sur cet appareil, hors des sauvegardes et de la synchro. Ce que l’assistant lit pour te répondre est envoyé à l’API Claude, et les échanges sont facturés sur ton compte Anthropic.
      </p>
      <a className="t-small text-accent underline underline-offset-4" href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
        Créer une clé sur platform.claude.com
      </a>
    </Card>
  );
}

/** Les chiffres de l'écran (mêmes calculs que l'app), relus par l'assistant au moment où il en a besoin. */
function useAssistantContext(): AssistantContext | null {
  const settings = useSettings();
  const cats = useCategoryMap();
  const today = todayISO();
  const { state: budget, loading } = useBudget(today);
  const wealth = useWealth();
  const { list: recurring, txs, loaded } = useRecurring();
  const alerts = useAlerts();
  const fire = useMemo(() => {
    const monthly = settings.savings.mode === 'manual' ? settings.savings.manual : plannedMonthlySavings(wealth.plans, wealth.goals);
    return computeFire({ summaries: wealth.summaries, savingsAccounts: wealth.accounts.filter((a) => a.kind === 'savings' && !a.hidden), txs, cats, settings, today, monthly });
  }, [wealth, txs, cats, settings, today]);
  if (loading || !wealth.loaded || !loaded) return null;
  return { today, settings, cats, budget, wealth, recurring, alerts, fire };
}

export default function AssistantPage() {
  const a = useAssistant();
  const context = useAssistantContext();
  const [draft, setDraft] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Le contexte le plus récent est relu à chaque outil (après un changement validé, les chiffres suivent).
  const latest = useRef(context);
  latest.current = context;
  useEffect(() => {
    setAssistantContext(() => {
      if (!latest.current) throw new Error('Données pas encore chargées');
      return latest.current;
    });
    return () => setAssistantContext(null);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [a.messages.length, a.pending, a.busy]);

  const submit = (text: string) => {
    if (!text.trim() || !context) return;
    setDraft('');
    void send(text);
  };

  // Question venue de la palette de commande (?q=…) : envoyée dès que les données sont prêtes.
  const [params, setParams] = useSearchParams();
  const asked = params.get('q');
  useEffect(() => {
    if (!asked || !context) return;
    setParams({}, { replace: true });
    if (a.apiKey) submit(asked);
    else setDraft(asked);
  }, [asked, context]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastIsUser = a.messages[a.messages.length - 1]?.role === 'user';
  const ready = !!a.apiKey && !editingKey;

  return (
    <Screen
      stack
      title="Assistant"
      kicker="Claude, sur tes finances"
      mood="focus"
      back="/"
      right={
        a.apiKey ? (
          <>
            {a.messages.length > 0 && <IconButton icon="add" label="Nouvelle conversation" glass onClick={resetConversation} />}
            <IconButton icon="key" label="Clé API" glass onClick={() => setEditingKey((v) => !v)} />
          </>
        ) : undefined
      }
      footer={
        ready ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit(draft);
            }}
          >
            <textarea
              className="field-input max-h-40 min-h-[50px] flex-1 resize-none py-3"
              rows={1}
              value={draft}
              placeholder={a.pending ? 'Valide ou refuse la proposition…' : 'Pose ta question…'}
              aria-label="Message à l’assistant"
              disabled={a.busy || !!a.pending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit(draft);
                }
              }}
            />
            <IconButton icon="arrow-up" label="Envoyer" tone="accent" glass onClick={() => submit(draft)} />
          </form>
        ) : undefined
      }
    >
      {!ready ? (
        <ApiKeySetup onDone={() => setEditingKey(false)} />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="t-caption text-muted">Modèle :</span>
            <Chip small selected={a.mode === 'deep'} onClick={() => setMode('deep')}>
              Opus 5.5 · fiable
            </Chip>
            <Chip small selected={a.mode === 'fast'} onClick={() => setMode('fast')}>
              Sonnet 5.5 · rapide
            </Chip>
          </div>

          {a.messages.length === 0 && (
            <Card className="space-y-3">
              <p className="t-body text-secondary">Pose une question sur ton budget, tes dépenses ou tes placements. L’assistant lit tes données, et ne change rien sans ta validation.</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <Chip key={s} small onClick={() => submit(s)}>
                    {s}
                  </Chip>
                ))}
              </div>
            </Card>
          )}

          {a.messages.map((m, i) => (
            <Bubble key={i} m={m} />
          ))}
          {a.pending?.changes.map((c) => <ChangeCard key={c.toolUseId} change={c} />)}
          {a.busy && (
            <p className="t-small flex items-center gap-2 text-muted" aria-live="polite">
              <Icon name="sparkles" size={15} className="animate-pulse text-accent" />
              L’assistant réfléchit et lit tes données…
            </p>
          )}
          {a.applied.length > 0 && !a.busy && <p className="t-caption text-muted">{a.applied.length} changement{a.applied.length > 1 ? 's' : ''} appliqué{a.applied.length > 1 ? 's' : ''} dans cette conversation.</p>}
          {a.notice && <p className="t-small text-warning">{a.notice}</p>}
          {a.error && (
            <Card tone="danger" className="space-y-2">
              <p className="t-small text-danger">{a.error}</p>
              {(lastIsUser || a.pending) && a.apiKey && (
                <Button size="sm" variant="secondary" icon="sync" onClick={() => void retry()}>
                  Réessayer
                </Button>
              )}
            </Card>
          )}
          {!context && <p className="t-caption text-muted">Chargement de tes données…</p>}
          <div ref={endRef} />
        </div>
      )}
      {editingKey && a.apiKey && (
        <div className="mt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setApiKey(null);
              setEditingKey(false);
            }}
          >
            Retirer la clé de cet appareil
          </Button>
        </div>
      )}
    </Screen>
  );
}
