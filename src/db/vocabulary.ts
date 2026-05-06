import type { VocabRow, SqlExecutor } from './types';

export type { VocabRow };

export interface InsertVocabInput {
  word: string;
  definition: string;
  book_id: number;
}

export interface InsertVocabularyResult {
  inserted: boolean;
  id?: number;
}

export async function listVocabularyForBook(
  db: SqlExecutor,
  bookId: number,
): Promise<VocabRow[]> {
  return db.select<VocabRow>(
    `SELECT id, word, definition, book_id, created_at
     FROM vocabulary
     WHERE book_id = ?
     ORDER BY datetime(created_at) DESC, id DESC`,
    [bookId],
  );
}

export async function listAllVocabulary(
  db: SqlExecutor,
): Promise<VocabRow[]> {
  return db.select<VocabRow>(
    `SELECT id, word, definition, book_id, created_at
     FROM vocabulary
     ORDER BY datetime(created_at) DESC, id DESC`,
  );
}

export async function insertVocabulary(
  db: SqlExecutor,
  input: InsertVocabInput,
): Promise<InsertVocabularyResult> {
  const result = await db.execute(
    `INSERT INTO vocabulary (word, definition, book_id)
     VALUES (?, ?, ?)
     ON CONFLICT DO NOTHING`,
    [input.word, input.definition, input.book_id],
  );
  if (result.rowsAffected === 0) {
    return { inserted: false };
  }

  return { inserted: true, id: result.lastInsertId };
}

export async function deleteVocabulary(
  db: SqlExecutor,
  id: number,
): Promise<void> {
  await db.execute(`DELETE FROM vocabulary WHERE id = ?`, [id]);
}
