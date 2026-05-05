// @vitest-environment node
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Shim a minimal browser environment for epub.js. The repo's jsdom is
// broken (html-encoding-sniffer ESM/CJS interop) so we run in node and
// install just enough DOM for epub.js's archive + parser code paths.
beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/',
  });
  // @ts-expect-error - test shim
  global.window = dom.window;
  // @ts-expect-error - test shim
  global.document = dom.window.document;
  // @ts-expect-error - test shim
  global.DOMParser = dom.window.DOMParser;
  // @ts-expect-error - test shim
  global.XMLHttpRequest = dom.window.XMLHttpRequest;
  // jsdom's Blob, but ensure URL.createObjectURL/revokeObjectURL exist.
  const blobs = new Map<string, Blob>();
  let counter = 0;
  const create = (b: Blob) => {
    const u = `blob:test/${++counter}`;
    blobs.set(u, b);
    return u;
  };
  const revoke = (u: string) => {
    blobs.delete(u);
  };
  // Install on window.URL (epub.js reads window.URL, not global URL).
  // @ts-expect-error - test shim
  dom.window.URL.createObjectURL = create;
  // @ts-expect-error - test shim
  dom.window.URL.revokeObjectURL = revoke;
  // @ts-expect-error - test shim
  global.__testBlobs = blobs;
  // Patch fetch to resolve blob: URLs against our map.
  const realFetch = global.fetch;
  // @ts-expect-error - test shim
  global.fetch = async (input: string, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('blob:test/')) {
      // @ts-expect-error - test shim
      const blob = global.__testBlobs.get(input) as Blob | undefined;
      if (!blob) throw new Error('blob not found');
      return new Response(blob);
    }
    return realFetch(input, init);
  };
});

vi.mock('../../src/ipc/files', () => ({
  saveCoverBytes: vi.fn(async (_id: number, _bytes: ArrayBuffer, ext: string) => `/covers/test.${ext}`),
}));

import { extractEpubMetadata } from '../../src/lib/epubExtract';

const SAMPLE = readFileSync(path.resolve(__dirname, '../fixtures/sample.epub'));
const NO_COVER = readFileSync(path.resolve(__dirname, '../fixtures/sample-no-cover.epub'));

beforeEach(() => vi.clearAllMocks());

describe('extractEpubMetadata', () => {
  it('extracts title, author, and cover from sample.epub', async () => {
    const ab = SAMPLE.buffer.slice(SAMPLE.byteOffset, SAMPLE.byteOffset + SAMPLE.byteLength);
    const result = await extractEpubMetadata(ab, 1);
    expect(result.title).toBe('Sample Book');
    expect(result.author).toBe('Sample Author');
    expect(result.cover_image_path).toMatch(/\/covers\/test\./);
  });

  it('returns null cover_image_path when EPUB has no cover', async () => {
    const ab = NO_COVER.buffer.slice(NO_COVER.byteOffset, NO_COVER.byteOffset + NO_COVER.byteLength);
    const result = await extractEpubMetadata(ab, 1);
    expect(result.cover_image_path).toBeNull();
  });
});
