import Anthropic from '@anthropic-ai/sdk';
import { readAiKey, type AiModel } from '@mylife/core/aiKey';
import { programPrompt } from '@mylife/training';

/**
 * Convertir un programme avec Claude (texte libre, photo ou PDF) : depuis l'appareil, avec la clé de l'utilisateur
 * (jamais ailleurs qu'à Anthropic), le modèle qu'il a choisi (Opus 5.5 ou Sonnet 5.5). Claude répond dans le format
 * d'échange de MyPerf ; la réponse repasse par la même lecture tolérante que tout import, et rien n'est écrit avant
 * d'avoir été montré et validé.
 */

export type ConvertInput = { text: string } | { file: { data: string; mediaType: string; name: string } };

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

/** Les fichiers que Claude lit directement (les fichiers texte se lisent sur l'appareil, sans IA). */
export const isConvertible = (mediaType: string) => mediaType === 'application/pdf' || (IMAGE_TYPES as readonly string[]).includes(mediaType);

export class ConvertError extends Error {}

export async function convertWithClaude(input: ConvertInput, model: AiModel): Promise<string> {
  const apiKey = readAiKey();
  if (!apiKey) throw new ConvertError('Ajoute ta clé API Anthropic dans Copilot pour convertir avec Claude.');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 180_000 });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if ('file' in input) {
    if (input.file.mediaType === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.file.data } });
    else if ((IMAGE_TYPES as readonly string[]).includes(input.file.mediaType)) content.push({ type: 'image', source: { type: 'base64', media_type: input.file.mediaType as ImageType, data: input.file.data } });
    else throw new ConvertError('Ce type de fichier ne se convertit pas : PDF, photo (JPEG, PNG, WebP) ou texte.');
  }
  content.push({ type: 'text', text: `${programPrompt()}${'text' in input ? input.text : '(le programme est dans le fichier joint)'}` });
  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      messages: [{ role: 'user', content }],
      output_config: { effort: 'medium' },
      // Si un filtre de sécurité décline la demande, l'API la relance sur un modèle de repli.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (response.stop_reason === 'refusal') throw new ConvertError('Claude n’a pas pu convertir ce programme. Essaie avec le texte seul, ou copie le prompt dans une autre IA.');
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
    if (!text.trim()) throw new ConvertError('Claude n’a rien renvoyé. Réessaie.');
    if (response.stop_reason === 'max_tokens') throw new ConvertError('Le programme est trop long pour une seule conversion : importe-le en deux fois.');
    return text;
  } catch (e) {
    if (e instanceof ConvertError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new ConvertError('Ta clé API est refusée par Anthropic. Vérifie-la dans Copilot.');
    if (e instanceof Anthropic.RateLimitError) throw new ConvertError('Trop de demandes pour le moment : réessaie dans une minute.');
    if (e instanceof Anthropic.BadRequestError) throw new ConvertError(`Demande refusée : ${e.message}`);
    if (e instanceof Anthropic.APIConnectionError) throw new ConvertError('Pas de connexion : la conversion avec Claude a besoin d’internet.');
    if (e instanceof Anthropic.APIError) throw new ConvertError(`Erreur d’Anthropic (${e.status ?? '?'}) : réessaie.`);
    throw e;
  }
}

/** Un fichier choisi, lu sur l'appareil : texte (lu tel quel) ou base64 (pour Claude). */
export async function readFile(file: File): Promise<{ text: string } | { data: string; mediaType: string; name: string }> {
  const type = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/plain');
  if (file.size > 20_000_000) throw new ConvertError('Fichier trop lourd (20 Mo au plus).');
  if (!isConvertible(type)) return { text: await file.text() };
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: btoa(binary), mediaType: type, name: file.name };
}
