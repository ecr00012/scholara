import type { ReaderProfileRow, SqlExecutor } from './types';

export type { ReaderProfileRow };

export function bookScopeKey(bookId: number): string {
  return `book:${bookId}`;
}

export async function getProfile(
  db: SqlExecutor,
  scope: string,
): Promise<ReaderProfileRow | null> {
  const rows = await db.select<ReaderProfileRow>(
    `SELECT scope, summary, turn_count, updated_at
     FROM reader_profile WHERE scope = ?`,
    [scope],
  );
  return rows[0] ?? null;
}

export async function upsertProfile(
  db: SqlExecutor,
  row: Omit<ReaderProfileRow, 'updated_at'>,
): Promise<void> {
  await db.execute(
    `INSERT INTO reader_profile (scope, summary, turn_count, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(scope) DO UPDATE SET
       summary = excluded.summary,
       turn_count = excluded.turn_count,
       updated_at = datetime('now')`,
    [row.scope, row.summary, row.turn_count],
  );
}

export async function deleteProfile(
  db: SqlExecutor,
  scope: string,
): Promise<void> {
  await db.execute(`DELETE FROM reader_profile WHERE scope = ?`, [scope]);
}
