import { useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';
import type { Account, Category, Rule, Settings } from './db/types';
import { DEFAULT_SETTINGS } from './domain/defaults';
import { normalizeSettings } from './domain/settingsModel';

const NO_CATEGORIES: Category[] = [];
const NO_RULES: Rule[] = [];
const NO_ACCOUNTS: Account[] = [];

export function useSettings(): Settings {
  // Toujours complétés (champs ajoutés depuis l'enregistrement) : les écrans n'ont pas à s'en soucier.
  return useLiveQuery(async () => normalizeSettings((await db.settings.get('main')) ?? DEFAULT_SETTINGS), []) ?? DEFAULT_SETTINGS;
}

export function useCategories(): Category[] {
  return useLiveQuery(() => db.categories.orderBy('order').toArray(), []) ?? NO_CATEGORIES;
}

export function useCategoryMap(): Map<string, Category> {
  const cats = useCategories();
  return useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
}

export function useRules(): Rule[] {
  return useLiveQuery(() => db.rules.toArray(), []) ?? NO_RULES;
}

export function useAccounts(): Account[] {
  return useLiveQuery(() => db.accounts.toArray(), []) ?? NO_ACCOUNTS;
}

/** Comptes et état de lecture (pour ne pas conclure « aucun compte » avant d'avoir lu). */
export function useAccountsState(): { accounts: Account[]; loaded: boolean } {
  const raw = useLiveQuery(() => db.accounts.toArray(), []);
  return { accounts: raw ?? NO_ACCOUNTS, loaded: raw !== undefined };
}

/** Garde la dernière valeur non nulle : une feuille garde son contenu pendant qu'elle redescend. */
export function useLatest<T>(value: T | null): T | null {
  const ref = useRef(value);
  if (value !== null) ref.current = value;
  return ref.current;
}
