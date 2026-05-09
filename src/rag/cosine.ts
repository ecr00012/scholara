export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error('vector length mismatch');
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** For mean-pooled, normalized vectors from the embedder, cosine == dot. */
export function cosine(a: Float32Array, b: Float32Array): number {
  return dot(a, b);
}

export interface Scored<T> {
  item: T;
  score: number;
}

export function topK<T>(scored: Scored<T>[], k: number): Scored<T>[] {
  return scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
