// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '../../src/db/types';

const {
  getDbMock,
  loadChunksForBookMock,
  readBookBytesMock,
  extractPdfSegmentsMock,
  extractEpubSegmentsMock,
  resolveEpubSectionHrefMock,
  ePubMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  loadChunksForBookMock: vi.fn(),
  readBookBytesMock: vi.fn(),
  extractPdfSegmentsMock: vi.fn(),
  extractEpubSegmentsMock: vi.fn(),
  resolveEpubSectionHrefMock: vi.fn(),
  ePubMock: vi.fn(),
}));

vi.mock('../../src/db/client', () => ({ getDb: getDbMock }));
vi.mock('../../src/db/bookChunks', () => ({
  loadChunksForBook: loadChunksForBookMock,
}));
vi.mock('../../src/ipc/files', () => ({ readBookBytes: readBookBytesMock }));
vi.mock('../../src/rag/extractText', () => ({
  extractPdfSegments: extractPdfSegmentsMock,
  extractEpubSegments: extractEpubSegmentsMock,
  resolveEpubSectionHref: resolveEpubSectionHrefMock,
}));
vi.mock('epubjs', () => ({ default: ePubMock }));

import { buildToolContext } from '../../src/screens/Reader/agentPanel/chat/toolContext';

const book: Book = {
  id: 7,
  title: 'EPUB Test',
  author: null,
  cover_image_path: null,
  file_path: '/book.epub',
  file_type: 'epub',
  last_opened: null,
  current_position: null,
  display_mode: 'agent',
  metadata_source: 'filename',
  epub_locations: null,
  created_at: '2026-05-10 00:00:00',
};

beforeEach(() => {
  vi.resetAllMocks();
  getDbMock.mockResolvedValue({});
  readBookBytesMock.mockResolvedValue(new ArrayBuffer(8));
  loadChunksForBookMock.mockResolvedValue([
    {
      id: 1,
      book_id: book.id,
      ordinal: 0,
      position_marker: 'chapter-6.xhtml',
      text: 'Chapter six indexed text',
      embedding: new Uint8Array(1536),
      created_at: '2026-05-10 00:00:00',
    },
    {
      id: 2,
      book_id: book.id,
      ordinal: 1,
      position_marker: 'chapter-7.xhtml',
      text: 'Chapter seven indexed text',
      embedding: new Uint8Array(1536),
      created_at: '2026-05-10 00:00:00',
    },
  ]);
  extractPdfSegmentsMock.mockResolvedValue([]);
  extractEpubSegmentsMock.mockResolvedValue([
    { positionMarker: 'chapter-6.xhtml', text: 'Chapter 6 page text.' },
    { positionMarker: 'chapter-7.xhtml', text: 'Chapter 7 current page text.' },
    { positionMarker: 'chapter-8.xhtml', text: 'Chapter 8 page text.' },
  ]);
  resolveEpubSectionHrefMock.mockReturnValue('chapter-7.xhtml');
  ePubMock.mockReturnValue({
    ready: Promise.resolve(),
    destroy: vi.fn(),
  });
});

describe('buildToolContext', () => {
  it('resolves EPUB current-page text through the current CFI section', async () => {
    const result = await buildToolContext(
      book,
      {
        type: 'epub',
        locator: 'epubcfi(/6/14!/4/2)',
        fraction: 0.7,
        label: 'Chapter 7',
      },
      false,
    );

    expect(resolveEpubSectionHrefMock).toHaveBeenCalledWith(
      expect.anything(),
      'epubcfi(/6/14!/4/2)',
    );
    expect(result.currentPageText).toContain('Chapter 7 current page text.');
    expect(result.toolContext.spoilerCap.enabled).toBe(false);
  });

  it('disables spoiler cap when no current position exists', async () => {
    const result = await buildToolContext(book, null, true);

    expect(result.currentPageText).toBe('');
    expect(result.toolContext.spoilerCap.enabled).toBe(false);
  });

  it('warns when indexing has no chunks or current page text is empty', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadChunksForBookMock.mockResolvedValueOnce([]);
    extractEpubSegmentsMock.mockResolvedValueOnce([]);

    await buildToolContext(
      book,
      {
        type: 'epub',
        locator: 'epubcfi(/6/14!/4/2)',
        fraction: 0.7,
        label: 'Chapter 7',
      },
      true,
    );

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no indexed chunks'));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no current page text resolved'),
    );
    warn.mockRestore();
  });
});
