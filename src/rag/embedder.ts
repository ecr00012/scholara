import { resolveResource } from '@tauri-apps/api/path';
import { env, pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';

export const EMBEDDER_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIM = 384;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

async function configureEnv(): Promise<void> {
  // Resolve the bundled model directory; transformers.js expects the parent
  // path that contains `<org>/<model>/...` so it can append the model id itself.
  const modelsDir = await resolveResource('resources/models');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  // Plan-literal form; if the renderer-side fetch can't resolve a raw OS path
  // during tauri dev we'll switch to convertFileSrc(modelsDir) + '/'.
  env.localModelPath = modelsDir + '/';
  env.useBrowserCache = false;
}

export async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      await configureEnv();
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
