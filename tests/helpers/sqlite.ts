// @vitest-environment node
import BetterSqlite3 from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SqlExecutor } from '../../src/db/types';

const MIGRATION_PATH = path.resolve(
  __dirname,
  '../../src-tauri/migrations/0001_init.sql',
);

/**
 * Returns a SqlExecutor backed by an in-memory better-sqlite3 instance with
 * the production schema migration applied and foreign keys enabled.
 */
export function makeTestDb(): SqlExecutor {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  const sql = readFileSync(MIGRATION_PATH, 'utf-8');
  db.exec(sql);

  return {
    async execute(sqlStr, params = []) {
      const stmt = db.prepare(sqlStr);
      const info = stmt.run(...(params as unknown[]));
      return {
        lastInsertId: Number(info.lastInsertRowid),
        rowsAffected: info.changes,
      };
    },
    async select<T>(sqlStr: string, params: unknown[] = []) {
      const stmt = db.prepare(sqlStr);
      return stmt.all(...(params as unknown[])) as T[];
    },
  };
}
