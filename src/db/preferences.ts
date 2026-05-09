import type { PreferenceRow, PreferenceScope, SqlExecutor } from './types';

export type { PreferenceRow, PreferenceScope };

export async function listPreferences(
  db: SqlExecutor,
  bookId: number | null,
): Promise<PreferenceRow[]> {
  // Returns global + book-scoped entries (book-scoped only when bookId provided).
  if (bookId === null) {
    return db.select<PreferenceRow>(
      `SELECT id, scope, book_id, text, created_at
       FROM preferences WHERE scope = 'global'
       ORDER BY id ASC`,
    );
  }
  return db.select<PreferenceRow>(
    `SELECT id, scope, book_id, text, created_at
     FROM preferences
     WHERE scope = 'global' OR (scope = 'book' AND book_id = ?)
     ORDER BY scope DESC, id ASC`,
    [bookId],
  );
}

export async function insertPreference(
  db: SqlExecutor,
  input: { scope: PreferenceScope; book_id: number | null; text: string },
): Promise<number> {
  if (input.scope === 'book' && input.book_id === null) {
    throw new Error('book-scoped preferences require book_id');
  }
  const { lastInsertId } = await db.execute(
    `INSERT INTO preferences (scope, book_id, text) VALUES (?, ?, ?)`,
    [input.scope, input.book_id, input.text],
  );
  return lastInsertId;
}

export async function deletePreference(
  db: SqlExecutor,
  id: number,
): Promise<void> {
  await db.execute(`DELETE FROM preferences WHERE id = ?`, [id]);
}
