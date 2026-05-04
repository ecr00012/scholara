// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  pickPalette,
  pickPattern,
  PALETTES,
  PATTERNS,
} from '../../src/lib/coverPalette';

describe('coverPalette', () => {
  it('exposes 12 palettes and 6 patterns', () => {
    expect(PALETTES).toHaveLength(12);
    expect(PATTERNS).toHaveLength(6);
  });

  it('every palette defines background, accent, ink colors', () => {
    for (const p of PALETTES) {
      expect(p.background).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(p.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(p.ink).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('pickPalette is deterministic for a given hash', () => {
    expect(pickPalette(0xdeadbeef)).toBe(pickPalette(0xdeadbeef));
  });

  it('pickPalette covers the full range modulo 12', () => {
    const seen = new Set<number>();
    for (let h = 0; h < 12 * 100; h++) {
      seen.add(PALETTES.indexOf(pickPalette(h)));
    }
    expect(seen.size).toBe(12);
  });

  it('pickPattern uses the upper bits so titles with same low-bits diverge', () => {
    // Two hashes that share low 8 bits but differ in upper bits.
    const a = 0x000000ff;
    const b = 0x0000ffff;
    expect(pickPattern(a)).not.toBe(pickPattern(b));
  });
});
