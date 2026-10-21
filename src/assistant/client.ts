import Anthropic from '@anthropic-ai/sdk';
import type { CreateMessage } from './agent';

/**
 * Client direct : l'app parle à l'API Claude avec la clé de l'utilisateur (pas de serveur entre les
 * deux). `dangerouslyAllowBrowser` est exigé par le SDK hors de Node ; la clé ne quitte l'appareil que
 * vers api.anthropic.com.
 */
export function createAssistantClient(apiKey: string): CreateMessage {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 180_000 });
  return (params) => client.beta.messages.create(params);
}

/** Message clair et actionnable pour une erreur de l'API. */
export function describeAssistantError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Clé API refusée : vérifie-la (bouton Clé, en haut).';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Cette clé n’a pas accès au modèle. Vérifie ton compte Anthropic.';
  if (e instanceof Anthropic.RateLimitError) return 'Trop de requêtes pour le moment : réessaie dans une minute.';
  if (e instanceof Anthropic.BadRequestError) return `Requête refusée par l’API : ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Pas de connexion à l’API Claude. Vérifie ton réseau.';
  if (e instanceof Anthropic.APIError) return `Erreur de l’API Claude (${e.status ?? '?'}) : réessaie.`;
  return `Erreur inattendue : ${e instanceof Error ? e.message : String(e)}`;
}
