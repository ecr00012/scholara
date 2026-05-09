// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { maxOrdinalForPosition } from '../../src/agent/spoilerGuard';

describe('maxOrdinalForPosition (PDF)', () => {
  const idx = {
    pdf: [
      { ordinal: 0, page: 1 },
      { ordinal: 1, page: 5 },
      { ordinal: 2, page: 10 },
    ],
  };
  it('returns -1 before the first chunk', () => {
    expect(
      maxOrdinalForPosition({ type: 'pdf', locator: 0, fraction: 0, label: '' }, idx),
    ).toBe(-1);
  });
  it('returns the latest ordinal at or before page', () => {
    expect(
      maxOrdinalForPosition({ type: 'pdf', locator: 6, fraction: 0, label: '' }, idx),
    ).toBe(1);
  });
  it('returns the last ordinal for late pages', () => {
    expect(
      maxOrdinalForPosition({ type: 'pdf', locator: 999, fraction: 1, label: '' }, idx),
    ).toBe(2);
  });
});

describe('maxOrdinalForPosition (EPUB)', () => {
  const idx = {
    epub: [
      { ordinal: 0, href: 'a.xhtml', fraction: 0 },
      { ordinal: 1, href: 'b.xhtml', fraction: 0.5 },
      { ordinal: 2, href: 'c.xhtml', fraction: 0.9 },
    ],
  };
  it('uses fraction comparison', () => {
    expect(
      maxOrdinalForPosition({ type: 'epub', locator: 'x', fraction: 0.6, label: '' }, idx),
    ).toBe(1);
  });
});
