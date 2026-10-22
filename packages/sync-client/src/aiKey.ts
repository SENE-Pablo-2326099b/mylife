/**
 * Clé API Anthropic de l'utilisateur, **une seule pour toutes les apps web de MyLife** (MyFinances et son
 * assistant, MyPerf et son coach) : saisie une fois, utilisée partout. Elle reste sur l'appareil
 * (stockage du navigateur) : jamais synchronisée, jamais sauvegardée, jamais envoyée ailleurs qu'à
 * l'API d'Anthropic. L'app Android de MyPerf garde la sienne dans le trousseau du système.
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
