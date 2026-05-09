// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../helpers/sqlite';
import * as booksDb from '../../src/db/books';
import {
  insertPreference,
  listPreferences,
  deletePreference,
} from '../../src/db/preferences';
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

describe('preferences', () => {
  it('insertPreference works for global and book scopes', async () => {
    const g = await insertPreference(db, {
      scope: 'global',
      book_id: null,
      text: 'be concise',
    });
    const b = await insertPreference(db, {
      scope: 'book',
      book_id: bookId,
      text: 'use 19th-century context',
    });
    expect(g).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
  });

  it('listPreferences(null) returns only global entries', async () => {
    await insertPreference(db, {
      scope: 'global',
      book_id: null,
      text: 'g1',
    });
    await insertPreference(db, {
      scope: 'book',
      book_id: bookId,
      text: 'b1',
    });
    const rows = await listPreferences(db, null);
    expect(rows.map((r) => r.text)).toEqual(['g1']);
  });

  it('listPreferences(bookId) returns global + that book\'s book-scoped entries', async () => {
    await insertPreference(db, {
      scope: 'global',
      book_id: null,
      text: 'g1',
    });
    await insertPreference(db, {
      scope: 'book',
      book_id: bookId,
      text: 'b1',
    });
    const rows = await listPreferences(db, bookId);
    const texts = rows.map((r) => r.text).sort();
    expect(texts).toEqual(['b1', 'g1']);
  });

  it('deletePreference removes the row', async () => {
    const id = await insertPreference(db, {
      scope: 'global',
      book_id: null,
      text: 'tmp',
    });
    await deletePreference(db, id);
    expect(await listPreferences(db, null)).toHaveLength(0);
  });

  it('throws when scope=book and book_id is null', async () => {
    await expect(
      insertPreference(db, { scope: 'book', book_id: null, text: 'oops' }),
    ).rejects.toThrow();
  });
});
