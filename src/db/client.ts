import Database from '@tauri-apps/plugin-sql';
import type { SqlExecutor } from './types';

let cached: Promise<SqlExecutor> | null = null;

export function getDb(): Promise<SqlExecutor> {
  if (cached) return cached;
  cached = (async () => {
    const db = await Database.load('sqlite:scholara.db');
    await db.execute('PRAGMA foreign_keys = ON;');
    return {
      async execute(sql, params = []) {
        const result = await db.execute(sql, params);
        return {
          lastInsertId: typeof result.lastInsertId === 'number' ? result.lastInsertId : 0,
          rowsAffected: result.rowsAffected,
        };
      },
      async select<T>(sql: string, params: unknown[] = []) {
        return (await db.select<T[]>(sql, params)) as T[];
      },
    };
  })();
  return cached;
}

/** Test-only: reset the cached promise. Do not call from app code. */
export function _resetDbForTests() {
  cached = null;
}
