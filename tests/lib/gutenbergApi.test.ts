import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyKey, fetchBooks } from '../../src/lib/gutenbergApi';

const FAKE_BOOKS = {
  results: [
    {
      id: 1,
      title: 'Pride and Prejudice',
      alternative_title: null,
      authors: [{ id: 68, name: 'Austen, Jane' }],
      subjects: ['Romance'],
      bookshelves: ['Best Books Ever Listings'],
      media_type: 'Text',
      download_count: 62904,
      issued: '1998-06-01',
      reading_ease_score: '69.20',
      cover_image:
        'https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg',
    },
  ],
};

describe('lib/gutenbergApi', () => {
  let originalFetch: typeof globalThis.fetch | undefined;
  let originalNavigator: PropertyDescriptor | undefined;
  let originalOnLine: PropertyDescriptor | undefined;

  function defineNavigatorOnline(onLine: boolean) {
    const existingNavigator = globalThis.navigator;
    if (existingNavigator) {
      Object.defineProperty(existingNavigator, 'onLine', {
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

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalNavigator = Object.getOwnPropertyDescriptor(
      globalThis,
      'navigator',
    );
    originalOnLine =
      typeof globalThis.navigator === 'undefined'
        ? undefined
        : Object.getOwnPropertyDescriptor(globalThis.navigator, 'onLine');
    defineNavigatorOnline(true);
  });

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }

    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator;
    }

    if (originalOnLine && globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, 'onLine', originalOnLine);
    }
  });

  it('verifyKey returns ok on 200', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(FAKE_BOOKS), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await verifyKey('good-key');
    expect(result.kind).toBe('ok');
  });

  it('verifyKey returns invalid-key on 401', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('unauthorized', { status: 401 }),
    ) as unknown as typeof fetch;
    const result = await verifyKey('bad-key');
    expect(result.kind).toBe('invalid-key');
  });

  it('verifyKey returns invalid-key on 403', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('forbidden', { status: 403 }),
    ) as unknown as typeof fetch;
    const result = await verifyKey('bad-key');
    expect(result.kind).toBe('invalid-key');
  });

  it('verifyKey returns api-error on 500', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch;
    const result = await verifyKey('any-key');
    expect(result).toEqual({ kind: 'api-error', status: 500 });
  });

  it('verifyKey returns offline when fetch rejects with TypeError', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const result = await verifyKey('any-key');
    expect(result.kind).toBe('offline');
  });

  it('verifyKey returns offline when navigator.onLine is false', async () => {
    defineNavigatorOnline(false);
    globalThis.fetch = vi.fn(async () =>
      new Response('{}', { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await verifyKey('any-key');
    expect(result.kind).toBe('offline');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('fetchBooks builds the right URL and forwards the API key header', async () => {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify(FAKE_BOOKS), { status: 200 }),
    );
    globalThis.fetch = spy as unknown as typeof fetch;

    const result = await fetchBooks(8, 'my-key');
    expect(result.kind).toBe('ok');

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe(
      'https://gutenbergapi.com/books?ordering=-download_count&page_size=4&offset=8',
    );
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('X-RapidAPI-Key')).toBe('my-key');
  });

  it('fetchBooks returns the books array on success', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(FAKE_BOOKS), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await fetchBooks(0, 'k');
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.books).toHaveLength(1);
    expect(result.books[0].title).toBe('Pride and Prejudice');
  });

  it('fetchBooks classifies HTTP 401 as invalid-key', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('', { status: 401 }),
    ) as unknown as typeof fetch;
    const result = await fetchBooks(0, 'k');
    expect(result.kind).toBe('invalid-key');
  });
});
