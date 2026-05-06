// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../helpers/sqlite';
import * as booksDb from '../../src/db/books';
import * as notesDb from '../../src/db/notes';
import type { SqlExecutor } from '../../src/db/types';

let db: SqlExecutor;
let bookId: number;

beforeEach(async () => {
  db = makeTestDb();
  bookId = await booksDb.insertBook(db, {
    title: 'Test', author: null, file_path: '/p.epub', file_type: 'epub',
  });
});

describe('notes', () => {
  it('insertNote + listNotesForBook returns the row', async () => {
    const id = await notesDb.insertNote(db, {
      book_id: bookId,
      page_or_position: '{"type":"pdf","locator":1,"fraction":0,"label":"Page 1"}',
      note_text: 'hello',
      quote_text: null,
    });
    expect(id).toBeGreaterThan(0);
    const rows = await notesDb.listNotesForBook(db, bookId);
    expect(rows).toHaveLength(1);
    expect(rows[0].note_text).toBe('hello');
    expect(rows[0].quote_text).toBeNull();
  });

  it('insertNote rejects when both note_text and quote_text are null', async () => {
    await expect(
      notesDb.insertNote(db, {
        book_id: bookId,
        page_or_position: '{}',
        note_text: null,
        quote_text: null,
      }),
    ).rejects.toThrow();
  });

  it('listNotesForBook orders by created_at DESC then id DESC', async () => {
    await notesDb.insertNote(db, {
      book_id: bookId, page_or_position: '{}', note_text: 'a', quote_text: null,
    });
    await notesDb.insertNote(db, {
      book_id: bookId, page_or_position: '{}', note_text: 'b', quote_text: null,
    });
    const rows = await notesDb.listNotesForBook(db, bookId);
    expect(rows.map((r) => r.note_text)).toEqual(['b', 'a']);
  });

  it('deleteNote removes the row', async () => {
    const id = await notesDb.insertNote(db, {
      book_id: bookId, page_or_position: '{}', note_text: 'x', quote_text: null,
    });
    await notesDb.deleteNote(db, id);
    expect(await notesDb.listNotesForBook(db, bookId)).toHaveLength(0);
  });
});
