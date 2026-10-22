const KEY = 'myperf_anthropic_api_key';

/** Web preview: browser storage (the native app uses the OS keychain). */
export async function loadApiKey(): Promise<string | null> {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function saveApiKey(value: string | null): Promise<void> {
  try {
    if (value === null || value.trim() === '') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, value.trim());
  } catch {
    // Storage blocked: the key just won't persist.
  }
}
