import { fetchGutendexPage } from '../ipc/gutendex';
import { cursorToPageSlice, needsSecondPage, slicePages } from './gutendexPagination';

export interface GutenbergAuthor {
  name: string;
}

export interface GutenbergBook {
  id: number;
  title: string;
  authors: GutenbergAuthor[];
  subjects: string[];
  bookshelves: string[];
  download_count: number;
  cover_image: string | null;
  issued: string | null;
  reading_ease_score: string | null;
}

export type FetchResult =
  | { kind: 'ok'; books: GutenbergBook[] }
  | { kind: 'api-error' }
  | { kind: 'offline' };

function isOffline(): boolean {
  const nav = typeof globalThis.navigator === 'undefined' ? undefined : globalThis.navigator;
  return typeof nav?.onLine === 'boolean' && nav.onLine === false;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function fetchBooks(cursor: number): Promise<FetchResult> {
  if (isOffline()) return { kind: 'offline' };

  const { page, slice } = cursorToPageSlice(cursor);

  try {
    const firstPage = await fetchGutendexPage(page);
    const secondPage = needsSecondPage(slice) ? await fetchGutendexPage(page + 1) : undefined;
    return { kind: 'ok', books: slicePages(slice, firstPage, secondPage) };
  } catch (err) {
    if (isOffline()) return { kind: 'offline' };
    return errorMessage(err).startsWith('network:') ? { kind: 'offline' } : { kind: 'api-error' };
  }
}
