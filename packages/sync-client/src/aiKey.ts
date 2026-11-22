/**
 * Clé API Anthropic de l'utilisateur, **une seule pour toutes les apps web de MyLife** (MyFinances et son
 * assistant, MyPerf et son coach) : saisie une fois, utilisée partout. Elle reste sur l'appareil
 * (stockage du navigateur) : jamais synchronisée, jamais sauvegardée, jamais envoyée ailleurs qu'à
 * l'API d'Anthropic. Effacée à la déconnexion.
 */
export const AI_KEY = 'mylife:anthropic-key';
/** Anciennes clés propres à chaque app : reprises une fois, puis supprimées. */
const LEGACY = ['myfinances-anthropic-key', 'myperf_anthropic_api_key'];

export function readAiKey(): string | null {
  try {
    const shared = localStorage.getItem(AI_KEY);
    if (shared) return shared;
    for (const k of LEGACY) {
      const old = localStorage.getItem(k);
      if (old) {
        writeAiKey(old);
        return old;
      }
    }
  } catch {
    /* stockage indisponible : pas de clé */
  }
  return null;
}

export function writeAiKey(value: string | null): void {
  try {
    const clean = value?.trim() || null;
    if (clean) localStorage.setItem(AI_KEY, clean);
    else localStorage.removeItem(AI_KEY);
    for (const k of LEGACY) localStorage.removeItem(k);
    // Prévient les autres onglets/apps ouverts (événement « storage » natif).
  } catch {
    /* stockage indisponible : rien n'est gardé */
  }
}

/**
 * Le modèle de Claude choisi, pour toutes les IA de MyLife (Copilot, conversion d'un programme…) : Opus 5.5, le plus
 * capable, ou Sonnet 5.5, plus rapide et moins cher. Réglage de l'appareil, comme la clé.
 */
export const AI_MODEL = 'mylife:ai-model';
export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', hint: 'le plus capable' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', hint: 'plus rapide, moins cher' },
] as const;
export type AiModel = (typeof AI_MODELS)[number]['id'];
const isAiModel = (v: unknown): v is AiModel => AI_MODELS.some((m) => m.id === v);

export function readAiModel(): AiModel {
  try {
    const v = localStorage.getItem(AI_MODEL);
    return isAiModel(v) ? v : 'claude-opus-5-5';
  } catch {
    return 'claude-opus-5-5';
  }
}

export function writeAiModel(model: AiModel): void {
  if (!isAiModel(model)) return;
  try {
    localStorage.setItem(AI_MODEL, model);
  } catch {
    /* stockage indisponible : le choix vaut pour cette visite */
  }
}
