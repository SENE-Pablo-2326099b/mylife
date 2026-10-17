import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';
import type { Account, Category, Rule, Settings } from './db/types';
import { DEFAULT_SETTINGS } from './domain/defaults';

const NO_CATEGORIES: Category[] = [];
const NO_RULES: Rule[] = [];
const NO_ACCOUNTS: Account[] = [];

export function useSettings(): Settings {
  return useLiveQuery(() => db.settings.get('main'), []) ?? DEFAULT_SETTINGS;
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
