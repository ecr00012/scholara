// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { makeTestDb } from '../helpers/sqlite';
import {
  listBooks,
  insertBook,
  updateMetadata,
  deleteBook,
} from '../../src/db/books';

describe('db/books', () => {
  it('inserts a book with filename metadata source by default', async () => {
    const db = makeTestDb();
    const id = await insertBook(db, {
      title: 'War And Peace',
      author: null,
      file_path: '/data/wp.pdf',
      file_type: 'pdf',
    });
    expect(id).toBeGreaterThan(0);

    const rows = await listBooks(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      title: 'War And Peace',
      author: null,
      file_path: '/data/wp.pdf',
      file_type: 'pdf',
      display_mode: 'agent',
      metadata_source: 'filename',
    });
    expect(rows[0].created_at).toBeTruthy();
  });

  it('lists books most-recent-first', async () => {
    const db = makeTestDb();
    await insertBook(db, {
      title: 'Older',
      author: null,
      file_path: '/a.pdf',
      file_type: 'pdf',
    });
    await new Promise((r) => setTimeout(r, 1100)); // ensure created_at differs (sec-level granularity)
    await insertBook(db, {
      title: 'Newer',
      author: null,
      file_path: '/b.pdf',
      file_type: 'pdf',
    });

    const rows = await listBooks(db);
    expect(rows.map((r) => r.title)).toEqual(['Newer', 'Older']);
  });

  it('updates title/author and stamps metadata_source = user', async () => {
    const db = makeTestDb();
    const id = await insertBook(db, {
      title: 'Old Title',
      author: null,
      file_path: '/c.pdf',
      file_type: 'pdf',
    });

    await updateMetadata(db, id, { title: 'New Title', author: 'Jane Doe' });

    const rows = await listBooks(db);
    expect(rows[0]).toMatchObject({
      title: 'New Title',
      author: 'Jane Doe',
      metadata_source: 'user',
    });
  });

  it('deletes a book by id', async () => {
    const db = makeTestDb();
    const id = await insertBook(db, {
      title: 'Delete Me',
      author: null,
      file_path: '/d.pdf',
      file_type: 'pdf',
    });

    await deleteBook(db, id);

    const rows = await listBooks(db);
    expect(rows).toHaveLength(0);
  });

  it('rejects duplicate file_path', async () => {
    const db = makeTestDb();
    await insertBook(db, {
      title: 'A',
      author: null,
      file_path: '/same.pdf',
      file_type: 'pdf',
    });
    await expect(
      insertBook(db, {
        title: 'B',
        author: null,
        file_path: '/same.pdf',
        file_type: 'pdf',
      }),
    ).rejects.toThrow();
  });
});
