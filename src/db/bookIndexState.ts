import type { BookIndexStateRow, IndexStatus, SqlExecutor } from './types';

export type { BookIndexStateRow, IndexStatus };

export async function getIndexState(
  db: SqlExecutor,
  bookId: number,
): Promise<BookIndexStateRow | null> {
  const rows = await db.select<BookIndexStateRow>(
    `SELECT book_id, status, chunk_count, embedder_model, content_hash, error, updated_at
     FROM book_index_state WHERE book_id = ?`,
    [bookId],
  );
  return rows[0] ?? null;
}

export async function upsertIndexState(
  db: SqlExecutor,
  row: Omit<BookIndexStateRow, 'updated_at'>,
): Promise<void> {
  await db.execute(
    `INSERT INTO book_index_state
       (book_id, status, chunk_count, embedder_model, content_hash, error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(book_id) DO UPDATE SET
       status = excluded.status,
       chunk_count = excluded.chunk_count,
       embedder_model = excluded.embedder_model,
       content_hash = excluded.content_hash,
       error = excluded.error,
       updated_at = datetime('now')`,
    [
      row.book_id,
      row.status,
      row.chunk_count,
      row.embedder_model,
      row.content_hash,
      row.error,
    ],
  );
}
