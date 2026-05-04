import type { Book, FileType, SqlExecutor } from './types';

export interface InsertBookInput {
  title: string;
  author: string | null;
  file_path: string;
  file_type: FileType;
}

export interface UpdateMetadataInput {
  title: string;
  author: string | null;
}

export async function listBooks(db: SqlExecutor): Promise<Book[]> {
  return db.select<Book>(
    `SELECT id, title, author, cover_image_path, file_path, file_type,
            last_opened, current_position, display_mode, metadata_source,
            created_at
     FROM books
     ORDER BY datetime(created_at) DESC, id DESC`,
  );
}

export async function insertBook(
  db: SqlExecutor,
  input: InsertBookInput,
): Promise<number> {
  const result = await db.execute(
    `INSERT INTO books (title, author, file_path, file_type, metadata_source)
     VALUES (?, ?, ?, ?, 'filename')`,
    [input.title, input.author, input.file_path, input.file_type],
  );
  return result.lastInsertId;
}

export async function updateMetadata(
  db: SqlExecutor,
  id: number,
  patch: UpdateMetadataInput,
): Promise<void> {
  await db.execute(
    `UPDATE books
     SET title = ?, author = ?, metadata_source = 'user'
     WHERE id = ?`,
    [patch.title, patch.author, id],
  );
}

export async function deleteBook(db: SqlExecutor, id: number): Promise<void> {
  await db.execute(`DELETE FROM books WHERE id = ?`, [id]);
}
