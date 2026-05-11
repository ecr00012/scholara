import type { BookChunkRow, SqlExecutor } from './types';

export type { BookChunkRow };

export interface InsertBookChunkInput {
  book_id: number;
  ordinal: number;
  position_marker: string;
  text: string;
  embedding: Float32Array;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function float32ToStorage(arr: Float32Array): string {
  return bytesToBase64(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
}

export function bytesToFloat32(bytes: Uint8Array | number[] | ArrayBuffer | string): Float32Array {
  // Tauri sql plugin binds values through JSON, so embeddings are stored as
  // base64 text. Keep accepting real byte containers for tests/legacy rows.
  const buf =
    typeof bytes === 'string'
      ? base64ToBytes(bytes)
      : bytes instanceof Uint8Array
      ? bytes
      : bytes instanceof ArrayBuffer
        ? new Uint8Array(bytes)
        : new Uint8Array(bytes);
  if (buf.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error(
      `invalid embedding byte length: ${buf.byteLength} is not divisible by ${Float32Array.BYTES_PER_ELEMENT}`,
    );
  }
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
      [c.book_id, c.ordinal, c.position_marker, c.text, float32ToStorage(c.embedding)],
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
