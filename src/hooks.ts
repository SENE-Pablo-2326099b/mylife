import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';
import type { Account, Category, Rule, Settings } from './db/types';
import { DEFAULT_SETTINGS } from './domain/defaults';

export function useSettings(): Settings {
  return useLiveQuery(() => db.settings.get('main'), []) ?? DEFAULT_SETTINGS;
}

export function useCategories(): Category[] {
  return useLiveQuery(() => db.categories.orderBy('order').toArray(), []) ?? [];
}

export function useCategoryMap(): Map<string, Category> {
  const cats = useCategories();
  return new Map(cats.map((c) => [c.id, c]));
}

export function useRules(): Rule[] {
  return useLiveQuery(() => db.rules.toArray(), []) ?? [];
}

export function useAccounts(): Account[] {
  return useLiveQuery(() => db.accounts.toArray(), []) ?? [];
}
