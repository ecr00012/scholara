import { getDb } from '../db/client';
import {
  insertChunks,
  deleteChunksForBook,
  countChunksForBook,
} from '../db/bookChunks';
import { getIndexState, upsertIndexState } from '../db/bookIndexState';
import { readBookBytes } from '../ipc/files';
import { hashBytes } from '../lib/hash';
import type { Book } from '../db/types';
import { embed, EMBEDDER_INDEX_ID } from './embedder';
import { chunkSegments } from './chunker';
import { extractPdfSegments, extractEpubSegments } from './extractText';

export interface IndexProgress {
  total: number;
  done: number;
  phase: 'extracting' | 'embedding' | 'storing' | 'done';
}

export type IndexProgressCb = (p: IndexProgress) => void;
export type IndexableBook = Pick<Book, 'id' | 'file_path' | 'file_type'>;

const EMBED_BATCH = 16;

/**
 * Indexes a book if needed. No-op if status='ready' and content_hash matches.
 * Throws on failure (after marking state='failed').
 */
export async function ensureBookIndexed(
  book: IndexableBook,
  onProgress: IndexProgressCb,
  signal?: AbortSignal,
): Promise<void> {
  const db = await getDb();
  const bytes = await readBookBytes(book.file_path);
  const hash = await hashBytes(bytes);

  const existing = await getIndexState(db, book.id);
  if (
    existing?.status === 'ready' &&
    existing.content_hash === hash &&
    existing.embedder_model === EMBEDDER_INDEX_ID &&
    (existing.chunk_count ?? 0) > 0
  ) {
    onProgress({
      total: existing.chunk_count ?? 0,
      done: existing.chunk_count ?? 0,
      phase: 'done',
    });
    return;
  }

  await upsertIndexState(db, {
    book_id: book.id,
    status: 'indexing',
    chunk_count: null,
    embedder_model: EMBEDDER_INDEX_ID,
    content_hash: hash,
    error: null,
  });

  try {
    onProgress({ total: 0, done: 0, phase: 'extracting' });
    const segments =
      book.file_type === 'pdf'
        ? await extractPdfSegments(bytes)
        : await extractEpubSegments(bytes);
    if (signal?.aborted) throw new Error('aborted');

    const chunks = chunkSegments(segments);
    const total = chunks.length;
    if (total === 0) {
      throw new Error(
        `No text chunks were extracted from this ${book.file_type.toUpperCase()} book.`,
      );
    }
    onProgress({ total, done: 0, phase: 'embedding' });

    // Refresh storage in case of re-index.
    await deleteChunksForBook(db, book.id);

    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      if (signal?.aborted) throw new Error('aborted');
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const vectors = await embed(batch.map((c) => c.text));
      await insertChunks(
        db,
        batch.map((c, j) => ({
          book_id: book.id,
          ordinal: c.ordinal,
          position_marker: c.positionMarker,
          text: c.text,
          embedding: vectors[j],
        })),
      );
      onProgress({
        total,
        done: Math.min(i + batch.length, total),
        phase: 'embedding',
      });
    }

    const finalCount = await countChunksForBook(db, book.id);
    await upsertIndexState(db, {
      book_id: book.id,
      status: 'ready',
      chunk_count: finalCount,
      embedder_model: EMBEDDER_INDEX_ID,
      content_hash: hash,
      error: null,
    });
    onProgress({ total: finalCount, done: finalCount, phase: 'done' });
  } catch (err) {
    if (err instanceof Error && err.message === 'aborted') {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    await upsertIndexState(db, {
      book_id: book.id,
      status: 'failed',
      chunk_count: null,
      embedder_model: EMBEDDER_INDEX_ID,
      content_hash: hash,
      error: message,
    });
    throw err;
  }
}
