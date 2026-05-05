// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../helpers/sqlite';
import * as booksDb from '../../src/db/books';
import * as vocabDb from '../../src/db/vocabulary';
import type { SqlExecutor } from '../../src/db/types';

let db: SqlExecutor;
let bookId: number;

beforeEach(async () => {
  db = makeTestDb();
  bookId = await booksDb.insertBook(db, {
    title: 'Test', author: null, file_path: '/p.epub', file_type: 'epub',
  });
});

describe('vocabulary', () => {
  it('insertVocabulary + listVocabularyForBook', async () => {
    await vocabDb.insertVocabulary(db, {
      word: 'serendipity', definition: 'happy chance', book_id: bookId,
    });
    const rows = await vocabDb.listVocabularyForBook(db, bookId);
    expect(rows).toHaveLength(1);
    expect(rows[0].word).toBe('serendipity');
  });

  it('listVocabularyForBook orders by created_at DESC', async () => {
    await vocabDb.insertVocabulary(db, { word: 'a', definition: 'x', book_id: bookId });
    await vocabDb.insertVocabulary(db, { word: 'b', definition: 'y', book_id: bookId });
    const rows = await vocabDb.listVocabularyForBook(db, bookId);
    expect(rows.map((r) => r.word)).toEqual(['b', 'a']);
  });

  it('listAllVocabulary across books', async () => {
    const otherId = await booksDb.insertBook(db, {
      title: 'Other', author: null, file_path: '/q.pdf', file_type: 'pdf',
    });
    await vocabDb.insertVocabulary(db, { word: 'x', definition: '1', book_id: bookId });
    await vocabDb.insertVocabulary(db, { word: 'y', definition: '2', book_id: otherId });
    const all = await vocabDb.listAllVocabulary(db);
    expect(all).toHaveLength(2);
  });

  it('deleteVocabulary removes the row', async () => {
    const id = await vocabDb.insertVocabulary(db, {
      word: 'x', definition: 'y', book_id: bookId,
    });
    await vocabDb.deleteVocabulary(db, id);
    expect(await vocabDb.listVocabularyForBook(db, bookId)).toHaveLength(0);
  });
});
