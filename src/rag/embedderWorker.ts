import type { FeatureExtractionPipeline } from '@xenova/transformers';
import { EMBEDDING_DIM, EMBEDDER_MODEL_ID } from './embedder';

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

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;
let configuredLocalModelPath: string | null = null;

const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<EmbedRequestMessage>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

async function getWorkerEmbedder(
  localModelPath: string,
): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise || configuredLocalModelPath !== localModelPath) {
    configuredLocalModelPath = localModelPath;
    pipelinePromise = (async () => {
      const { env, pipeline } = await import(
        '@xenova/transformers/dist/transformers.js'
      );

      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = localModelPath;
      env.useBrowserCache = false;

      return (await pipeline('feature-extraction', EMBEDDER_MODEL_ID, {
        quantized: true,
      })) as FeatureExtractionPipeline;
    })();
  }
  return pipelinePromise;
}

workerSelf.onmessage = async (event: MessageEvent<EmbedRequestMessage>) => {
  const message = event.data;
  if (message.type !== 'embed') return;

  try {
    const ext = await getWorkerEmbedder(message.localModelPath);
    const out = await ext(message.texts, {
      pooling: 'mean',
      normalize: true,
    });
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
    workerSelf.postMessage(response, vectors);
  } catch (err) {
    const response: EmbedErrorMessage = {
      id: message.id,
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
    workerSelf.postMessage(response);
  }
};
