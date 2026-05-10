import { create } from 'zustand';
import { getDb } from './db/client';
import * as booksDb from './db/books';
import * as notesDb from './db/notes';
import * as vocabDb from './db/vocabulary';
import * as secretsIpc from './ipc/secrets';
import { runMetadataExtractionPass as runMetadataExtractionPassLib } from './lib/extractMetadata';
import type { Book, FileType, NoteRow, VocabRow } from './db/types';
import type { Position } from './lib/positionShape';
import {
  createAgentSessionSlice,
  type AgentSessionSlice,
} from './agent/session/slice';
import type {
  ReaderNavItem,
  ReaderPreferences,
  ReaderSearchResult,
  ReaderSearchStatus,
} from './screens/Reader/readerSupport';
import { DEFAULT_READER_PREFERENCES } from './screens/Reader/readerSupport';

export type AppView = 'library' | 'settings' | 'reader';

interface AppState extends AgentSessionSlice {
  view: AppView;
  books: Book[];
  openrouterApiKey: string | null;
  gutenbergApiKey: string | null;
  gutenbergApiKeyError: string | null;
  apiKeyBannerDismissed: boolean;
  currentBookId: number | null;
  currentBookNotes: NoteRow[];
  currentBookVocab: VocabRow[];
  notesModeActive: boolean;
  extractionInFlight: Set<number>;
  readerNavItems: ReaderNavItem[];
  readerSearchQuery: string;
  readerSearchResults: ReaderSearchResult[];
  readerSearchStatus: ReaderSearchStatus;
  readerPreferences: ReaderPreferences;

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
  loadOpenrouterApiKey: () => Promise<void>;
  saveOpenrouterApiKey: (key: string) => Promise<void>;
  loadGutenbergApiKey: () => Promise<void>;
  saveGutenbergApiKey: (key: string) => Promise<void>;
  dismissApiKeyBanner: () => void;
  openBook: (id: number) => Promise<void>;
  closeBook: () => void;
  patchBook: (id: number, patch: Partial<Book>) => void;
  setBookDisplayMode: (id: number, mode: 'agent' | 'reader') => Promise<void>;
  setBookCurrentPosition: (id: number, position: Position) => Promise<void>;
  setBookEpubLocations: (id: number, locations: string) => Promise<void>;
  setNotesModeActive: (active: boolean) => void;
  setReaderNavItems: (items: ReaderNavItem[]) => void;
  setReaderSearchQuery: (query: string) => void;
  setReaderSearchResults: (
    results: ReaderSearchResult[],
    status?: ReaderSearchStatus,
  ) => void;
  setReaderSearchStatus: (status: ReaderSearchStatus) => void;
  setReaderPreferences: (preferences: ReaderPreferences) => void;
  clearReaderSupport: () => void;
  reloadNotesForCurrentBook: () => Promise<void>;
  reloadVocabForCurrentBook: () => Promise<void>;
  insertNoteForCurrentBook: (input: {
    page_or_position: string;
    note_text: string | null;
    quote_text: string | null;
  }) => Promise<void>;
  insertVocabForCurrentBook: (input: {
    word: string;
    definition: string;
  }) => Promise<vocabDb.InsertVocabularyResult>;
  deleteNote: (id: number) => Promise<void>;
  deleteVocabulary: (id: number) => Promise<void>;
  runMetadataExtractionPass: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get, api) => ({
  ...createAgentSessionSlice<Omit<AppState, keyof AgentSessionSlice>>({
    getBookById: (id) => get().books.find((book) => book.id === id) ?? null,
    getCurrentBookNotes: () => get().currentBookNotes,
    getCurrentBookVocab: () => get().currentBookVocab,
  })(set, get, api),

  view: 'library',
  books: [],
  openrouterApiKey: null,
  gutenbergApiKey: null,
  gutenbergApiKeyError: null,
  apiKeyBannerDismissed: false,
  currentBookId: null,
  currentBookNotes: [],
  currentBookVocab: [],
  notesModeActive: false,
  extractionInFlight: new Set<number>(),
  readerNavItems: [],
  readerSearchQuery: '',
  readerSearchResults: [],
  readerSearchStatus: 'idle',
  readerPreferences: DEFAULT_READER_PREFERENCES,

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

  loadOpenrouterApiKey: async () => {
    const openrouterApiKey = await secretsIpc.getSecret('openrouter');
    set({ openrouterApiKey });
  },

  saveOpenrouterApiKey: async (key) => {
    await secretsIpc.setSecret('openrouter', key);
    set({ openrouterApiKey: key === '' ? null : key });
  },

  loadGutenbergApiKey: async () => {
    try {
      const gutenbergApiKey = await secretsIpc.getSecret('gutenberg');
      set({ gutenbergApiKey, gutenbergApiKeyError: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('Could not load Gutenberg API key:', err);
      set({
        gutenbergApiKeyError: `Could not load your Project Gutenberg API key from the system keychain. ${message}`,
      });
    }
  },

  saveGutenbergApiKey: async (key) => {
    try {
      await secretsIpc.setSecret('gutenberg', key);
      set({
        gutenbergApiKey: key === '' ? null : key,
        gutenbergApiKeyError: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({
        gutenbergApiKeyError: `Could not save your Project Gutenberg API key to the system keychain. ${message}`,
      });
      throw err;
    }
  },

  dismissApiKeyBanner: () => set({ apiKeyBannerDismissed: true }),

  openBook: async (id) => {
    get().clearAgentSession();
    set({
      currentBookId: id,
      view: 'reader',
      notesModeActive: false,
      currentBookNotes: [],
      currentBookVocab: [],
      readerNavItems: [],
      readerSearchQuery: '',
      readerSearchResults: [],
      readerSearchStatus: 'idle',
    });
    const db = await getDb();
    void booksDb.setLastOpened(db, id);
    await Promise.all([
      get().reloadNotesForCurrentBook(),
      get().reloadVocabForCurrentBook(),
    ]);
    await get().initAgentSessionForBook(id);
  },

  closeBook: () => {
    get().clearAgentSession();
    set({
      currentBookId: null,
      view: 'library',
      notesModeActive: false,
      currentBookNotes: [],
      currentBookVocab: [],
      readerNavItems: [],
      readerSearchQuery: '',
      readerSearchResults: [],
      readerSearchStatus: 'idle',
    });
  },

  patchBook: (id, patch) =>
    set({
      books: get().books.map((book) =>
        book.id === id ? { ...book, ...patch } : book,
      ),
    }),

  setBookDisplayMode: async (id, mode) => {
    const db = await getDb();
    await booksDb.setDisplayMode(db, id, mode);
    get().patchBook(id, { display_mode: mode });
  },

  setBookCurrentPosition: async (id, position) => {
    const db = await getDb();
    await booksDb.setCurrentPosition(db, id, position);
    get().patchBook(id, { current_position: JSON.stringify(position) });
  },

  setBookEpubLocations: async (id, locations) => {
    const db = await getDb();
    await booksDb.setEpubLocations(db, id, locations);
    get().patchBook(id, { epub_locations: locations });
  },

  setNotesModeActive: (active) => set({ notesModeActive: active }),

  setReaderNavItems: (items) => set({ readerNavItems: items }),

  setReaderSearchQuery: (query) => set({ readerSearchQuery: query }),

  setReaderSearchResults: (results, status = 'ready') =>
    set({ readerSearchResults: results, readerSearchStatus: status }),

  setReaderSearchStatus: (status) => set({ readerSearchStatus: status }),

  setReaderPreferences: (preferences) => set({ readerPreferences: preferences }),

  clearReaderSupport: () =>
    set({
      readerNavItems: [],
      readerSearchQuery: '',
      readerSearchResults: [],
      readerSearchStatus: 'idle',
    }),

  reloadNotesForCurrentBook: async () => {
    const id = get().currentBookId;
    if (id === null) return;
    const db = await getDb();
    set({ currentBookNotes: await notesDb.listNotesForBook(db, id) });
  },

  reloadVocabForCurrentBook: async () => {
    const id = get().currentBookId;
    if (id === null) return;
    const db = await getDb();
    set({ currentBookVocab: await vocabDb.listVocabularyForBook(db, id) });
  },

  insertNoteForCurrentBook: async (input) => {
    const id = get().currentBookId;
    if (id === null) throw new Error('No current book');
    const db = await getDb();
    await notesDb.insertNote(db, { book_id: id, ...input });
    await get().reloadNotesForCurrentBook();
  },

  insertVocabForCurrentBook: async (input) => {
    const id = get().currentBookId;
    if (id === null) throw new Error('No current book');
    const db = await getDb();
    const result = await vocabDb.insertVocabulary(db, { ...input, book_id: id });
    if (result.inserted) {
      await get().reloadVocabForCurrentBook();
    }
    return result;
  },

  deleteNote: async (id) => {
    const db = await getDb();
    await notesDb.deleteNote(db, id);
    await get().reloadNotesForCurrentBook();
  },

  deleteVocabulary: async (id) => {
    const db = await getDb();
    await vocabDb.deleteVocabulary(db, id);
    await get().reloadVocabForCurrentBook();
  },

  runMetadataExtractionPass: async () => {
    const driver = {
      extractionInFlight: get().extractionInFlight,
      patchBook: get().patchBook,
    };
    await runMetadataExtractionPassLib(driver);
  },
}));
