// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { cosine, topK } from '../../src/rag/cosine';

describe('cosine', () => {
  it('returns 1 for identical normalized vectors', () => {
    const v = new Float32Array([0.6, 0.8, 0, 0]);
    expect(cosine(v, v)).toBeCloseTo(1, 5);
  });
  it('topK picks highest scores', () => {
    const result = topK(
      [
        { item: 'a', score: 0.1 },
        { item: 'b', score: 0.9 },
        { item: 'c', score: 0.5 },
      ],
      2,
    );
    expect(result.map((r) => r.item)).toEqual(['b', 'c']);
  });
});
