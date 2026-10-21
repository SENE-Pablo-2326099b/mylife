import Anthropic from '@anthropic-ai/sdk';

import type { CreateMessage } from './agent';

/**
 * Direct client: the app talks to the Claude API with the user's own key (personal app, no server).
 * `dangerouslyAllowBrowser` is required by the SDK outside Node; the key never leaves the device
 * except to api.anthropic.com.
 */
export function createCoachClient(apiKey: string): CreateMessage {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 180_000 });
  return (params) => client.beta.messages.create(params);
}

/** French, actionable message for an API failure. */
export function describeCoachError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Clé API refusée : vérifie-la dans Réglages → Coach IA.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Cette clé n’a pas accès au modèle. Vérifie ton compte Anthropic.';
  if (e instanceof Anthropic.RateLimitError) return 'Trop de requêtes pour le moment : réessaie dans une minute.';
  if (e instanceof Anthropic.BadRequestError) return `Requête refusée par l’API : ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Pas de connexion à l’API Claude. Vérifie ton réseau.';
  if (e instanceof Anthropic.APIError) return `Erreur de l’API Claude (${e.status ?? '?'}) : réessaie.`;
  return `Erreur inattendue : ${e instanceof Error ? e.message : String(e)}`;
}
