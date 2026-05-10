import type { ThreadRow } from '../../db/types';

export const IDLE_GAP_MS = 24 * 60 * 60 * 1000;

/**
 * Decide which thread to use when initializing a session for a book.
 * Returns 'create-new' if the list is empty or the most recent thread is
 * older than IDLE_GAP_MS. Otherwise returns the most recent thread row.
 */
export function pickActiveThread(
  threads: ThreadRow[],
  now: number = Date.now(),
): ThreadRow | 'create-new' {
  if (threads.length === 0) return 'create-new';
  const mostRecent = threads[0];
  const lastActive = new Date(mostRecent.last_active_at).getTime();
  if (Number.isNaN(lastActive)) return 'create-new';
  return now - lastActive < IDLE_GAP_MS ? mostRecent : 'create-new';
}
