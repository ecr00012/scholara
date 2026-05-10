// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/rag/embedder', () => ({
  embedOne: vi.fn(async (q: string) =>
    new Float32Array([q.includes('whale') ? 1 : 0, q.includes('whale') ? 0 : 1]),
  ),
}));
vi.mock('../../../src/db/client', () => ({
  getDb: vi.fn(),
}));
vi.mock('../../../src/db/bookChunks', () => ({
  loadChunksForBook: vi.fn(),
  bytesToFloat32: (b: Uint8Array) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4),
}));

import { searchBook } from '../../../src/agent/tools/searchBook';
import { loadChunksForBook } from '../../../src/db/bookChunks';

function vecBytes(vec: number[]): Uint8Array {
  const f = new Float32Array(vec);
  return new Uint8Array(f.buffer);
}

beforeEach(() => {
  (loadChunksForBook as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe('searchBook', () => {
  it('returns top-k by cosine score', async () => {
    (loadChunksForBook as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, ordinal: 0, position_marker: '1', text: 'whales', embedding: vecBytes([1, 0]) },
      { id: 2, ordinal: 1, position_marker: '2', text: 'flowers', embedding: vecBytes([0, 1]) },
    ]);
    const results = await searchBook({
      bookId: 1, query: 'a whale tale', k: 1,
      spoilerCap: { enabled: false, position: null, index: {} },
    });
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('whales');
  });

  it('returns indexed EPUB passages when spoiler cap is disabled', async () => {
    (loadChunksForBook as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 1,
        ordinal: 6,
        position_marker: 'chapter-7.xhtml',
        text: 'Chapter 7 has the whale passage.',
        embedding: vecBytes([1, 0]),
      },
    ]);

    const results = await searchBook({
      bookId: 1,
      query: 'whale',
      k: 6,
      spoilerCap: {
        enabled: false,
        position: { type: 'epub', locator: 'epubcfi(/6/14!/4/2)', fraction: 0.7, label: 'Chapter 7' },
        index: {},
      },
    });

    expect((loadChunksForBook as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe(1);
    expect((loadChunksForBook as unknown as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBeNull();
    expect(results).toEqual([
      expect.objectContaining({
        position_marker: 'chapter-7.xhtml',
        text: 'Chapter 7 has the whale passage.',
      }),
    ]);
  });

  it('passes maxOrdinal when spoiler cap is enabled', async () => {
    (loadChunksForBook as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await searchBook({
      bookId: 1, query: 'q', k: 6,
      spoilerCap: {
        enabled: true,
        position: { type: 'pdf', locator: 5, fraction: 0.1, label: 'p.5' },
        index: { pdf: [{ ordinal: 0, page: 1 }, { ordinal: 1, page: 5 }, { ordinal: 2, page: 10 }] },
      },
    });
    const call = (loadChunksForBook as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toBe(1); // maxOrdinal mapped from page 5
  });
});

import { TOOL_DEFS } from '../../../src/agent/tools/registry';

describe('TOOL_DEFS schema shape', () => {
  it('search_book is exposed in OpenAI ToolDef shape', () => {
    const def = TOOL_DEFS.find((d) => d.function.name === 'search_book');
    expect(def).toBeDefined();
    expect(def?.type).toBe('function');
    expect(def?.function.parameters).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    });
  });
});
