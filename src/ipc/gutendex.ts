import { invoke } from '@tauri-apps/api/core';
import type { GutenbergBook } from '../lib/gutenbergApi';

interface RawGutendexPage {
  books: GutenbergBook[];
}

export async function fetchGutendexPage(page: number): Promise<GutenbergBook[]> {
  const result = await invoke<RawGutendexPage>('fetch_gutendex_page', {
    page,
  });
  return result.books;
}
