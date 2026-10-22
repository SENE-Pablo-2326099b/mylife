import { create } from 'zustand';

import { Platform } from 'react-native';

import { db } from '@/db/db';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from '@/db/repos/settings';
import { readSharedAppearance, writeSharedAppearance, type SharedAppearance } from '@/vendor/lumen';

const web = Platform.OS === 'web';

/** Date du dernier choix d'apparence sur cet appareil (app Android ; sur le web, dans l'apparence commune). */
export function appearanceAt(): number {
  if (web) return readSharedAppearance()?.at ?? 0;
  return Number(db().first<{ v: string }>("SELECT v FROM sync_state WHERE k = 'appearance_at'")?.v ?? 0);
}

function stampAppearance(at: number): void {
  if (!web) db().run("INSERT INTO sync_state (k, v) VALUES ('appearance_at', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", [String(at)]);
}

interface SettingsState {
  settings: AppSettings;
  hydrate: () => void;
  update: (patch: Partial<AppSettings>) => void;
  /** Apparence choisie sur un autre appareil (synchro) : appliquée avec sa date, pas comme un nouveau choix. */
  adoptAppearance: (a: SharedAppearance) => void;
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
    if (patch.theme !== undefined || patch.followSystem !== undefined) {
      const a = writeSharedAppearance({ theme: next.theme, followSystem: next.followSystem });
      stampAppearance(a.at);
    }
  },
  adoptAppearance: (a) => {
    const next = { ...get().settings, theme: a.theme, followSystem: a.followSystem };
    saveSettings(next);
    set({ settings: next });
    writeSharedAppearance(a);
    stampAppearance(a.at);
  },
}));
