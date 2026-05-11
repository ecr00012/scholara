import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveResource } from '@tauri-apps/api/path';
import type { FeatureExtractionPipeline } from '@xenova/transformers';

export const EMBEDDER_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDER_INDEX_ID = `${EMBEDDER_MODEL_ID}:base64-embeddings-v1`;
export const EMBEDDING_DIM = 384;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

export async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      // Dynamic import isolates transformers.js (and its onnxruntime-web chain)
      // so a failure here doesn't crash the renderer at module-eval time.
      const { env, pipeline } = await import(
        '@xenova/transformers/dist/transformers.js'
      );
      const modelsDir = await resolveResource('resources/models');
      const modelsUrl = convertFileSrc(modelsDir, 'asset');
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = modelsUrl.endsWith('/') ? modelsUrl : modelsUrl + '/';
      env.useBrowserCache = false;
      return (await pipeline('feature-extraction', EMBEDDER_MODEL_ID, {
        quantized: true,
      })) as FeatureExtractionPipeline;
    })();
  }
  return pipelinePromise;
}

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const ext = await getEmbedder();
  // Mean-pool + normalize so cosine similarity is well-behaved.
  const out = await ext(texts, { pooling: 'mean', normalize: true });
  // `out` is a Tensor with `data: Float32Array` of length texts.length * 384.
  const data = out.data as Float32Array;
  const result: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    result.push(data.slice(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM));
  }
  return result;
}

export async function embedOne(text: string): Promise<Float32Array> {
  const [vec] = await embed([text]);
  return vec;
}

/** Test-only: reset the cached pipeline (useful for test isolation). */
export function _resetEmbedderForTests(): void {
  pipelinePromise = null;
}
