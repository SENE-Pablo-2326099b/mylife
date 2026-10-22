// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import { useSyncExternalStore } from 'react';
import { DEFAULT_APPEARANCE, parseAppearance, THEMES, readSharedAppearance, SHARED_APPEARANCE_KEY, writeSharedAppearance, type SharedAppearance } from '../vendor/lumen';

/**
 * Apparence de MyLife (thème, suivre le téléphone, animations, haptique) : une seule valeur pour toutes
 * les apps web, gardée dans le stockage partagé de l'adresse. Changée dans une app, elle s'applique aux
 * autres onglets ouverts sans recharger.
 */
export type Appearance = SharedAppearance;

const LEGACY_KEY = 'lumen-appearance';
const listeners = new Set<() => void>();
let cached: Appearance = load();

function load(): Appearance {
  const shared = readSharedAppearance();
  if (shared) return shared;
  // Ancienne copie locale de MyFinances (avant le réglage commun) : reprise une fois.
  try {
    const legacy = parseAppearance({ ...(JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null') as object), at: 0 });
    if (legacy) return legacy;
  } catch {
    /* stockage indisponible */
  }
  return DEFAULT_APPEARANCE;
}

function emit() {
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== SHARED_APPEARANCE_KEY) return;
    cached = load();
    emit();
  });
}

export function getAppearance(): Appearance {
  return cached;
}

/** Choix de l'utilisateur : enregistré pour toutes les apps et appliqué tout de suite. */
export function setAppearance(patch: Partial<Omit<Appearance, 'at'>> & { at?: number }): void {
  cached = writeSharedAppearance({ ...cached, ...patch, at: patch.at });
  emit();
}

export function subscribeAppearance(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribeAppearance, getAppearance, getAppearance);
}

/** Ce que montre la ligne « Apparence » des réglages (« Circuit », « Nuit · suit le téléphone »). */
export function useAppearanceSummary(): string {
  const a = useAppearance();
  return `${THEMES.find((t) => t.id === a.theme)?.name ?? 'Nuit'}${a.followSystem ? ' · suit le téléphone' : ''}`;
}
