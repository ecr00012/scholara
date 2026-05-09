import type { BookChunkRow, SqlExecutor } from './types';

export type { BookChunkRow };

export interface InsertBookChunkInput {
  book_id: number;
  ordinal: number;
  position_marker: string;
  text: string;
  embedding: Float32Array;
}

function float32ToBytes(arr: Float32Array): Uint8Array {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}

export function bytesToFloat32(bytes: Uint8Array): Float32Array {
  // Tauri sql plugin may return numeric arrays; normalize.
  const buf = bytes instanceof Uint8Array
    ? bytes
    : new Uint8Array(bytes as ArrayLike<number>);
  // Copy into a fresh ArrayBuffer to ensure correct alignment.
  const aligned = new ArrayBuffer(buf.byteLength);
  new Uint8Array(aligned).set(buf);
  return new Float32Array(aligned);
}

export async function insertChunks(
  db: SqlExecutor,
  inputs: InsertBookChunkInput[],
): Promise<void> {
  for (const c of inputs) {
    await db.execute(
      `INSERT INTO book_chunks (book_id, ordinal, position_marker, text, embedding)
       VALUES (?, ?, ?, ?, ?)`,
      [c.book_id, c.ordinal, c.position_marker, c.text, float32ToBytes(c.embedding)],
    );
  }
}

export async function deleteChunksForBook(
  db: SqlExecutor,
  bookId: number,
): Promise<void> {
  await db.execute(`DELETE FROM book_chunks WHERE book_id = ?`, [bookId]);
}

export async function loadChunksForBook(
  db: SqlExecutor,
  bookId: number,
  maxOrdinal: number | null,
): Promise<BookChunkRow[]> {
  if (maxOrdinal === null) {
    return db.select<BookChunkRow>(
      `SELECT id, book_id, ordinal, position_marker, text, embedding, created_at
       FROM book_chunks
       WHERE book_id = ?
       ORDER BY ordinal ASC`,
      [bookId],
    );
  }
  return db.select<BookChunkRow>(
    `SELECT id, book_id, ordinal, position_marker, text, embedding, created_at
     FROM book_chunks
     WHERE book_id = ? AND ordinal <= ?
     ORDER BY ordinal ASC`,
    [bookId, maxOrdinal],
  );
}

export async function countChunksForBook(
  db: SqlExecutor,
  bookId: number,
): Promise<number> {
  const rows = await db.select<{ n: number }>(
    `SELECT COUNT(*) AS n FROM book_chunks WHERE book_id = ?`,
    [bookId],
  );
  return rows[0]?.n ?? 0;
}
