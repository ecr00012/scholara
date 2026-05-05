import type { NoteRow, SqlExecutor } from './types';

export type { NoteRow };

export interface InsertNoteInput {
  book_id: number;
  page_or_position: string;
  note_text: string | null;
  quote_text: string | null;
}

export async function listNotesForBook(
  db: SqlExecutor,
  bookId: number,
): Promise<NoteRow[]> {
  return db.select<NoteRow>(
    `SELECT id, book_id, page_or_position, note_text, quote_text, created_at
     FROM notes
     WHERE book_id = ?
     ORDER BY datetime(created_at) ASC, id ASC`,
    [bookId],
  );
}

export async function insertNote(
  db: SqlExecutor,
  input: InsertNoteInput,
): Promise<number> {
  const result = await db.execute(
    `INSERT INTO notes (book_id, page_or_position, note_text, quote_text)
     VALUES (?, ?, ?, ?)`,
    [input.book_id, input.page_or_position, input.note_text, input.quote_text],
  );
  return result.lastInsertId;
}

export async function deleteNote(db: SqlExecutor, id: number): Promise<void> {
  await db.execute(`DELETE FROM notes WHERE id = ?`, [id]);
}
