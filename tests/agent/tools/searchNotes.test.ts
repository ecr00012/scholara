// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/rag/embedder', () => ({
  embed: vi.fn(async (texts: string[]) =>
    texts.map((t) => new Float32Array([t.includes('whale') ? 1 : 0, t.includes('whale') ? 0 : 1])),
  ),
  embedOne: vi.fn(async (q: string) =>
    new Float32Array([q.includes('whale') ? 1 : 0, q.includes('whale') ? 0 : 1]),
  ),
}));
vi.mock('../../../src/db/client', () => ({ getDb: vi.fn() }));
vi.mock('../../../src/db/notes', () => ({
  listNotesForBook: vi.fn(async () => [
    { id: 1, book_id: 1, page_or_position: 'p.10', note_text: 'about whales', quote_text: null, created_at: '' },
    { id: 2, book_id: 1, page_or_position: 'p.20', note_text: 'flowers everywhere', quote_text: null, created_at: '' },
  ]),
}));
vi.mock('../../../src/db/vocabulary', () => ({
  listVocabularyForBook: vi.fn(async () => []),
}));

import { searchNotes, invalidateNoteCache } from '../../../src/agent/tools/searchNotes';
import { listNotesForBook } from '../../../src/db/notes';

beforeEach(() => {
  invalidateNoteCache(1);
  (listNotesForBook as ReturnType<typeof vi.fn>).mockClear();
});

describe('searchNotes', () => {
  it('returns the most relevant note for a query', async () => {
    const out = await searchNotes({ bookId: 1, query: 'whale lore', k: 1 });
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('about whales');
    expect(out[0].kind).toBe('note');
  });

  it('caches per book; invalidateNoteCache forces a rebuild', async () => {
    const { listNotesForBook } = await import('../../../src/db/notes');
    await searchNotes({ bookId: 1, query: 'q' });
    await searchNotes({ bookId: 1, query: 'q' });
    expect((listNotesForBook as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    invalidateNoteCache(1);
    await searchNotes({ bookId: 1, query: 'q' });
    expect((listNotesForBook as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});

import { TOOL_DEFS } from '../../../src/agent/tools/registry';

describe('TOOL_DEFS schema shape', () => {
  it('search_notes is exposed in OpenAI ToolDef shape', () => {
    const def = TOOL_DEFS.find((d) => d.function.name === 'search_notes');
    expect(def).toBeDefined();
    expect(def?.type).toBe('function');
    expect(def?.function.parameters).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    });
  });
});
