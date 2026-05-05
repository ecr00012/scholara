import type { Position } from '../lib/positionShape';
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
            epub_locations, created_at
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

export async function setCurrentPosition(
  db: SqlExecutor,
  id: number,
  position: Position,
): Promise<void> {
  await db.execute(
    `UPDATE books SET current_position = ? WHERE id = ?`,
    [JSON.stringify(position), id],
  );
}

export async function setDisplayMode(
  db: SqlExecutor,
  id: number,
  mode: 'agent' | 'reader',
): Promise<void> {
  await db.execute(
    `UPDATE books SET display_mode = ? WHERE id = ?`,
    [mode, id],
  );
}

export async function setLastOpened(
  db: SqlExecutor,
  id: number,
): Promise<void> {
  await db.execute(
    `UPDATE books SET last_opened = datetime('now') WHERE id = ?`,
    [id],
  );
}

export async function setEpubLocations(
  db: SqlExecutor,
  id: number,
  locations: string,
): Promise<void> {
  await db.execute(
    `UPDATE books SET epub_locations = ? WHERE id = ?`,
    [locations, id],
  );
}

export interface ExtractedMetadataPatch {
  title?: string;
  author?: string | null;
  cover_image_path?: string | null;
}

export async function setExtractedMetadata(
  db: SqlExecutor,
  id: number,
  patch: ExtractedMetadataPatch,
): Promise<void> {
  const sets: string[] = [`metadata_source = 'extracted'`];
  const params: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    params.push(patch.title);
  }
  if (patch.author !== undefined) {
    sets.push('author = ?');
    params.push(patch.author);
  }
  if (patch.cover_image_path !== undefined) {
    sets.push('cover_image_path = ?');
    params.push(patch.cover_image_path);
  }
  params.push(id);
  await db.execute(`UPDATE books SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function listBooksNeedingExtraction(
  db: SqlExecutor,
): Promise<Book[]> {
  return db.select<Book>(
    `SELECT id, title, author, cover_image_path, file_path, file_type,
            last_opened, current_position, display_mode, metadata_source,
            epub_locations, created_at
     FROM books
     WHERE metadata_source = 'filename'
     ORDER BY id ASC`,
  );
}
