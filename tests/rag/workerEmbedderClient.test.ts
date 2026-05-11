// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { convertFileSrcMock, resolveResourceMock } = vi.hoisted(() => ({
  convertFileSrcMock: vi.fn((path: string) => `asset://${path}`),
  resolveResourceMock: vi.fn(async (path: string) => `/resources/${path}`),
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: convertFileSrcMock,
}));

vi.mock('@tauri-apps/api/path', () => ({
  resolveResource: resolveResourceMock,
}));

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
    vi.clearAllMocks();
    convertFileSrcMock.mockImplementation((path: string) => `asset://${path}`);
    resolveResourceMock.mockResolvedValue('/resources/resources/models');
    MockWorker.instances = [];
  });

  it('resolves vectors returned by the worker', async () => {
    const { embedWithWorkerForIndexing } = await import(
      '../../src/rag/workerEmbedderClient'
    );
    const promise = embedWithWorkerForIndexing(['alpha', 'beta']);
    await vi.waitFor(() => {
      expect(MockWorker.instances[0]?.posted.length).toBe(1);
    });
    const worker = MockWorker.instances[0];
    const posted = worker.posted[0] as {
      id: string;
      texts: string[];
      localModelPath: string;
    };
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
    expect(posted.localModelPath).toBe('asset:///resources/resources/models/');
  });

  it('rejects when the worker returns an error', async () => {
    const { embedWithWorkerForIndexing } = await import(
      '../../src/rag/workerEmbedderClient'
    );
    const promise = embedWithWorkerForIndexing(['alpha']);
    await vi.waitFor(() => {
      expect(MockWorker.instances[0]?.posted.length).toBe(1);
    });
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
    await vi.waitFor(() => {
      expect(MockWorker.instances[0]?.posted.length).toBe(1);
    });
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
