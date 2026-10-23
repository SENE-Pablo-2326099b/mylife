import type Anthropic from '@anthropic-ai/sdk';
import {
  addWeeks,
  computeCharacter,
  formatMini,
  gameTotals,
  goalProgress,
  listeningStreak,
  monthWeeks,
  musicPeriod,
  peakHour,
  recap,
  statValue,
  timeSplit,
  weekStart,
  weeklySeries,
  yearWeeks,
  type GamesData,
  type MiniApp,
  type MusicSummary,
  type StatsByApp,
} from './vendor/lumen';

/**
 * Copilot : l'IA de l'accueil MyLife, qui voit toutes les apps (avec la clé de l'utilisateur, depuis son
 * appareil, comme l'assistant de MyFinances et le coach de MyPerf). Lecture seule : il lit des résumés
 * (Personnage, bilans, fiches de contexte de MyFinances et MyPerf, musique, jeux, sorties) et propose ;
 * il ne modifie jamais rien. Ce module n'a pas d'interface : les sources de données lui sont fournies.
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
  stats: StatsByApp;
  rest: readonly string[];
  finances: Record<string, unknown> | null;
  perf: Record<string, unknown> | null;
  music: MusicSummary | null;
  games: GamesData | null;
  sorties: SortieDigest[];
  /** « Mes apps » : les apps sans code de l'utilisateur et leurs saisies. */
  miniApps: MiniApp[];
}

export const COPILOT_SYSTEM = `Tu es Copilot, l'assistant de MyLife : une app qui réunit le budget (MyFinances), la musculation (MyPerf), les sorties entre amis (Sorties, myRaveLoc), la musique (MyMusique), le jeu (MyGames), ses propres petites apps de suivi (« Mes apps » : lecture, sommeil, habitudes…) et un « Personnage » (RPG de la vraie vie : stats Force, Discipline, Social, Constance, Culture).

Ce que tu fais :
- Tu réponds aux questions de l'utilisateur sur sa vie à partir de SES données, que tu lis avec tes outils. Lis avant de répondre : ne devine jamais un chiffre.
- Tu croises les apps : un achat face au budget et à l'épargne, une semaine d'entraînement face à une sortie prévue, le temps passé à jouer face au sport.
- Tu proposes, tu ne fais rien : tu n'as aucun moyen de modifier ses données. Quand une action est utile, dis précisément où la faire (« dans MyFinances, Réglages → … », « dans MyPerf, Planning → … »).

Règles :
- Réponds en français, tutoie, sois concret et bref : quelques phrases ou une courte liste. Les montants en euros, les dates en clair.
- Si une donnée manque (fiche absente ou ancienne, app jamais ouverte, export Spotify ancien), dis-le et indique quelle app ouvrir pour la mettre à jour.
- Budget : le « reste à dépenser aujourd'hui » et le budget par jour sont des repères de vie courante ; l'épargne prévue n'est pas de l'argent à dépenser. Ne pousse jamais à s'endetter.
- Entraînement : prudence avec la santé ; pas de diagnostic médical. Pour alléger avant un événement, raisonne en séries et en charge, pas en conseils généraux.
- Les données d'autres personnes (membres d'une sortie) sont des pseudos : n'en déduis rien d'autre.`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  { name: 'get_overview', description: 'Vue d’ensemble : date, personnage (niveau, stats, quêtes de la semaine, série), quelles apps ont des données et de quand date chaque fiche.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_finances', description: 'Fiche MyFinances (en euros) : reste à dépenser aujourd’hui, budget du jour, cycle de paie (dates, jours restants), enveloppe, dépensé, projection de fin de cycle, épargne prévue, argent réellement libre, prochaines sorties d’argent.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_training', description: 'Fiche MyPerf : objectif de séances par semaine, séances faites cette semaine, séances prévues (21 jours), cycle en cours (semaine, deload), dernières séances, records, mouvements principaux (e1RM), mouvements qui stagnent.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  {
    name: 'get_recap',
    description: 'Bilan chiffré d’une période : séances, records, jours sous le budget, épargne tenue, semaines avec la bande, minutes d’écoute, quêtes, XP et niveaux gagnés. Période : une semaine (lundi AAAA-MM-JJ), un mois (AAAA-MM) ou une année (AAAA).',
    input_schema: { type: 'object', properties: { period: { type: 'string', description: 'AAAA-MM-JJ (le lundi d’une semaine), AAAA-MM ou AAAA' } }, required: ['period'], additionalProperties: false },
  },
  {
    name: 'get_music',
    description: 'MyMusique (export Spotify) : minutes, top artistes et titres d’une période (AAAA-MM, AAAA, ou vide pour tout), heure d’écoute préférée, séries de jours, date de fin de l’historique importé.',
    input_schema: { type: 'object', properties: { period: { type: 'string' } }, additionalProperties: false },
  },
  { name: 'get_games', description: 'MyGames : heures de jeu par jeu sur les N dernières semaines (1 à 12), et depuis toujours.', input_schema: { type: 'object', properties: { weeks: { type: 'integer', minimum: 1, maximum: 12 } }, additionalProperties: false } },
  { name: 'get_time_split', description: 'Où va le temps : minutes de sport (séances MyPerf), de musique (MyMusique) et de jeu (MyGames) sur les N dernières semaines (1 à 12).', input_schema: { type: 'object', properties: { weeks: { type: 'integer', minimum: 1, maximum: 12 } }, additionalProperties: false } },
  { name: 'get_my_apps', description: '« Mes apps » : les petites apps de suivi créées par l’utilisateur (lecture, sommeil, habitudes…) : champs, objectif et où il en est, stats, 8 dernières semaines, 15 dernières saisies.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_sorties', description: 'Les sorties (festivals, week-ends) de l’utilisateur : dates, lieu, décision (« ça se fait »), sa réponse, planning des sets avec qui y va, budget partagé (son solde), choses à emporter restantes.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
];

const age = (card: Record<string, unknown> | null, today: string) => (card && typeof card.day === 'string' ? (card.day === today ? 'aujourd’hui' : `du ${card.day}`) : null);

function weeksBack(today: string, n: number): { from: string; to: string } {
  const to = weekStart(today);
  return { from: addWeeks(to, -(Math.max(1, Math.min(12, n)) - 1)), to };
}

/** Exécute un outil ; renvoie du JSON (ou une explication) à donner à Claude. */
export function runTool(name: string, input: Record<string, unknown>, src: CopilotSources): { content: string; isError?: boolean } {
  const json = (v: unknown) => ({ content: JSON.stringify(v) });
  switch (name) {
    case 'get_overview': {
      const c = computeCharacter(src.stats, src.today, src.rest);
      return json({
        today: src.today,
        character: { level: c.level, title: c.title, xp: c.xp, streakWeeks: c.streak, stats: c.stats.map((s) => ({ stat: s.name, level: s.level, locked: s.locked })), weekQuests: c.quests.map((q) => ({ quest: q.title, progress: `${q.progress}/${q.target}`, done: q.done })) },
        cards: { finances: age(src.finances, src.today), training: age(src.perf, src.today) },
        musicHistoryUntil: src.music?.to || null,
        gamesTracked: !!src.games && (src.games.snapshots.length > 0 || src.games.manual.length > 0),
        sorties: src.sorties.length,
      });
    }
    case 'get_finances':
      return src.finances ? json(src.finances) : { content: 'Pas de fiche MyFinances sur cet appareil : ouvre MyFinances (écran Aujourd’hui) une fois.', isError: true };
    case 'get_training':
      return src.perf ? json(src.perf) : { content: 'Pas de fiche MyPerf sur cet appareil : ouvre MyPerf une fois (sur ce navigateur).', isError: true };
    case 'get_recap': {
      const p = typeof input.period === 'string' ? input.period : '';
      const range = /^\d{4}-\d{2}-\d{2}$/.test(p) ? { from: weekStart(p), to: weekStart(p) } : /^\d{4}-\d{2}$/.test(p) ? monthWeeks(p) : /^\d{4}$/.test(p) ? yearWeeks(p) : null;
      if (!range) return { content: 'Période invalide : AAAA-MM-JJ, AAAA-MM ou AAAA.', isError: true };
      const r = recap(src.stats, src.today, range.from, range.to, src.rest);
      return json({ ...r, xpByStat: undefined });
    }
    case 'get_music': {
      if (!src.music || src.music.totalMinutes === 0) return { content: 'Aucun historique d’écoute : importe ton export Spotify dans MyMusique.', isError: true };
      const p = typeof input.period === 'string' ? input.period : '';
      const m = musicPeriod(src.music, p);
      return json({ period: p || 'tout', historyFrom: src.music.from, historyUntil: src.music.to, minutes: m.minutes, plays: m.plays, newArtists: m.newArtists, topArtists: m.artists.map(([a, v]) => ({ artist: a, minutes: v })), topTracks: m.tracks.map(([t, a, v, n]) => ({ track: t, artist: a, minutes: v, plays: n })), peakHour: peakHour(src.music), streak: listeningStreak(src.music.days, src.music.to || src.today) });
    }
    case 'get_games': {
      if (!src.games || (!src.games.snapshots.length && !src.games.manual.length)) return { content: 'Aucune donnée de jeu : MyGames (Steam ou parties notées).', isError: true };
      const { from, to } = weeksBack(src.today, typeof input.weeks === 'number' ? input.weeks : 4);
      return json({ from, to, games: gameTotals(src.games, from, to).slice(0, 12).map((g) => ({ game: g.name, minutesInPeriod: g.period, minutesTotal: g.total })) });
    }
    case 'get_time_split': {
      const { from, to } = weeksBack(src.today, typeof input.weeks === 'number' ? input.weeks : 4);
      return json({ from, to, minutes: timeSplit(src.stats, src.games, from, to), musicHistoryUntil: src.music?.to || null });
    }
    case 'get_my_apps': {
      const apps = src.miniApps.filter((a) => a.spec);
      if (!apps.length) return { content: 'Aucune app dans « Mes apps » : l’utilisateur peut en créer depuis l’accueil (modèle ou description à une IA).', isError: true };
      return json(
        apps.map((a) => {
          const spec = a.spec!;
          const field = (id?: string) => spec.fields.find((f) => f.id === id);
          return {
            app: spec.name,
            fields: spec.fields.map((f) => ({ label: f.label, type: f.type, unit: f.unit })),
            goal: spec.goal ? { ...goalProgress(spec, a.entries, src.today), per: spec.goal.per, agg: spec.goal.agg, field: field(spec.goal.field)?.label } : null,
            stats: spec.stats.map((s) => ({ stat: s.label, value: formatMini(field(s.field), statValue(a.entries, s, src.today), s.agg) })),
            weeks: weeklySeries(spec, a.entries, src.today),
            entries: a.entries.length,
            last: a.entries.slice(-15).map((e) => ({ day: e.day, ...Object.fromEntries(Object.entries(e.values).map(([k, v]) => [field(k)?.label ?? k, v])) })),
          };
        }),
      );
    }
    case 'list_sorties':
      return json(src.sorties);
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

export function requestParams(messages: readonly Msg[]): Anthropic.Beta.MessageCreateParamsNonStreaming {
  // Trois marqueurs de cache : système, outils, dernier message (la conversation se relit du cache).
  const tools = TOOLS.map((t, i) => (i === TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t));
  const last = messages[messages.length - 1];
  return {
    model: COPILOT_MODEL,
    max_tokens: 16000,
    system: [{ type: 'text', text: COPILOT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools,
    messages: last === undefined ? [...messages] : [...messages.slice(0, -1), markCached(last)],
    // Réflexion adaptative (toujours active sur ce modèle) ; effort explicite.
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
}

/** Fait tourner Claude jusqu'à la fin de son tour (lectures comprises). `messages` finit par l'utilisateur. */
export async function advance(messages: readonly Msg[], create: CreateMessage, sources: () => CopilotSources): Promise<TurnResult> {
  const history = [...messages];
  const read: string[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await create(requestParams(history));
    history.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'refusal') return { messages: history, read, note: 'Cette demande a été déclinée par les filtres de sécurité.' };
    if (response.stop_reason === 'max_tokens') return { messages: history, read, note: 'Réponse coupée (trop longue) : demande plus court.' };
    if (response.stop_reason === 'pause_turn') continue;
    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || uses.length === 0) return { messages: history, read, note: null };
    const src = sources();
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = uses.map((u) => {
      read.push(u.name);
      const input = typeof u.input === 'object' && u.input !== null && !Array.isArray(u.input) ? (u.input as Record<string, unknown>) : {};
      const r = runTool(u.name, input, src);
      return { type: 'tool_result', tool_use_id: u.id, content: r.content, ...(r.isError ? { is_error: true } : {}) };
    });
    history.push({ role: 'user', content: results });
  }
  return { messages: history, read, note: 'Trop d’étapes pour une seule réponse : reformule ta question.' };
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
