import { describe, it, expect } from 'vitest';
import {
  isFresh,
  FRESHNESS_TTL_MS,
} from '../../src/lib/gutenbergCacheFreshness';

describe('lib/gutenbergCacheFreshness', () => {
  it('returns false when lastFetchedAt is null', () => {
    expect(isFresh(null, Date.now())).toBe(false);
  });

  it('returns true when within the 24h TTL', () => {
    const now = 1_700_000_000_000;
    const oneHourAgo = now - 60 * 60 * 1000;
    expect(isFresh(oneHourAgo, now)).toBe(true);
  });

  it('returns false at exactly the TTL boundary', () => {
    const now = 1_700_000_000_000;
    expect(isFresh(now - FRESHNESS_TTL_MS, now)).toBe(false);
  });

  it('returns false when older than the TTL', () => {
    const now = 1_700_000_000_000;
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;
    expect(isFresh(twoDaysAgo, now)).toBe(false);
  });

  it('exports FRESHNESS_TTL_MS as 24h', () => {
    expect(FRESHNESS_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
