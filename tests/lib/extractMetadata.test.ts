// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeTestDb } from '../helpers/sqlite';
import * as booksDb from '../../src/db/books';
import { runMetadataExtractionPass } from '../../src/lib/extractMetadata';

vi.mock('../../src/ipc/files', () => ({
  readBookBytes: vi.fn(async () => new ArrayBuffer(8)),
}));
vi.mock('../../src/lib/epubExtract', () => ({
  extractEpubMetadata: vi.fn(async () => ({ author: 'A', cover_image_path: '/c.png' })),
}));
vi.mock('../../src/lib/pdfExtract', () => ({
  extractPdfMetadata: vi.fn(async () => ({ author: 'B', cover_image_path: '/d.png' })),
}));

vi.mock('../../src/db/client', async () => {
  const { makeTestDb } = await import('../helpers/sqlite');
  const shared = makeTestDb();
  return { getDb: vi.fn(async () => shared), _resetDbForTests: vi.fn() };
});

describe('runMetadataExtractionPass', () => {
  beforeEach(() => vi.clearAllMocks());

  it('processes only filename-source rows and stamps extracted', async () => {
    const { getDb } = await import('../../src/db/client');
    const db = await getDb();
    const idA = await booksDb.insertBook(db, { title: 'A', author: null, file_path: '/a.epub', file_type: 'epub' });
    const idB = await booksDb.insertBook(db, { title: 'B', author: null, file_path: '/b.pdf',  file_type: 'pdf'  });
    const idC = await booksDb.insertBook(db, { title: 'C', author: null, file_path: '/c.epub', file_type: 'epub' });
    await booksDb.setExtractedMetadata(db, idC, { author: 'X' });   // already done

    const patches: Array<{ id: number; patch: object }> = [];
    const fakeStore = {
      extractionInFlight: new Set<number>(),
      patchBook: (id: number, patch: object) => patches.push({ id, patch }),
    };

    await runMetadataExtractionPass(fakeStore);

    expect(patches.map((p) => p.id).sort()).toEqual([idA, idB].sort());
    const list = await booksDb.listBooks(db);
    expect(list.find((b) => b.id === idA)!.metadata_source).toBe('extracted');
    expect(list.find((b) => b.id === idB)!.metadata_source).toBe('extracted');
    expect(list.find((b) => b.id === idC)!.author).toBe('X');
  });

  it('skips a book whose id is in extractionInFlight', async () => {
    const { getDb } = await import('../../src/db/client');
    const db = await getDb();
    // (db now has 3 rows from prior test if module-level state persists; isolate by relying on inFlight)
    const inFlight = new Set<number>();
    const list = await booksDb.listBooksNeedingExtraction(db);
    if (list.length > 0) inFlight.add(list[0].id);
    const patches: number[] = [];
    await runMetadataExtractionPass({
      extractionInFlight: inFlight,
      patchBook: (id) => patches.push(id),
    });
    expect(patches).not.toContain(list[0]?.id);
  });

  it('swallows extractor errors without stamping', async () => {
    const epubExtract = await import('../../src/lib/epubExtract');
    (epubExtract.extractEpubMetadata as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('boom'));
    const { getDb } = await import('../../src/db/client');
    const db = await getDb();
    const id = await booksDb.insertBook(db, { title: 'D', author: null, file_path: '/d.epub', file_type: 'epub' });
    await runMetadataExtractionPass({ extractionInFlight: new Set(), patchBook: () => {} });
    const [row] = (await booksDb.listBooks(db)).filter((b) => b.id === id);
    expect(row.metadata_source).toBe('filename');   // unchanged
  });
});
