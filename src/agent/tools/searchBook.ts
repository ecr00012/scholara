import { getDb } from '../../db/client';
import { loadChunksForBook, bytesToFloat32 } from '../../db/bookChunks';
import { embedOne } from '../../rag/embedder';
import { cosine, topK } from '../../rag/cosine';
import { maxOrdinalForPosition, type ChunkOrdinalIndex } from '../spoilerGuard';
import type { Position } from '../../lib/positionShape';

export interface SearchBookResult {
  position_marker: string;
  text: string;
  score: number;
}

export interface SearchBookParams {
  bookId: number;
  query: string;
  k?: number;
  spoilerCap: { enabled: boolean; position: Position | null; index: ChunkOrdinalIndex };
}

export async function searchBook(p: SearchBookParams): Promise<SearchBookResult[]> {
  const k = p.k ?? 6;
  const maxOrdinal = p.spoilerCap.enabled
    ? maxOrdinalForPosition(p.spoilerCap.position, p.spoilerCap.index)
    : null;
  const db = await getDb();
  const chunks = await loadChunksForBook(db, p.bookId, maxOrdinal);
  if (chunks.length === 0) return [];

  const qVec = await embedOne(p.query);
  if (qVec.length === 0) {
    throw new Error('query embedding returned an empty vector');
  }

  const scored = chunks.map((c) => {
    const chunkVec = bytesToFloat32(
      c.embedding as unknown as Uint8Array | number[] | ArrayBuffer | string,
    );
    if (chunkVec.length !== qVec.length) {
      throw new Error(
        `stored embedding dimension mismatch for chunk ${c.id}: expected ${qVec.length}, got ${chunkVec.length}`,
      );
    }
    return {
      item: c,
      score: cosine(qVec, chunkVec),
    };
  });
  return topK(scored, k).map((s) => ({
    position_marker: s.item.position_marker,
    text: s.item.text,
    score: s.score,
  }));
}
