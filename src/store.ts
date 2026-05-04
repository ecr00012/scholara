import { create } from 'zustand';
import { getDb } from './db/client';
import * as booksDb from './db/books';
import * as secretsIpc from './ipc/secrets';
import type { Book, FileType } from './db/types';

export type AppView = 'library' | 'settings';

interface AppState {
  view: AppView;
  books: Book[];
  apiKey: string | null;
  apiKeyBannerDismissed: boolean;

  setView: (view: AppView) => void;
  loadBooks: () => Promise<void>;
  insertBook: (input: {
    title: string;
    file_path: string;
    file_type: FileType;
  }) => Promise<Book>;
  updateBookMetadata: (
    id: number,
    patch: { title: string; author: string | null },
  ) => Promise<void>;
  deleteBook: (id: number) => Promise<void>;
  loadApiKey: () => Promise<void>;
  saveApiKey: (key: string) => Promise<void>;
  dismissApiKeyBanner: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'library',
  books: [],
  apiKey: null,
  apiKeyBannerDismissed: false,

  setView: (view) => set({ view }),

  loadBooks: async () => {
    const db = await getDb();
    const books = await booksDb.listBooks(db);
    set({ books });
  },

  insertBook: async (input) => {
    const db = await getDb();
    const id = await booksDb.insertBook(db, {
      title: input.title,
      author: null,
      file_path: input.file_path,
      file_type: input.file_type,
    });
    const fresh = await booksDb.listBooks(db);
    set({ books: fresh });
    const inserted = fresh.find((b) => b.id === id);
    if (!inserted) throw new Error('Inserted book missing from listBooks');
    return inserted;
  },

  updateBookMetadata: async (id, patch) => {
    const db = await getDb();
    await booksDb.updateMetadata(db, id, patch);
    const fresh = await booksDb.listBooks(db);
    set({ books: fresh });
  },

  deleteBook: async (id) => {
    const db = await getDb();
    await booksDb.deleteBook(db, id);
    set({ books: get().books.filter((b) => b.id !== id) });
  },

  loadApiKey: async () => {
    const apiKey = await secretsIpc.getApiKey();
    set({ apiKey });
  },

  saveApiKey: async (key) => {
    await secretsIpc.setApiKey(key);
    set({ apiKey: key === '' ? null : key });
  },

  dismissApiKeyBanner: () => set({ apiKeyBannerDismissed: true }),
}));
