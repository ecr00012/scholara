# Indexing Embedding Performance Implementation Plan

**Goal:** Keep Scholara responsive while a book is being indexed and embedded for local RAG.

**Architecture:** First add cooperative scheduling to the existing renderer indexing loop so React can paint between embedding/storage batches. Then move transformer embedding into a dedicated Web Worker while keeping text extraction, progress state, and SQLite writes in the existing indexing pipeline. Add a small activity gate so indexing can pause between batches when the reader is actively scrolling or typing.

**Tech Stack:** Tauri 2, TypeScript, React, Vite Web Workers, `@xenova/transformers`, ONNX Runtime Web/WASM, tauri-plugin-sql, Vitest.

**Source Requirement:** User-reported performance issue: local `Xenova/all-MiniLM-L6-v2` embedding runs during indexing and can freeze the WebView UI.

---

## File Map

**New:**
- `src/rag/indexingConfig.ts` — central constants for indexing batch size and idle delay.
- `src/rag/scheduler.ts` — cooperative yielding and idle-wait helpers used by indexing.
- `src/rag/embedderWorker.ts` — Web Worker that owns transformers.js pipeline initialization and embedding inference.
- `src/rag/workerEmbedderClient.ts` — renderer-side worker client with request ids, abort handling, transferables, and fallback errors.
- `src/rag/embedForIndexing.ts` — narrow facade used by the indexing pipeline; defaults to the worker client.
- `src/rag/indexingActivity.ts` — lightweight activity tracker for reader interaction throttling.
- `tests/rag/scheduler.test.ts` — scheduler unit tests.
- `tests/rag/workerEmbedderClient.test.ts` — worker client request/response and abort tests.
- `tests/rag/indexingActivity.test.ts` — activity tracker tests.

**Modified:**
- `src/rag/index.ts` — use config constants, worker embedding facade, and cooperative yielding between batches.
- `src/rag/embedder.ts` — keep current renderer embedder for query embeddings and tests; no indexing loop should import it directly after this plan.
- `src/screens/Reader/index.tsx` — notify indexing activity tracker for reader-level scrolling and pointer activity.
- `src/screens/Reader/agentPanel/chat/Composer.tsx` — notify indexing activity tracker while the user is typing.
- `tests/rag/index.test.ts` — mock the new embedding facade and scheduler; assert batch yielding and abort behavior.
- `vite.config.ts` — keep transformers/onnx exclusions and add no new prebundle behavior unless worker build requires it.

**Unchanged by design:**
- `src/db/bookChunks.ts` — embeddings stay stored as base64 strings through the existing tauri-plugin-sql path.
- `src/rag/chunker.ts` — chunk size/overlap behavior is not part of this performance change.
- `src/rag/extractText.ts` — extraction remains in the current pipeline.

---

## Implementation Sequence

1. Add scheduler/config tests first.
2. Add cooperative yielding to the existing indexing loop.
3. Add the activity tracker and wire reader/composer events.
4. Add the Web Worker embedder client and worker.
5. Switch indexing to worker embeddings.
6. Run unit tests, then manually verify with a large EPUB/PDF in Tauri dev.

Each task should be committed separately.

---

## Task 1 — Add Indexing Config and Scheduler

**Why:** The smallest useful fix is to yield between batches. Keep the behavior explicit and testable.

### 1a. Create `src/rag/indexingConfig.ts`

```ts
export const INDEXING_EMBED_BATCH_SIZE = 8;
export const INDEXING_IDLE_DELAY_MS = 500;
```

### 1b. Create `src/rag/scheduler.ts`

```ts
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
```

### 1c. Create `src/rag/indexingActivity.ts`

```ts
const ACTIVE_WINDOW_MS = 900;

let lastInteractionAt = 0;

export function markIndexingInteraction(): void {
  lastInteractionAt = Date.now();
}

export function isIndexingInteractionActive(now = Date.now()): boolean {
  return now - lastInteractionAt < ACTIVE_WINDOW_MS;
}

export function __resetIndexingActivityForTests(): void {
  lastInteractionAt = 0;
}
```

### 1d. Add `tests/rag/scheduler.test.ts`

```ts
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
```

### 1e. Run tests

Command:

```bash
npm test -- tests/rag/scheduler.test.ts
```

Expected result:

```text
PASS  tests/rag/scheduler.test.ts
```

Commit:

```bash
git add src/rag/indexingConfig.ts src/rag/scheduler.ts src/rag/indexingActivity.ts tests/rag/scheduler.test.ts
git commit -m "feat(rag): add indexing scheduler"
```

---

## Task 2 — Yield Between Existing Indexing Batches

**Why:** This is the near-term responsiveness fix. It does not change the embedding model, stored data, or RAG retrieval behavior.

### 2a. Update `src/rag/index.ts`

Replace the hardcoded batch constant and add scheduler calls.

```ts
import { getDb } from '../db/client';
import {
  insertChunks,
  deleteChunksForBook,
  countChunksForBook,
} from '../db/bookChunks';
import { getIndexState, upsertIndexState } from '../db/bookIndexState';
import { readBookBytes } from '../ipc/files';
import { hashBytes } from '../lib/hash';
import type { Book } from '../db/types';
import { embedForIndexing } from './embedForIndexing';
import { EMBEDDER_INDEX_ID } from './embedder';
import { chunkSegments } from './chunker';
import { extractPdfSegments, extractEpubSegments } from './extractText';
import { INDEXING_EMBED_BATCH_SIZE } from './indexingConfig';
import { throwIfAborted, waitForIndexingIdle, yieldToUi } from './scheduler';

export interface IndexProgress {
  total: number;
  done: number;
  phase: 'extracting' | 'embedding' | 'storing' | 'done';
}

export type IndexProgressCb = (p: IndexProgress) => void;
export type IndexableBook = Pick<Book, 'id' | 'file_path' | 'file_type'>;

/**
 * Indexes a book if needed. No-op if status='ready' and content_hash matches.
 * Throws on failure (after marking state='failed').
 */
export async function ensureBookIndexed(
  book: IndexableBook,
  onProgress: IndexProgressCb,
  signal?: AbortSignal,
): Promise<void> {
  const db = await getDb();
  const bytes = await readBookBytes(book.file_path);
  const hash = await hashBytes(bytes);

  const existing = await getIndexState(db, book.id);
  if (
    existing?.status === 'ready' &&
    existing.content_hash === hash &&
    existing.embedder_model === EMBEDDER_INDEX_ID &&
    (existing.chunk_count ?? 0) > 0
  ) {
    onProgress({
      total: existing.chunk_count ?? 0,
      done: existing.chunk_count ?? 0,
      phase: 'done',
    });
    return;
  }

  await upsertIndexState(db, {
    book_id: book.id,
    status: 'indexing',
    chunk_count: null,
    embedder_model: EMBEDDER_INDEX_ID,
    content_hash: hash,
    error: null,
  });

  try {
    onProgress({ total: 0, done: 0, phase: 'extracting' });
    const segments =
      book.file_type === 'pdf'
        ? await extractPdfSegments(bytes)
        : await extractEpubSegments(bytes);
    throwIfAborted(signal);

    const chunks = chunkSegments(segments);
    const total = chunks.length;
    if (total === 0) {
      throw new Error(
        `No text chunks were extracted from this ${book.file_type.toUpperCase()} book.`,
      );
    }
    onProgress({ total, done: 0, phase: 'embedding' });

    // Refresh storage in case of re-index.
    await deleteChunksForBook(db, book.id);

    for (let i = 0; i < chunks.length; i += INDEXING_EMBED_BATCH_SIZE) {
      throwIfAborted(signal);
      await waitForIndexingIdle(signal);

      const batch = chunks.slice(i, i + INDEXING_EMBED_BATCH_SIZE);
      const vectors = await embedForIndexing(batch.map((c) => c.text), signal);
      await insertChunks(
        db,
        batch.map((c, j) => ({
          book_id: book.id,
          ordinal: c.ordinal,
          position_marker: c.positionMarker,
          text: c.text,
          embedding: vectors[j],
        })),
      );
      onProgress({
        total,
        done: Math.min(i + batch.length, total),
        phase: 'embedding',
      });

      await yieldToUi(signal);
    }

    const finalCount = await countChunksForBook(db, book.id);
    await upsertIndexState(db, {
      book_id: book.id,
      status: 'ready',
      chunk_count: finalCount,
      embedder_model: EMBEDDER_INDEX_ID,
      content_hash: hash,
      error: null,
    });
    onProgress({ total: finalCount, done: finalCount, phase: 'done' });
  } catch (err) {
    if (err instanceof Error && err.message === 'aborted') {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    await upsertIndexState(db, {
      book_id: book.id,
      status: 'failed',
      chunk_count: null,
      embedder_model: EMBEDDER_INDEX_ID,
      content_hash: hash,
      error: message,
    });
    throw err;
  }
}
```

### 2b. Create temporary facade `src/rag/embedForIndexing.ts`

This task keeps indexing behavior unchanged while giving Task 5 a stable replacement point.

```ts
import { embed } from './embedder';

export async function embedForIndexing(
  texts: string[],
  _signal?: AbortSignal,
): Promise<Float32Array[]> {
  return embed(texts);
}
```

### 2c. Update `tests/rag/index.test.ts`

Change the embedder mock to mock `embedForIndexing`, and add scheduler mocks.

At the top, add hoisted mocks:

```ts
const {
  getDbMock,
  readBookBytesMock,
  hashBytesMock,
  getIndexStateMock,
  upsertIndexStateMock,
  deleteChunksForBookMock,
  insertChunksMock,
  countChunksForBookMock,
  extractEpubSegmentsMock,
  extractPdfSegmentsMock,
  chunkSegmentsMock,
  embedForIndexingMock,
  yieldToUiMock,
  waitForIndexingIdleMock,
  throwIfAbortedMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  readBookBytesMock: vi.fn(),
  hashBytesMock: vi.fn(),
  getIndexStateMock: vi.fn(),
  upsertIndexStateMock: vi.fn(),
  deleteChunksForBookMock: vi.fn(),
  insertChunksMock: vi.fn(),
  countChunksForBookMock: vi.fn(),
  extractEpubSegmentsMock: vi.fn(),
  extractPdfSegmentsMock: vi.fn(),
  chunkSegmentsMock: vi.fn(),
  embedForIndexingMock: vi.fn(),
  yieldToUiMock: vi.fn(),
  waitForIndexingIdleMock: vi.fn(),
  throwIfAbortedMock: vi.fn((signal?: AbortSignal) => {
    if (signal?.aborted) throw new Error('aborted');
  }),
}));
```

Replace the current `../../src/rag/embedder` mock with:

```ts
vi.mock('../../src/rag/embedder', () => ({
  EMBEDDER_MODEL_ID: 'Xenova/all-MiniLM-L6-v2',
  EMBEDDER_INDEX_ID: 'Xenova/all-MiniLM-L6-v2:base64-embeddings-v1',
}));

vi.mock('../../src/rag/embedForIndexing', () => ({
  embedForIndexing: embedForIndexingMock,
}));

vi.mock('../../src/rag/scheduler', () => ({
  yieldToUi: yieldToUiMock,
  waitForIndexingIdle: waitForIndexingIdleMock,
  throwIfAborted: throwIfAbortedMock,
}));
```

In `beforeEach`, replace:

```ts
embedMock.mockResolvedValue([new Float32Array(384)]);
```

with:

```ts
embedForIndexingMock.mockResolvedValue([new Float32Array(384)]);
yieldToUiMock.mockResolvedValue(undefined);
waitForIndexingIdleMock.mockResolvedValue(undefined);
```

Add this test:

```ts
it('yields and checks idle between embedding batches', async () => {
  chunkSegmentsMock.mockReturnValue(
    Array.from({ length: 17 }, (_, i) => ({
      ordinal: i,
      positionMarker: `p${i + 1}`,
      text: `Chunk ${i + 1}`,
    })),
  );
  embedForIndexingMock.mockImplementation(async (texts: string[]) =>
    texts.map(() => new Float32Array(384)),
  );
  countChunksForBookMock.mockResolvedValueOnce(17);
  const onProgress = vi.fn();

  await ensureBookIndexed(book, onProgress);

  expect(embedForIndexingMock).toHaveBeenCalledTimes(3);
  expect(waitForIndexingIdleMock).toHaveBeenCalledTimes(3);
  expect(yieldToUiMock).toHaveBeenCalledTimes(3);
  expect(insertChunksMock).toHaveBeenCalledTimes(3);
  expect(onProgress).toHaveBeenCalledWith({
    total: 17,
    done: 17,
    phase: 'embedding',
  });
});
```

### 2d. Run tests

Command:

```bash
npm test -- tests/rag/index.test.ts tests/rag/scheduler.test.ts
```

Expected result:

```text
PASS  tests/rag/index.test.ts
PASS  tests/rag/scheduler.test.ts
```

Commit:

```bash
git add src/rag/index.ts src/rag/embedForIndexing.ts tests/rag/index.test.ts
git commit -m "feat(rag): yield during book indexing"
```

---

## Task 3 — Track Reader and Composer Activity

**Why:** The scheduler from Task 1 can pause between batches only if reader UI events mark recent interaction.

### 3a. Update `src/screens/Reader/index.tsx`

Find the outer reader container that wraps the reader display and agent panel. Add passive interaction markers to the nearest common wrapper.

Import:

```ts
import { markIndexingInteraction } from '../../rag/indexingActivity';
```

Add handlers to the wrapper element:

```tsx
onPointerMove={markIndexingInteraction}
onPointerDown={markIndexingInteraction}
onWheel={markIndexingInteraction}
onScroll={markIndexingInteraction}
```

If the current wrapper already has handlers, compose them:

```tsx
onWheel={(event) => {
  markIndexingInteraction();
  existingOnWheel?.(event);
}}
```

### 3b. Update `src/screens/Reader/agentPanel/chat/Composer.tsx`

Import:

```ts
import { markIndexingInteraction } from '../../../../rag/indexingActivity';
```

On the textarea/input used for composing chat messages, add:

```tsx
onChange={(event) => {
  markIndexingInteraction();
  setText(event.target.value);
}}
onFocus={markIndexingInteraction}
onKeyDown={markIndexingInteraction}
```

If the component uses a different state setter name, preserve that local state name and only add the `markIndexingInteraction()` call.

### 3c. Add `tests/rag/indexingActivity.test.ts`

```ts
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
```

### 3d. Run tests

Command:

```bash
npm test -- tests/rag/indexingActivity.test.ts tests/rag/scheduler.test.ts
```

Expected result:

```text
PASS  tests/rag/indexingActivity.test.ts
PASS  tests/rag/scheduler.test.ts
```

Commit:

```bash
git add src/rag/indexingActivity.ts tests/rag/indexingActivity.test.ts src/screens/Reader/index.tsx src/screens/Reader/agentPanel/chat/Composer.tsx
git commit -m "feat(rag): pause indexing around reader activity"
```

---

## Task 4 — Add Worker Embedder Client Tests

**Why:** The worker boundary is asynchronous and easy to get subtly wrong. Test ids, transfer conversion, errors, and aborts before adding the actual worker.

### 4a. Create `tests/rag/workerEmbedderClient.test.ts`

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

class MockWorker {
  static instances: MockWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;

  constructor() {
    MockWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

vi.stubGlobal('Worker', MockWorker);

describe('workerEmbedderClient', () => {
  beforeEach(async () => {
    vi.resetModules();
    MockWorker.instances = [];
  });

  it('resolves vectors returned by the worker', async () => {
    const { embedWithWorkerForIndexing } = await import(
      '../../src/rag/workerEmbedderClient'
    );
    const promise = embedWithWorkerForIndexing(['alpha', 'beta']);
    const worker = MockWorker.instances[0];
    const posted = worker.posted[0] as { id: string; texts: string[] };
    const first = new Float32Array([1, 2, 3]);
    const second = new Float32Array([4, 5, 6]);

    worker.emit({
      id: posted.id,
      type: 'result',
      vectors: [first.buffer, second.buffer],
    });

    await expect(promise).resolves.toEqual([
      new Float32Array([1, 2, 3]),
      new Float32Array([4, 5, 6]),
    ]);
    expect(posted.texts).toEqual(['alpha', 'beta']);
  });

  it('rejects when the worker returns an error', async () => {
    const { embedWithWorkerForIndexing } = await import(
      '../../src/rag/workerEmbedderClient'
    );
    const promise = embedWithWorkerForIndexing(['alpha']);
    const worker = MockWorker.instances[0];
    const posted = worker.posted[0] as { id: string };

    worker.emit({
      id: posted.id,
      type: 'error',
      error: 'model failed',
    });

    await expect(promise).rejects.toThrow('model failed');
  });

  it('rejects aborted requests and ignores late worker responses', async () => {
    const { embedWithWorkerForIndexing } = await import(
      '../../src/rag/workerEmbedderClient'
    );
    const controller = new AbortController();
    const promise = embedWithWorkerForIndexing(['alpha'], controller.signal);
    const worker = MockWorker.instances[0];
    const posted = worker.posted[0] as { id: string };

    controller.abort();

    await expect(promise).rejects.toThrow('aborted');

    worker.emit({
      id: posted.id,
      type: 'result',
      vectors: [new Float32Array([1]).buffer],
    });
  });
});
```

### 4b. Run the new test

Command:

```bash
npm test -- tests/rag/workerEmbedderClient.test.ts
```

Expected initial result before Task 5:

```text
FAIL  tests/rag/workerEmbedderClient.test.ts
```

The failure should be a missing module error for `src/rag/workerEmbedderClient.ts`.

Commit only the failing test if following strict TDD:

```bash
git add tests/rag/workerEmbedderClient.test.ts
git commit -m "test(rag): cover worker embedder client"
```

---

## Task 5 — Implement Worker Embedder Client and Worker

**Why:** Transformer tokenization and ONNX/WASM inference should not run on React's renderer thread during indexing.

### 5a. Create `src/rag/workerEmbedderClient.ts`

```ts
interface EmbedRequestMessage {
  id: string;
  type: 'embed';
  texts: string[];
}

interface EmbedResultMessage {
  id: string;
  type: 'result';
  vectors: ArrayBuffer[];
}

interface EmbedErrorMessage {
  id: string;
  type: 'error';
  error: string;
}

type WorkerMessage = EmbedResultMessage | EmbedErrorMessage;

interface PendingRequest {
  resolve: (vectors: Float32Array[]) => void;
  reject: (err: Error) => void;
  abortListener?: () => void;
  signal?: AbortSignal;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<string, PendingRequest>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./embedderWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      const request = pending.get(message.id);
      if (!request) return;

      pending.delete(message.id);
      if (request.abortListener) {
        request.signal?.removeEventListener('abort', request.abortListener);
      }

      if (message.type === 'error') {
        request.reject(new Error(message.error));
        return;
      }

      request.resolve(message.vectors.map((buffer) => new Float32Array(buffer)));
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'embedding worker failed');
      for (const [id, request] of pending) {
        pending.delete(id);
        if (request.abortListener) {
          request.signal?.removeEventListener('abort', request.abortListener);
        }
        request.reject(error);
      }
    };
  }
  return worker;
}

export async function embedWithWorkerForIndexing(
  texts: string[],
  signal?: AbortSignal,
): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  if (signal?.aborted) throw new Error('aborted');

  const id = String(nextId++);
  const message: EmbedRequestMessage = { id, type: 'embed', texts };

  return new Promise<Float32Array[]>((resolve, reject) => {
    const request: PendingRequest = { resolve, reject, signal };
    if (signal) {
      request.abortListener = () => {
        pending.delete(id);
        reject(new Error('aborted'));
      };
      signal.addEventListener('abort', request.abortListener, { once: true });
    }

    pending.set(id, request);
    getWorker().postMessage(message);
  });
}

export function __resetWorkerEmbedderForTests(): void {
  for (const [id, request] of pending) {
    pending.delete(id);
    request.reject(new Error('worker reset'));
  }
  worker?.terminate();
  worker = null;
  nextId = 1;
}
```

### 5b. Create `src/rag/embedderWorker.ts`

```ts
import { EMBEDDING_DIM, EMBEDDER_MODEL_ID } from './embedder';
import type { FeatureExtractionPipeline } from '@xenova/transformers';

interface EmbedRequestMessage {
  id: string;
  type: 'embed';
  texts: string[];
}

interface EmbedResultMessage {
  id: string;
  type: 'result';
  vectors: ArrayBuffer[];
}

interface EmbedErrorMessage {
  id: string;
  type: 'error';
  error: string;
}

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

async function getWorkerEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { env, pipeline } = await import(
        '@xenova/transformers/dist/transformers.js'
      );

      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.useBrowserCache = false;

      return (await pipeline('feature-extraction', EMBEDDER_MODEL_ID, {
        quantized: true,
      })) as FeatureExtractionPipeline;
    })();
  }
  return pipelinePromise;
}

self.onmessage = async (event: MessageEvent<EmbedRequestMessage>) => {
  const message = event.data;
  if (message.type !== 'embed') return;

  try {
    const ext = await getWorkerEmbedder();
    const out = await ext(message.texts, { pooling: 'mean', normalize: true });
    const data = out.data as Float32Array;
    const vectors: ArrayBuffer[] = [];

    for (let i = 0; i < message.texts.length; i++) {
      const vector = data.slice(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM);
      vectors.push(vector.buffer);
    }

    const response: EmbedResultMessage = {
      id: message.id,
      type: 'result',
      vectors,
    };
    self.postMessage(response, vectors);
  } catch (err) {
    const response: EmbedErrorMessage = {
      id: message.id,
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
```

### 5c. Update `src/rag/embedForIndexing.ts`

```ts
import { embedWithWorkerForIndexing } from './workerEmbedderClient';

export async function embedForIndexing(
  texts: string[],
  signal?: AbortSignal,
): Promise<Float32Array[]> {
  return embedWithWorkerForIndexing(texts, signal);
}
```

### 5d. Verify worker model resource path in Tauri

The worker cannot call Tauri APIs directly. If the worker fails to load the bundled model during manual verification, replace `src/rag/embedderWorker.ts` with this message shape:

```ts
interface InitMessage {
  id: string;
  type: 'init';
  localModelPath: string;
}
```

Then update `workerEmbedderClient.ts` to resolve the model path in the renderer using:

```ts
import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveResource } from '@tauri-apps/api/path';

async function resolveWorkerModelPath(): Promise<string> {
  const modelsDir = await resolveResource('resources/models');
  const modelsUrl = convertFileSrc(modelsDir, 'asset');
  return modelsUrl.endsWith('/') ? modelsUrl : modelsUrl + '/';
}
```

The worker should set:

```ts
env.localModelPath = localModelPath;
```

before creating the pipeline. Use this fallback only if the direct worker implementation cannot find the bundled model.

### 5e. Run tests

Command:

```bash
npm test -- tests/rag/workerEmbedderClient.test.ts tests/rag/index.test.ts
```

Expected result:

```text
PASS  tests/rag/workerEmbedderClient.test.ts
PASS  tests/rag/index.test.ts
```

Commit:

```bash
git add src/rag/workerEmbedderClient.ts src/rag/embedderWorker.ts src/rag/embedForIndexing.ts tests/rag/workerEmbedderClient.test.ts
git commit -m "feat(rag): embed indexed chunks in a worker"
```

---

## Task 6 — Preserve Query Embeddings in Renderer

**Why:** `search_book` and `search_notes` embed short user queries. Those are not the current source of long freezes, and keeping them on the existing `embedder.ts` path avoids broad changes to chat tool behavior.

### 6a. Confirm imports

Run:

```bash
rg -n "from './embedder'|from '../../src/rag/embedder'|from '../../rag/embedder|from '../../../rag/embedder|from '../../../../rag/embedder" src tests
```

Expected relevant production imports:

```text
src/agent/tools/searchBook.ts
src/agent/tools/searchNotes.ts
src/screens/Reader/agentPanel/chat/AiChatRoot.tsx
src/rag/embedForIndexing.ts
```

`src/rag/index.ts` must not import `embed` from `./embedder`.

### 6b. If `src/rag/index.ts` still imports `embed`

Replace:

```ts
import { embed, EMBEDDER_INDEX_ID } from './embedder';
```

with:

```ts
import { EMBEDDER_INDEX_ID } from './embedder';
import { embedForIndexing } from './embedForIndexing';
```

And replace:

```ts
const vectors = await embed(batch.map((c) => c.text));
```

with:

```ts
const vectors = await embedForIndexing(batch.map((c) => c.text), signal);
```

### 6c. Run typecheck

Command:

```bash
npm run build
```

Expected result:

```text
✓ built in
```

Commit:

```bash
git add src/rag/index.ts src/rag/embedForIndexing.ts
git commit -m "refactor(rag): isolate indexing embeddings"
```

If there are no changes in this task, do not create an empty commit.

---

## Task 7 — Manual Tauri Performance Verification

**Why:** Unit tests cannot prove WebView responsiveness. This issue must be validated in the real app shell.

### 7a. Start Tauri dev

Command:

```bash
npm run tauri:dev
```

Expected result:

```text
VITE ready
```

and a Scholara app window opens.

### 7b. Test scenario

1. Import or open a large EPUB/PDF that has no ready `book_index_state`.
2. Open the AI Chat tab to trigger indexing.
3. While the progress text says `Embedding chunks X/Y`, scroll the reader continuously.
4. Type in chat controls or open/close reader panels.
5. Observe that input, scrolling, and progress updates remain responsive.

### 7c. Failure handling

If the app still freezes for more than one second at a time:

1. Change `INDEXING_EMBED_BATCH_SIZE` in `src/rag/indexingConfig.ts` from `8` to `4`.
2. Re-run `npm run tauri:dev`.
3. Repeat the same scenario.

If the worker cannot load the local bundled model:

1. Implement the `InitMessage` model-path fallback described in Task 5d.
2. Run `npm run build`.
3. Repeat the same scenario.

### 7d. Commit final tuning

Command:

```bash
git add src/rag/indexingConfig.ts src/rag/embedderWorker.ts src/rag/workerEmbedderClient.ts
git commit -m "chore(rag): tune indexing responsiveness"
```

If no tuning changes are needed, do not create an empty commit.

---

## Task 8 — Full Verification

Run the focused unit tests:

```bash
npm test -- tests/rag/index.test.ts tests/rag/scheduler.test.ts tests/rag/indexingActivity.test.ts tests/rag/workerEmbedderClient.test.ts
```

Expected result:

```text
PASS  tests/rag/index.test.ts
PASS  tests/rag/scheduler.test.ts
PASS  tests/rag/indexingActivity.test.ts
PASS  tests/rag/workerEmbedderClient.test.ts
```

Run the full unit suite:

```bash
npm test
```

Expected result:

```text
Test Files  all passed
```

Run the production build:

```bash
npm run build
```

Expected result:

```text
✓ built in
```

Optional e2e check if time allows:

```bash
npm run test:e2e -- tests/playwright/ai-chat.spec.ts
```

Expected result:

```text
1 passed
```

---

## Acceptance Criteria

- Indexing no longer runs long transformer inference batches on the renderer main thread.
- The indexing loop yields between every batch.
- The default batch size is reduced from `16` to `8`, or to `4` if manual testing still shows visible freezes.
- Reader scrolling and chat typing mark recent activity, and indexing pauses between batches while the reader is active.
- Cancelled indexing still throws `aborted` and does not mark `book_index_state.status` as `failed`.
- Existing embedding storage format remains unchanged.
- `search_book` and `search_notes` continue to work with the existing query embedding path.

---

## Self-Review

**Spec coverage:** The reported causes are covered directly: renderer ML inference is moved to a worker, large uninterrupted batches are reduced, the loop yields between batches, and reader activity can pause work between batches. Rust-side embedding is intentionally not included because the worker path is lower-risk and satisfies the immediate performance goal.

**Placeholder scan:** This plan contains no `TBD`, no unspecified error handling, and no test-only "write tests" placeholders. Every code-changing task includes concrete code or exact replacement snippets.

**Type consistency:** The plan consistently uses `embedForIndexing(texts, signal)`, `embedWithWorkerForIndexing(texts, signal)`, `markIndexingInteraction()`, `isIndexingInteractionActive()`, `yieldToUi(signal)`, `waitForIndexingIdle(signal)`, and `throwIfAborted(signal)`.
