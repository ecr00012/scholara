import { getDb } from '../../db/client';
import * as notesDb from '../../db/notes';
import * as vocabDb from '../../db/vocabulary';
import { embed, embedOne } from '../../rag/embedder';
import { cosine, topK } from '../../rag/cosine';

export interface SearchNotesResult {
  kind: 'note' | 'quote' | 'definition';
  position_marker?: string;
  text: string;
  score: number;
}

interface CachedItem {
  kind: SearchNotesResult['kind'];
  text: string;
  position_marker?: string;
  vector: Float32Array;
}

const sessionCache = new Map<number, Promise<CachedItem[]>>();

async function buildCache(bookId: number): Promise<CachedItem[]> {
  const db = await getDb();
  const [notes, vocab] = await Promise.all([
    notesDb.listNotesForBook(db, bookId),
    vocabDb.listVocabularyForBook(db, bookId),
  ]);
  const items: { kind: SearchNotesResult['kind']; text: string; position_marker?: string }[] = [];
  for (const n of notes) {
    if (n.note_text) items.push({ kind: 'note', text: n.note_text, position_marker: n.page_or_position });
    if (n.quote_text) items.push({ kind: 'quote', text: n.quote_text, position_marker: n.page_or_position });
  }
  for (const v of vocab) {
    items.push({ kind: 'definition', text: `${v.word}: ${v.definition}` });
  }
  if (items.length === 0) return [];
  const vectors = await embed(items.map((i) => i.text));
  return items.map((it, i) => ({ ...it, vector: vectors[i] }));
}

export function invalidateNoteCache(bookId: number): void {
  sessionCache.delete(bookId);
}

export interface SearchNotesParams {
  bookId: number;
  query: string;
  k?: number;
}

export async function searchNotes(p: SearchNotesParams): Promise<SearchNotesResult[]> {
  const k = p.k ?? 6;
  if (!sessionCache.has(p.bookId)) sessionCache.set(p.bookId, buildCache(p.bookId));
  const items = await sessionCache.get(p.bookId)!;
  if (items.length === 0) return [];
  const qVec = await embedOne(p.query);
  const scored = items.map((it) => ({ item: it, score: cosine(qVec, it.vector) }));
  return topK(scored, k).map((s) => ({
    kind: s.item.kind,
    position_marker: s.item.position_marker,
    text: s.item.text,
    score: s.score,
  }));
}
