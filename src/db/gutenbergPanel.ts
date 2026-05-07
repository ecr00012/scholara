import type { SqlExecutor } from './types';
import type { GutenbergBook } from '../lib/gutenbergApi';

export interface CachedFetch {
  cursor: number;
  lastFetchedAt: number | null;
  payload: GutenbergBook[] | null;
}

interface Row {
  cursor_offset: number;
  last_fetched_at: number | null;
  payload_json: string | null;
}

export async function getCachedFetch(db: SqlExecutor): Promise<CachedFetch> {
  const rows = await db.select<Row>(
    `SELECT cursor_offset, last_fetched_at, payload_json
     FROM gutenberg_panel_state
     WHERE id = 1`,
  );
  if (rows.length === 0) {
    return { cursor: 0, lastFetchedAt: null, payload: null };
  }

  const row = rows[0];
  let payload: GutenbergBook[] | null = null;
  if (row.payload_json) {
    try {
      payload = JSON.parse(row.payload_json) as GutenbergBook[];
    } catch {
      payload = null;
    }
  }

  return {
    cursor: row.cursor_offset,
    lastFetchedAt: row.last_fetched_at,
    payload,
  };
}

export async function setCachedFetch(
  db: SqlExecutor,
  next: CachedFetch,
): Promise<void> {
  await db.execute(
    `UPDATE gutenberg_panel_state
     SET cursor_offset = ?, last_fetched_at = ?, payload_json = ?
     WHERE id = 1`,
    [
      next.cursor,
      next.lastFetchedAt,
      next.payload === null ? null : JSON.stringify(next.payload),
    ],
  );
}

export function advanceCursor(cursor: number): number {
  return (cursor + 4) % 400;
}
