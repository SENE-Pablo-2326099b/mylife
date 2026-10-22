import * as SecureStore from 'expo-secure-store';

const KEY = 'anthropic_api_key';

/** The user's Anthropic API key lives in the OS keychain / keystore, never in the database or exports. */
export async function loadApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export async function saveApiKey(value: string | null): Promise<void> {
  if (value === null || value.trim() === '') await SecureStore.deleteItemAsync(KEY);
  else await SecureStore.setItemAsync(KEY, value.trim());
}
