import { embed } from './embedder';

export async function embedForIndexing(
  texts: string[],
  _signal?: AbortSignal,
): Promise<Float32Array[]> {
  return embed(texts);
}
