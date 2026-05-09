// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../helpers/sqlite';
import {
  bookScopeKey,
  getProfile,
  upsertProfile,
  deleteProfile,
} from '../../src/db/readerProfile';
import type { SqlExecutor } from '../../src/db/types';

let db: SqlExecutor;

beforeEach(() => {
  db = makeTestDb();
});

describe('readerProfile', () => {
  it('bookScopeKey formats scope as book:<id>', () => {
    expect(bookScopeKey(42)).toBe('book:42');
  });

  it('getProfile returns null when missing', async () => {
    expect(await getProfile(db, 'global')).toBeNull();
  });

  it('upsertProfile inserts then updates summary and turn_count', async () => {
    await upsertProfile(db, {
      scope: 'global',
      summary: 'first',
      turn_count: 1,
    });
    const a = await getProfile(db, 'global');
    expect(a?.summary).toBe('first');
    expect(a?.turn_count).toBe(1);

    await new Promise((r) => setTimeout(r, 1100));
    await upsertProfile(db, {
      scope: 'global',
      summary: 'second',
      turn_count: 5,
    });
    const b = await getProfile(db, 'global');
    expect(b?.summary).toBe('second');
    expect(b?.turn_count).toBe(5);
    expect(b?.updated_at).not.toBe(a?.updated_at);
  });

  it('deleteProfile removes the row', async () => {
    await upsertProfile(db, {
      scope: 'global',
      summary: 'x',
      turn_count: 0,
    });
    await deleteProfile(db, 'global');
    expect(await getProfile(db, 'global')).toBeNull();
  });
});
