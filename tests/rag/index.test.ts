// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '../../src/db/types';

const {
  getDbMock,
  readBookBytesMock,
  hashBytesMock,
  getIndexStateMock,
  upsertIndexStateMock,
  deleteChunksForBookMock,
  insertChunksMock,
  countChunksForBookMock,
  extractEpubSegmentsMock,
  extractPdfSegmentsMock,
  chunkSegmentsMock,
  embedForIndexingMock,
  yieldToUiMock,
  waitForIndexingIdleMock,
  throwIfAbortedMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  readBookBytesMock: vi.fn(),
  hashBytesMock: vi.fn(),
  getIndexStateMock: vi.fn(),
  upsertIndexStateMock: vi.fn(),
  deleteChunksForBookMock: vi.fn(),
  insertChunksMock: vi.fn(),
  countChunksForBookMock: vi.fn(),
  extractEpubSegmentsMock: vi.fn(),
  extractPdfSegmentsMock: vi.fn(),
  chunkSegmentsMock: vi.fn(),
  embedForIndexingMock: vi.fn(),
  yieldToUiMock: vi.fn(),
  waitForIndexingIdleMock: vi.fn(),
  throwIfAbortedMock: vi.fn((signal?: AbortSignal) => {
    if (signal?.aborted) throw new Error('aborted');
  }),
}));

vi.mock('../../src/db/client', () => ({ getDb: getDbMock }));
vi.mock('../../src/ipc/files', () => ({ readBookBytes: readBookBytesMock }));
vi.mock('../../src/lib/hash', () => ({ hashBytes: hashBytesMock }));
vi.mock('../../src/db/bookIndexState', () => ({
  getIndexState: getIndexStateMock,
  upsertIndexState: upsertIndexStateMock,
}));
vi.mock('../../src/db/bookChunks', () => ({
  deleteChunksForBook: deleteChunksForBookMock,
  insertChunks: insertChunksMock,
  countChunksForBook: countChunksForBookMock,
}));
vi.mock('../../src/rag/extractText', () => ({
  extractEpubSegments: extractEpubSegmentsMock,
  extractPdfSegments: extractPdfSegmentsMock,
}));
vi.mock('../../src/rag/chunker', () => ({ chunkSegments: chunkSegmentsMock }));
vi.mock('../../src/rag/embedder', () => ({
  EMBEDDER_MODEL_ID: 'Xenova/all-MiniLM-L6-v2',
  EMBEDDER_INDEX_ID: 'Xenova/all-MiniLM-L6-v2:base64-embeddings-v1',
}));
vi.mock('../../src/rag/embedForIndexing', () => ({
  embedForIndexing: embedForIndexingMock,
}));
vi.mock('../../src/rag/scheduler', () => ({
  yieldToUi: yieldToUiMock,
  waitForIndexingIdle: waitForIndexingIdleMock,
  throwIfAborted: throwIfAbortedMock,
}));

import { ensureBookIndexed } from '../../src/rag/index';

const book: Book = {
  id: 1,
  title: 'Indexed EPUB',
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
  hashBytesMock.mockResolvedValue('hash');
  getIndexStateMock.mockResolvedValue(null);
  upsertIndexStateMock.mockResolvedValue(undefined);
  deleteChunksForBookMock.mockResolvedValue(undefined);
  insertChunksMock.mockResolvedValue(undefined);
  countChunksForBookMock.mockResolvedValue(1);
  extractEpubSegmentsMock.mockResolvedValue([
    { positionMarker: 'chapter-7.xhtml', text: 'Chapter 7 text.' },
  ]);
  extractPdfSegmentsMock.mockResolvedValue([]);
  chunkSegmentsMock.mockReturnValue([
    { ordinal: 0, positionMarker: 'chapter-7.xhtml', text: 'Chapter 7 text.' },
  ]);
  embedForIndexingMock.mockResolvedValue([new Float32Array(384)]);
  yieldToUiMock.mockResolvedValue(undefined);
  waitForIndexingIdleMock.mockResolvedValue(undefined);
});

describe('ensureBookIndexed', () => {
  it('does not treat a ready zero-chunk EPUB index as valid', async () => {
    getIndexStateMock.mockResolvedValueOnce({
      book_id: book.id,
      status: 'ready',
      chunk_count: 0,
      embedder_model: 'Xenova/all-MiniLM-L6-v2',
      content_hash: 'hash',
      error: null,
      updated_at: '2026-05-10 00:00:00',
    });
    const onProgress = vi.fn();

    await ensureBookIndexed(book, onProgress);

    expect(extractEpubSegmentsMock).toHaveBeenCalledTimes(1);
    expect(deleteChunksForBookMock).toHaveBeenCalledWith(expect.anything(), book.id);
    expect(insertChunksMock).toHaveBeenCalledWith(
      expect.anything(),
      [
        expect.objectContaining({
          book_id: book.id,
          position_marker: 'chapter-7.xhtml',
          text: 'Chapter 7 text.',
        }),
      ],
    );
    expect(upsertIndexStateMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        book_id: book.id,
        status: 'ready',
        chunk_count: 1,
      }),
    );
  });

  it('fails instead of marking an empty extraction as ready', async () => {
    extractEpubSegmentsMock.mockResolvedValueOnce([]);
    chunkSegmentsMock.mockReturnValueOnce([]);
    const onProgress = vi.fn();

    await expect(ensureBookIndexed(book, onProgress)).rejects.toThrow(
      'No text chunks were extracted',
    );

    expect(deleteChunksForBookMock).not.toHaveBeenCalled();
    expect(insertChunksMock).not.toHaveBeenCalled();
    expect(upsertIndexStateMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        book_id: book.id,
        status: 'failed',
        chunk_count: null,
        error: expect.stringContaining('No text chunks were extracted'),
      }),
    );
  });

  it('does not record cancelled indexing as a failed index', async () => {
    const controller = new AbortController();
    extractEpubSegmentsMock.mockImplementationOnce(async () => {
      controller.abort();
      return [{ positionMarker: 'chapter-7.xhtml', text: 'Chapter 7 text.' }];
    });
    const onProgress = vi.fn();

    await expect(
      ensureBookIndexed(book, onProgress, controller.signal),
    ).rejects.toThrow('aborted');

    expect(deleteChunksForBookMock).not.toHaveBeenCalled();
    expect(insertChunksMock).not.toHaveBeenCalled();
    expect(upsertIndexStateMock).toHaveBeenCalledTimes(1);
    expect(upsertIndexStateMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        book_id: book.id,
        status: 'indexing',
        error: null,
      }),
    );
  });

  it('yields and checks idle between embedding batches', async () => {
    chunkSegmentsMock.mockReturnValue(
      Array.from({ length: 17 }, (_, i) => ({
        ordinal: i,
        positionMarker: `p${i + 1}`,
        text: `Chunk ${i + 1}`,
      })),
    );
    embedForIndexingMock.mockImplementation(async (texts: string[]) =>
      texts.map(() => new Float32Array(384)),
    );
    countChunksForBookMock.mockResolvedValueOnce(17);
    const onProgress = vi.fn();

    await ensureBookIndexed(book, onProgress);

    expect(embedForIndexingMock).toHaveBeenCalledTimes(3);
    expect(waitForIndexingIdleMock).toHaveBeenCalledTimes(3);
    expect(yieldToUiMock).toHaveBeenCalledTimes(3);
    expect(insertChunksMock).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenCalledWith({
      total: 17,
      done: 17,
      phase: 'embedding',
    });
  });
});
