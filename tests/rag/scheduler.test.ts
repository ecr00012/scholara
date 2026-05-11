// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { yieldToUi, waitForIndexingIdle } from '../../src/rag/scheduler';
import {
  __resetIndexingActivityForTests,
  markIndexingInteraction,
} from '../../src/rag/indexingActivity';

describe('rag scheduler', () => {
  beforeEach(() => {
    vi.useRealTimers();
    __resetIndexingActivityForTests();
  });

  it('yields through requestAnimationFrame when available', async () => {
    const original = globalThis.requestAnimationFrame;
    const raf = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    globalThis.requestAnimationFrame = raf;

    await yieldToUi();

    expect(raf).toHaveBeenCalledTimes(1);
    globalThis.requestAnimationFrame = original;
  });

  it('throws aborted before yielding', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(yieldToUi(controller.signal)).rejects.toThrow('aborted');
  });

  it('waits until reader interaction is idle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    markIndexingInteraction();

    const promise = waitForIndexingIdle();
    await vi.advanceTimersByTimeAsync(500);
    vi.setSystemTime(2_000);
    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).resolves.toBeUndefined();
  });
});
