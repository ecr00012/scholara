import type { Position } from '../lib/positionShape';

export interface ChunkOrdinalIndex {
  /** Sorted ascending by ordinal. */
  pdf?: Array<{ ordinal: number; page: number }>;
  /** Sorted ascending by ordinal. */
  epub?: Array<{ ordinal: number; href: string; fraction: number }>;
}

/**
 * Returns the highest chunk ordinal whose start position is at or before
 * the reader's `current_position`. Returns -1 when no chunk qualifies
 * (e.g., position is before the very first chunk's start).
 */
export function maxOrdinalForPosition(
  position: Position | null,
  index: ChunkOrdinalIndex,
): number {
  if (!position) return -1;

  if (position.type === 'pdf' && index.pdf) {
    let last = -1;
    for (const c of index.pdf) {
      if (c.page <= position.locator) last = c.ordinal;
      else break;
    }
    return last;
  }

  if (position.type === 'epub' && index.epub) {
    let last = -1;
    for (const c of index.epub) {
      if (c.fraction <= position.fraction + 1e-6) last = c.ordinal;
      else break;
    }
    return last;
  }
  return -1;
}
