// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../helpers/sqlite';
import * as booksDb from '../../src/db/books';
import {
  insertChunks,
  countChunksForBook,
  loadChunksForBook,
  deleteChunksForBook,
  bytesToFloat32,
} from '../../src/db/bookChunks';
import type { SqlExecutor } from '../../src/db/types';

let db: SqlExecutor;
let bookId: number;

beforeEach(async () => {
  db = makeTestDb();
  bookId = await booksDb.insertBook(db, {
    title: 'Test',
    author: null,
    file_path: '/p.epub',
    file_type: 'epub',
  });
});

function makeEmbedding(seed: number): Float32Array {
  const arr = new Float32Array(384);
  for (let i = 0; i < 384; i++) {
    arr[i] = Math.sin(seed * 0.1 + i * 0.01);
  }
  return arr;
}

describe('bookChunks', () => {
  it('insertChunks inserts multiple in one call; countChunksForBook reports total', async () => {
    await insertChunks(db, [
      {
        book_id: bookId,
        ordinal: 0,
        position_marker: '{}',
        text: 'a',
        embedding: makeEmbedding(0),
      },
      {
        book_id: bookId,
        ordinal: 1,
        position_marker: '{}',
        text: 'b',
        embedding: makeEmbedding(1),
      },
      {
        book_id: bookId,
        ordinal: 2,
        position_marker: '{}',
        text: 'c',
        embedding: makeEmbedding(2),
      },
    ]);
    expect(await countChunksForBook(db, bookId)).toBe(3);
  });

  it('loadChunksForBook(maxOrdinal=null) returns all in ordinal order', async () => {
    await insertChunks(db, [
      {
        book_id: bookId,
        ordinal: 2,
        position_marker: '{}',
        text: 'c',
        embedding: makeEmbedding(2),
      },
      {
        book_id: bookId,
        ordinal: 0,
        position_marker: '{}',
        text: 'a',
        embedding: makeEmbedding(0),
      },
      {
        book_id: bookId,
        ordinal: 1,
        position_marker: '{}',
        text: 'b',
        embedding: makeEmbedding(1),
      },
    ]);
    const rows = await loadChunksForBook(db, bookId, null);
    expect(rows.map((r) => r.text)).toEqual(['a', 'b', 'c']);
  });

  it('loadChunksForBook(maxOrdinal=N) filters by ordinal <= N', async () => {
    await insertChunks(db, [
      {
        book_id: bookId,
        ordinal: 0,
        position_marker: '{}',
        text: 'a',
        embedding: makeEmbedding(0),
      },
      {
        book_id: bookId,
        ordinal: 1,
        position_marker: '{}',
        text: 'b',
        embedding: makeEmbedding(1),
      },
      {
        book_id: bookId,
        ordinal: 2,
        position_marker: '{}',
        text: 'c',
        embedding: makeEmbedding(2),
      },
    ]);
    const rows = await loadChunksForBook(db, bookId, 1);
    expect(rows.map((r) => r.ordinal)).toEqual([0, 1]);
  });

  it('deleteChunksForBook removes all rows for that book', async () => {
    await insertChunks(db, [
      {
        book_id: bookId,
        ordinal: 0,
        position_marker: '{}',
        text: 'a',
        embedding: makeEmbedding(0),
      },
    ]);
    await deleteChunksForBook(db, bookId);
    expect(await countChunksForBook(db, bookId)).toBe(0);
  });

  it('round-trips a Float32Array embedding through insert + load + bytesToFloat32', async () => {
    const original = new Float32Array(384);
    for (let i = 0; i < 384; i++) {
      original[i] = (i % 7) * 0.1 - 0.2 + (i * 0.001);
    }
    await insertChunks(db, [
      {
        book_id: bookId,
        ordinal: 0,
        position_marker: '{}',
        text: 'a',
        embedding: original,
      },
    ]);
    const rows = await loadChunksForBook(db, bookId, null);
    const restored = bytesToFloat32(rows[0].embedding);
    expect(restored.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBe(original[i]);
    }
  });
});
