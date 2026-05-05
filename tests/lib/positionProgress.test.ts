// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { getProgress } from '../../src/lib/positionProgress';

describe('getProgress', () => {
  it('returns null for null input', () => {
    expect(getProgress(null)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(getProgress('not-json')).toBeNull();
  });

  it('returns null for parsed object without fraction', () => {
    expect(getProgress(JSON.stringify({ type: 'pdf', locator: 1, label: 'Page 1' }))).toBeNull();
  });

  it('returns the fraction from a Position', () => {
    expect(getProgress(JSON.stringify({
      type: 'pdf', locator: 5, fraction: 0.42, label: 'Page 5',
    }))).toBe(0.42);
  });

  it('returns the end.fraction from a QuoteRange', () => {
    expect(getProgress(JSON.stringify({
      start: { type: 'pdf', locator: 1, fraction: 0.05, label: 'Page 1' },
      end:   { type: 'pdf', locator: 2, fraction: 0.10, label: 'Page 2' },
    }))).toBe(0.10);
  });

  it('clamps to [0,1]', () => {
    expect(getProgress(JSON.stringify({
      type: 'pdf', locator: 1, fraction: -0.2, label: 'Page 1',
    }))).toBe(0);
    expect(getProgress(JSON.stringify({
      type: 'pdf', locator: 999, fraction: 1.7, label: 'Page 999',
    }))).toBe(1);
  });
});
