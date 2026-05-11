import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { fetchBooks, type GutenbergBook } from '../../src/lib/gutenbergApi';
import { GUTENDEX_PAGE_SIZE } from '../../src/lib/gutendexPagination';

function makeBook(id: number): GutenbergBook {
  return {
    id,
    title: `Book ${id}`,
    authors: [{ name: `Author ${id}` }],
    subjects: [],
    bookshelves: [],
    download_count: 0,
    cover_image: null,
    issued: null,
    reading_ease_score: null,
  };
}

const PAGE_1 = Array.from({ length: GUTENDEX_PAGE_SIZE }, (_, index) => makeBook(index + 1));
const PAGE_2 = Array.from({ length: GUTENDEX_PAGE_SIZE }, (_, index) => makeBook(index + 33));

function defineNavigatorOnline(onLine: boolean) {
  const existing = globalThis.navigator;
  if (existing) {
    Object.defineProperty(existing, 'onLine', {
      configurable: true,
      get: () => onLine,
    });
    return;
  }

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine },
  });
}

describe('lib/gutenbergApi.fetchBooks', () => {
  let originalNavigator: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    defineNavigatorOnline(true);
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator;
    }
  });

  it('returns offline before issuing a call when navigator is offline', async () => {
    defineNavigatorOnline(false);
    const result = await fetchBooks(0);
    expect(result.kind).toBe('offline');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('issues one page call for in-page windows and returns 4 books', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ books: PAGE_1 });
    const result = await fetchBooks(8);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('fetch_gutendex_page', { page: 1 });
    expect(result.books.map((book) => book.id)).toEqual([9, 10, 11, 12]);
  });

  it('crosses to the next page when the window straddles', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ books: PAGE_1 })
      .mockResolvedValueOnce({ books: PAGE_2 });
    const result = await fetchBooks(30);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(1, 'fetch_gutendex_page', {
      page: 1,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'fetch_gutendex_page', {
      page: 2,
    });
    expect(result.books.map((book) => book.id)).toEqual([31, 32, 33, 34]);
  });

  it('maps cursor 396 to page 13', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ books: PAGE_1 });
    await fetchBooks(396);
    expect(invoke).toHaveBeenCalledWith('fetch_gutendex_page', { page: 13 });
  });

  it("classifies the Rust 'network:' error prefix as offline", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('network: dns failure'));
    const result = await fetchBooks(0);
    expect(result.kind).toBe('offline');
  });

  it("classifies the Rust 'server:' error prefix as api-error", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('server: HTTP 503'));
    const result = await fetchBooks(0);
    expect(result.kind).toBe('api-error');
  });

  it("classifies 'decode:' errors as api-error", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('decode: bad json'));
    const result = await fetchBooks(0);
    expect(result.kind).toBe('api-error');
  });
});
