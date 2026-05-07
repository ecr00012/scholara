export interface GutenbergAuthor {
  id: number;
  name: string;
}

export interface GutenbergBook {
  id: number;
  title: string;
  alternative_title: string | null;
  authors: GutenbergAuthor[];
  subjects: string[];
  bookshelves: string[];
  media_type: string;
  download_count: number;
  issued: string | null;
  reading_ease_score: string | null;
  cover_image: string | null;
}

interface BooksResponse {
  results: GutenbergBook[];
}

export type FetchResult =
  | { kind: 'ok'; books: GutenbergBook[] }
  | { kind: 'invalid-key' }
  | { kind: 'api-error'; status: number }
  | { kind: 'offline' };

const BASE_URL = 'https://gutenbergapi.com';

function isOffline(): boolean {
  const nav =
    typeof globalThis.navigator === 'undefined'
      ? undefined
      : globalThis.navigator;
  return typeof nav?.onLine === 'boolean' && nav.onLine === false;
}

async function callApi(url: string, key: string): Promise<FetchResult> {
  if (isOffline()) return { kind: 'offline' };
  if (typeof globalThis.fetch !== 'function') return { kind: 'offline' };

  let resp: Response;
  try {
    resp = await globalThis.fetch(url, {
      method: 'GET',
      headers: { 'X-RapidAPI-Key': key },
    });
  } catch {
    return { kind: 'offline' };
  }

  if (resp.status === 401 || resp.status === 403) {
    return { kind: 'invalid-key' };
  }
  if (!resp.ok) {
    return { kind: 'api-error', status: resp.status };
  }

  let json: BooksResponse;
  try {
    json = (await resp.json()) as BooksResponse;
  } catch {
    return { kind: 'api-error', status: resp.status };
  }

  if (!json || !Array.isArray(json.results)) {
    return { kind: 'api-error', status: resp.status };
  }

  return { kind: 'ok', books: json.results };
}

export async function verifyKey(key: string): Promise<FetchResult> {
  return callApi(`${BASE_URL}/books?page_size=1`, key);
}

export async function fetchBooks(
  offset: number,
  key: string,
): Promise<FetchResult> {
  const url = `${BASE_URL}/books?ordering=-download_count&page_size=4&offset=${offset}`;
  return callApi(url, key);
}
