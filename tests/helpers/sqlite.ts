// @vitest-environment node
import BetterSqlite3 from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SqlExecutor } from '../../src/db/types';

const MIGRATIONS = ['0001_init.sql', '0002_phase2.sql', '0003_vocab_unique.sql'].map((f) =>
  path.resolve(__dirname, '../../src-tauri/migrations', f),
);

/**
 * Returns a SqlExecutor backed by an in-memory better-sqlite3 instance with
 * the production schema migrations applied and foreign keys enabled.
 */
export function makeTestDb(): SqlExecutor {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  for (const mig of MIGRATIONS) {
    db.exec(readFileSync(mig, 'utf-8'));
  }

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
