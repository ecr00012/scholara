import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetIndexingActivityForTests,
  isIndexingInteractionActive,
  markIndexingInteraction,
} from '../../src/rag/indexingActivity';

describe('indexingActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetIndexingActivityForTests();
  });

  it('reports inactive before any interaction', () => {
    vi.setSystemTime(10_000);

    expect(isIndexingInteractionActive()).toBe(false);
  });

  it('reports active briefly after interaction', () => {
    vi.setSystemTime(10_000);
    markIndexingInteraction();

    expect(isIndexingInteractionActive(10_500)).toBe(true);
    expect(isIndexingInteractionActive(11_000)).toBe(false);
  });
});
