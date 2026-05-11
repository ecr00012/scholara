import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveResource } from '@tauri-apps/api/path';

interface EmbedRequestMessage {
  id: string;
  type: 'embed';
  texts: string[];
  localModelPath: string;
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
let localModelPathPromise: Promise<string> | null = null;
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
      removeAbortListener(request);

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
        removeAbortListener(request);
        request.reject(error);
      }
    };
  }
  return worker;
}

async function resolveWorkerModelPath(): Promise<string> {
  if (!localModelPathPromise) {
    localModelPathPromise = (async () => {
      const modelsDir = await resolveResource('resources/models');
      const modelsUrl = convertFileSrc(modelsDir, 'asset');
      return modelsUrl.endsWith('/') ? modelsUrl : modelsUrl + '/';
    })();
  }
  return localModelPathPromise;
}

function removeAbortListener(request: PendingRequest): void {
  if (request.abortListener) {
    request.signal?.removeEventListener('abort', request.abortListener);
  }
}

export async function embedWithWorkerForIndexing(
  texts: string[],
  signal?: AbortSignal,
): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  if (signal?.aborted) throw new Error('aborted');

  const localModelPath = await resolveWorkerModelPath();
  if (signal?.aborted) throw new Error('aborted');

  const id = String(nextId++);
  const message: EmbedRequestMessage = {
    id,
    type: 'embed',
    texts,
    localModelPath,
  };

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
    removeAbortListener(request);
    request.reject(new Error('worker reset'));
  }
  worker?.terminate();
  worker = null;
  nextId = 1;
  localModelPathPromise = null;
}
