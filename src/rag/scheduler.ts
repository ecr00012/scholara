import { INDEXING_IDLE_DELAY_MS } from './indexingConfig';
import { isIndexingInteractionActive } from './indexingActivity';

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('aborted');
  }
}

export async function yieldToUi(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });

  throwIfAborted(signal);
}

export async function waitForIndexingIdle(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  while (isIndexingInteractionActive()) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, INDEXING_IDLE_DELAY_MS);
    });
    throwIfAborted(signal);
  }
}
