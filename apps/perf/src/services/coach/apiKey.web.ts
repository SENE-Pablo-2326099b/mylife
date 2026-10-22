import { readAiKey, writeAiKey } from '@/vendor/mylife-sync/aiKey';

/**
 * Web (PWA MyLife) : la même clé que l'assistant de MyFinances, saisie une seule fois (même adresse, même
 * stockage). L'app Android garde la sienne dans le trousseau du système.
 */
export async function loadApiKey(): Promise<string | null> {
  return readAiKey();
}

export async function saveApiKey(value: string | null): Promise<void> {
  writeAiKey(value);
}
