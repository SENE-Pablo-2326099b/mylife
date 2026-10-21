import { create } from 'zustand';

import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from '@/db/repos/settings';

interface SettingsState {
  settings: AppSettings;
  hydrate: () => void;
  update: (patch: Partial<AppSettings>) => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  hydrate: () => set({ settings: loadSettings() }),
  update: (patch) => {
    const next = { ...get().settings, ...patch };
    saveSettings(next);
    set({ settings: next });
  },
}));
