// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { fnv1a32 } from '../../src/lib/hash';

describe('fnv1a32', () => {
  it('returns the FNV-1a 32-bit reference value for empty string', () => {
    // FNV offset basis
    expect(fnv1a32('')).toBe(0x811c9dc5);
  });

  it('returns the documented FNV-1a value for "a"', () => {
    expect(fnv1a32('a')).toBe(0xe40c292c);
  });

  it('is deterministic across repeated calls', () => {
    const a = fnv1a32('War and Peace');
    const b = fnv1a32('War and Peace');
    expect(a).toBe(b);
  });

  it('produces different hashes for different inputs', () => {
    expect(fnv1a32('foo')).not.toBe(fnv1a32('bar'));
  });

  it('returns an unsigned 32-bit value', () => {
    const h = fnv1a32('some long input ----------------');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});
