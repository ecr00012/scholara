import { embedWithWorkerForIndexing } from './workerEmbedderClient';

export async function embedForIndexing(
  texts: string[],
  signal?: AbortSignal,
): Promise<Float32Array[]> {
  return embedWithWorkerForIndexing(texts, signal);
}
