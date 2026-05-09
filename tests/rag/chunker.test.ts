// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { chunkSegments } from '../../src/rag/chunker';

describe('chunkSegments', () => {
  it('emits no chunks for empty input', () => {
    expect(chunkSegments([])).toEqual([]);
  });

  it('keeps small input as a single chunk', () => {
    const out = chunkSegments([{ positionMarker: '1', text: 'hello world' }]);
    expect(out.length).toBe(1);
    expect(out[0].ordinal).toBe(0);
    expect(out[0].positionMarker).toBe('1');
  });

  it('splits long input into overlapping chunks with monotonically increasing ordinals', () => {
    const text = 'sentence. '.repeat(500); // ~5000 chars
    const out = chunkSegments([{ positionMarker: '1', text }]);
    expect(out.length).toBeGreaterThan(2);
    out.forEach((c, i) => expect(c.ordinal).toBe(i));
    // Overlap check: end of chunk N is contained in start of chunk N+1.
    for (let i = 0; i < out.length - 1; i++) {
      const tail = out[i].text.slice(-50);
      expect(out[i + 1].text.includes(tail.slice(0, 20))).toBe(true);
    }
  });
});
