import { useIsFocused } from 'expo-router';
import { useCallback, useState, useSyncExternalStore } from 'react';

import { dataVersion, subscribeData } from '@/db/db';

type Dep = string | number | boolean | null | undefined;

const noop = () => () => {};

/**
 * Runs a synchronous DB query and re-runs it when data changes — but only while the screen is
 * focused. Background tabs don't re-query on every keystroke of the logging screen; they catch
 * up once when they come back into focus. `deps` are the query's own inputs (primitives).
 */
export function useLive<T>(query: () => T, deps: readonly Dep[]): T {
  // Reads external mutable state (the DB) during render on purpose: the React Compiler must not
  // memoise `query()` on the closure identity, or new data would never show up.
  'use no memo';
  const focused = useIsFocused();
  const subscribe = useCallback((cb: () => void) => (focused ? subscribeData(cb) : noop()), [focused]);
  const version = useSyncExternalStore(subscribe, dataVersion);
  const key = `${version}|${deps.map(String).join('|')}`;
  const [cache, setCache] = useState<{ key: string; value: T } | null>(null);

  if (cache !== null && cache.key === key) return cache.value;
  // Derived-state pattern: recompute during render when inputs changed (no effect, no extra frame).
  const value = query();
  setCache({ key, value });
  return value;
}
