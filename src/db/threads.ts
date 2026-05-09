import type { SqlExecutor, ThreadRow, ThreadSpoilerMode } from './types';

export type { ThreadRow, ThreadSpoilerMode };

export interface InsertThreadInput {
  book_id: number;
  model: string;
  spoiler_mode?: ThreadSpoilerMode;
}

export async function insertThread(
  db: SqlExecutor,
  input: InsertThreadInput,
): Promise<number> {
  const { lastInsertId } = await db.execute(
    `INSERT INTO threads (book_id, model, spoiler_mode)
     VALUES (?, ?, ?)`,
    [input.book_id, input.model, input.spoiler_mode ?? 1],
  );
  return lastInsertId;
}

export async function listThreadsForBook(
  db: SqlExecutor,
  bookId: number,
): Promise<ThreadRow[]> {
  return db.select<ThreadRow>(
    `SELECT id, book_id, title, spoiler_mode, model, last_active_at, created_at
     FROM threads
     WHERE book_id = ?
     ORDER BY datetime(last_active_at) DESC, id DESC`,
    [bookId],
  );
}

export async function getThread(
  db: SqlExecutor,
  id: number,
): Promise<ThreadRow | null> {
  const rows = await db.select<ThreadRow>(
    `SELECT id, book_id, title, spoiler_mode, model, last_active_at, created_at
     FROM threads WHERE id = ?`,
    [id],
  );
  return rows[0] ?? null;
}

export async function updateThreadTitle(
  db: SqlExecutor,
  id: number,
  title: string,
): Promise<void> {
  await db.execute(`UPDATE threads SET title = ? WHERE id = ?`, [title, id]);
}

export async function setThreadSpoilerMode(
  db: SqlExecutor,
  id: number,
  spoilerMode: ThreadSpoilerMode,
): Promise<void> {
  await db.execute(
    `UPDATE threads SET spoiler_mode = ? WHERE id = ?`,
    [spoilerMode, id],
  );
}

export async function touchThread(db: SqlExecutor, id: number): Promise<void> {
  await db.execute(
    `UPDATE threads SET last_active_at = datetime('now') WHERE id = ?`,
    [id],
  );
}

export async function deleteThread(db: SqlExecutor, id: number): Promise<void> {
  await db.execute(`DELETE FROM threads WHERE id = ?`, [id]);
}

export async function countMessagesByThread(
  db: SqlExecutor,
  bookId: number,
): Promise<Map<number, number>> {
  const rows = await db.select<{ thread_id: number; n: number }>(
    `SELECT m.thread_id AS thread_id, COUNT(*) AS n
     FROM messages m
     JOIN threads t ON t.id = m.thread_id
     WHERE t.book_id = ?
     GROUP BY m.thread_id`,
    [bookId],
  );
  return new Map(rows.map((r) => [r.thread_id, r.n]));
}
