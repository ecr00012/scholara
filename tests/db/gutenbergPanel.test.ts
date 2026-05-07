// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { makeTestDb } from '../helpers/sqlite';
import {
  advanceCursor,
  getCachedFetch,
  setCachedFetch,
  type CachedFetch,
} from '../../src/db/gutenbergPanel';
import type { GutenbergBook } from '../../src/lib/gutenbergApi';

const FAKE_BOOK: GutenbergBook = {
  id: 1,
  title: 'Pride and Prejudice',
  alternative_title: null,
  authors: [{ id: 68, name: 'Austen, Jane' }],
  subjects: ['Romance'],
  bookshelves: [],
  media_type: 'Text',
  download_count: 1,
  issued: '1998-06-01',
  reading_ease_score: '69.20',
  cover_image: null,
};

describe('db/gutenbergPanel', () => {
  it('migration seeds a row with cursor=0 and null fetch fields', async () => {
    const db = makeTestDb();
    const state = await getCachedFetch(db);
    expect(state).toEqual({
      cursor: 0,
      lastFetchedAt: null,
      payload: null,
    } satisfies CachedFetch);
  });

  it('setCachedFetch persists cursor advancement, timestamp, and payload', async () => {
    const db = makeTestDb();
    const now = 1_700_000_000_000;
    await setCachedFetch(db, {
      cursor: 4,
      lastFetchedAt: now,
      payload: [FAKE_BOOK],
    });
    const state = await getCachedFetch(db);
    expect(state.cursor).toBe(4);
    expect(state.lastFetchedAt).toBe(now);
    expect(state.payload).toEqual([FAKE_BOOK]);
  });

  it('advanceCursor wraps at the 400 boundary', () => {
    expect(advanceCursor(396)).toBe(0);
  });

  it('overwrites the row on repeated setCachedFetch (single-row constraint)', async () => {
    const db = makeTestDb();
    await setCachedFetch(db, { cursor: 4, lastFetchedAt: 100, payload: [] });
    await setCachedFetch(db, {
      cursor: 8,
      lastFetchedAt: 200,
      payload: [FAKE_BOOK],
    });
    const rows = await db.select<{ count: number }>(
      'SELECT COUNT(*) AS count FROM gutenberg_panel_state',
    );
    expect(rows[0].count).toBe(1);
    const state = await getCachedFetch(db);
    expect(state.cursor).toBe(8);
    expect(state.lastFetchedAt).toBe(200);
  });
});
