import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndexProgress } from '../../src/rag/index';

const { ensureBookIndexedMock } = vi.hoisted(() => ({
  ensureBookIndexedMock: vi.fn(),
}));

vi.mock('../../src/rag/index', () => ({
  ensureBookIndexed: ensureBookIndexedMock,
}));

import {
  __resetBackgroundIndexingForTests,
  getBackgroundIndexSnapshot,
  startBackgroundIndexing,
  subscribeToBackgroundIndexing,
} from '../../src/rag/backgroundIndexing';

const book = {
  id: 1,
  file_path: '/book.epub',
  file_type: 'epub' as const,
};

beforeEach(() => {
  vi.resetAllMocks();
  __resetBackgroundIndexingForTests();
});

describe('backgroundIndexing', () => {
  it('keeps indexing alive independently of subscribers', async () => {
    let reportProgress: ((progress: IndexProgress) => void) | null = null;
    ensureBookIndexedMock.mockImplementation(async (_book, onProgress) => {
      reportProgress = onProgress;
      await Promise.resolve();
      reportProgress?.({ total: 2, done: 2, phase: 'done' });
    });
    const listener = vi.fn();
    const unsubscribe = subscribeToBackgroundIndexing(book.id, listener);

    const promise = startBackgroundIndexing(book);
    unsubscribe();
    await promise;

    expect(ensureBookIndexedMock).toHaveBeenCalledTimes(1);
    expect(ensureBookIndexedMock.mock.calls[0][2]).toBeUndefined();
    expect(getBackgroundIndexSnapshot(book.id)).toEqual({
      status: 'ready',
      progress: { total: 2, done: 2, phase: 'done' },
      error: null,
    });
  });

  it('deduplicates concurrent starts for the same book', async () => {
    let resolveIndexing: (() => void) | null = null;
    ensureBookIndexedMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveIndexing = resolve;
        }),
    );

    const first = startBackgroundIndexing(book);
    const second = startBackgroundIndexing(book);
    resolveIndexing?.();
    await first;
    await second;

    expect(ensureBookIndexedMock).toHaveBeenCalledTimes(1);
  });

  it('stores errors so progress UI can retry later', async () => {
    ensureBookIndexedMock.mockRejectedValueOnce(new Error('model failed'));

    await startBackgroundIndexing(book);

    expect(getBackgroundIndexSnapshot(book.id)).toMatchObject({
      status: 'error',
      error: 'model failed',
    });
  });
});
