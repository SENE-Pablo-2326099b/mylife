/**
 * Le contrat de base de données de MyPerf : synchrone, comme dans l'app d'avant. Il ne vit que dans le Worker (où
 * SQLite tourne, fichier persistant dans le système de fichiers privé du navigateur) et dans les tests (même SQLite, en
 * mémoire) : l'écran ne parle qu'au Worker, par messages.
 */
export type SqlValue = string | number | null;

export interface Db {
  run(sql: string, params?: readonly SqlValue[]): void;
  all<T>(sql: string, params?: readonly SqlValue[]): T[];
  first<T>(sql: string, params?: readonly SqlValue[]): T | null;
  exec(sql: string): void;
  transaction(fn: () => void): void;
}

/** Ce que l'adaptateur attend d'une base SQLite WebAssembly (`sqlite3.oo1.DB`). */
export interface Oo1Db {
  exec(opts: { sql: string; bind?: SqlValue[]; rowMode?: 'object'; returnValue?: 'resultRows' }): unknown;
  exec(sql: string): unknown;
  selectObjects(sql: string, bind?: SqlValue[]): Record<string, unknown>[];
  selectObject(sql: string, bind?: SqlValue[]): Record<string, unknown> | undefined;
  transaction(fn: () => void): unknown;
}

/** Une base SQLite WebAssembly derrière le contrat synchrone. Transactions imbriquées : jointes à la plus haute. */
export function wrapOo1(raw: Oo1Db): Db {
  let depth = 0;
  // SQLite WebAssembly refuse des paramètres (même vides) pour une requête qui n'en a pas.
  const bind = (params: readonly SqlValue[]) => (params.length ? [...params] : undefined);
  return {
    run: (sql, params = []) => void raw.exec({ sql, bind: bind(params) }),
    all: <T>(sql: string, params: readonly SqlValue[] = []) => raw.selectObjects(sql, bind(params)) as T[],
    first: <T>(sql: string, params: readonly SqlValue[] = []) => (raw.selectObject(sql, bind(params)) as T | undefined) ?? null,
    exec: (sql) => void raw.exec(sql),
    transaction(fn) {
      if (depth > 0) return fn();
      depth += 1;
      try {
        raw.transaction(fn);
      } finally {
        depth -= 1;
      }
    },
  };
}

export const newId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
