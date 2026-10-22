import { create } from 'zustand';

import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from '@/db/repos/settings';
import { readSharedAppearance, writeSharedAppearance } from '@/vendor/lumen';

interface SettingsState {
  settings: AppSettings;
  hydrate: () => void;
  update: (patch: Partial<AppSettings>) => void;
}

/**
 * Réglages de l'app. L'apparence est partagée avec les autres apps MyLife servies à la même adresse
 * (web) : le dernier thème choisi dans l'une est repris par les autres à leur lancement.
 */
export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  hydrate: () => {
    let settings = loadSettings();
    const shared = readSharedAppearance();
    if (shared && (shared.theme !== settings.theme || shared.followSystem !== settings.followSystem)) {
      settings = { ...settings, theme: shared.theme, followSystem: shared.followSystem };
      saveSettings(settings);
    }
    set({ settings });
  },
  update: (patch) => {
    const next = { ...get().settings, ...patch };
    saveSettings(next);
    set({ settings: next });
    if (patch.theme !== undefined || patch.followSystem !== undefined) writeSharedAppearance({ theme: next.theme, followSystem: next.followSystem });
  },
}));
