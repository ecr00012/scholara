// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../helpers/sqlite';
import * as booksDb from '../../src/db/books';
import type { SqlExecutor } from '../../src/db/types';

let db: SqlExecutor;
let bookId: number;

beforeEach(async () => {
  db = makeTestDb();
  bookId = await booksDb.insertBook(db, {
    title: 'T', author: null, file_path: '/p.epub', file_type: 'epub',
  });
});

describe('books phase 2 setters', () => {
  it('setCurrentPosition serializes JSON to current_position', async () => {
    await booksDb.setCurrentPosition(db, bookId, {
      type: 'epub', locator: 'cfi', fraction: 0.3, label: 'Ch 2',
    });
    const [b] = await booksDb.listBooks(db);
    expect(JSON.parse(b.current_position!).fraction).toBe(0.3);
  });

  it('setDisplayMode flips the column', async () => {
    await booksDb.setDisplayMode(db, bookId, 'reader');
    const [b] = await booksDb.listBooks(db);
    expect(b.display_mode).toBe('reader');
  });

  it('setLastOpened writes a non-null datetime string', async () => {
    await booksDb.setLastOpened(db, bookId);
    const [b] = await booksDb.listBooks(db);
    expect(b.last_opened).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('setEpubLocations stores the locations string', async () => {
    await booksDb.setEpubLocations(db, bookId, '["a","b","c"]');
    const [b] = await booksDb.listBooks(db);
    expect(b.epub_locations).toBe('["a","b","c"]');
  });

  it('setExtractedMetadata stamps metadata_source = extracted', async () => {
    await booksDb.setExtractedMetadata(db, bookId, {
      author: 'A', cover_image_path: '/covers/1.png',
    });
    const [b] = await booksDb.listBooks(db);
    expect(b.author).toBe('A');
    expect(b.cover_image_path).toBe('/covers/1.png');
    expect(b.metadata_source).toBe('extracted');
  });

  it('setExtractedMetadata applies title only when present in patch', async () => {
    await booksDb.setExtractedMetadata(db, bookId, { author: 'A' });
    let [b] = await booksDb.listBooks(db);
    expect(b.title).toBe('T');                   // unchanged
    await booksDb.setExtractedMetadata(db, bookId, { title: 'New', author: 'A' });
    [b] = await booksDb.listBooks(db);
    expect(b.title).toBe('New');
  });

  it('listBooksNeedingExtraction returns only filename-source rows', async () => {
    const extractedId = await booksDb.insertBook(db, {
      title: 'X', author: null, file_path: '/x.pdf', file_type: 'pdf',
    });
    await booksDb.setExtractedMetadata(db, extractedId, { author: 'A' });
    const rows = await booksDb.listBooksNeedingExtraction(db);
    expect(rows.map((r) => r.id)).toEqual([bookId]);
  });
});
