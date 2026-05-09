// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../helpers/sqlite';
import * as booksDb from '../../src/db/books';
import {
  insertThread,
  listThreadsForBook,
  getThread,
  updateThreadTitle,
  setThreadSpoilerMode,
  touchThread,
  deleteThread,
} from '../../src/db/threads';
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

describe('threads CRUD', () => {
  it('inserts and lists threads for a book newest-first', async () => {
    const a = await insertThread(db, { book_id: bookId, model: 'haiku' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await insertThread(db, { book_id: bookId, model: 'haiku' });
    await touchThread(db, b);
    const list = await listThreadsForBook(db, bookId);
    expect(list.map((t) => t.id)).toEqual([b, a]);
  });

  it('defaults spoiler_mode to 1', async () => {
    const id = await insertThread(db, { book_id: bookId, model: 'haiku' });
    const t = await getThread(db, id);
    expect(t?.spoiler_mode).toBe(1);
  });

  it('updates title and spoiler mode, deletes thread', async () => {
    const id = await insertThread(db, { book_id: bookId, model: 'haiku' });
    await updateThreadTitle(db, id, 'Ahab');
    await setThreadSpoilerMode(db, id, 0);
    const t = await getThread(db, id);
    expect(t?.title).toBe('Ahab');
    expect(t?.spoiler_mode).toBe(0);
    await deleteThread(db, id);
    expect(await getThread(db, id)).toBeNull();
  });
});
