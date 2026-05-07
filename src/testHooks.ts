import { getDb } from './db/client';
import * as booksDb from './db/books';
import * as notesDb from './db/notes';
import * as vocabDb from './db/vocabulary';
import { useAppStore } from './store';
import type { Book, FileType } from './db/types';

interface SeedBookInput {
  title: string;
  file_path: string;
  file_type: FileType;
  author?: string | null;
}

interface SeedNoteInput {
  book_id: number;
  page_or_position: string;
  note_text: string | null;
  quote_text: string | null;
}

interface AppTestHooks {
  seedBook(input: SeedBookInput): Promise<Book>;
  seedNote(input: SeedNoteInput): Promise<number>;
  clearGutenbergCache(): Promise<void>;
  getCurrentPosition(): string | null;
  listNotes(bookId: number): Promise<Awaited<ReturnType<typeof notesDb.listNotesForBook>>>;
  listVocabulary(bookId?: number): Promise<Awaited<ReturnType<typeof vocabDb.listAllVocabulary>>>;
}

export function installTestHooks(): void {
  if (!import.meta.env.VITE_E2E) return;

  const target = window as Window & { __appTestHooks?: AppTestHooks };
  if (target.__appTestHooks) return;

  target.__appTestHooks = {
    async seedBook(input) {
      const db = await getDb();
      const id = await booksDb.insertBook(db, {
        title: input.title,
        author: input.author ?? null,
        file_path: input.file_path,
        file_type: input.file_type,
      });
      await useAppStore.getState().loadBooks();
      const inserted = useAppStore.getState().books.find((book) => book.id === id);
      if (!inserted) {
        throw new Error(`Seeded book ${id} was not found after loadBooks().`);
      }
      return inserted;
    },

    async seedNote(input) {
      const db = await getDb();
      const id = await notesDb.insertNote(db, input);
      if (useAppStore.getState().currentBookId === input.book_id) {
        await useAppStore.getState().reloadNotesForCurrentBook();
      }
      return id;
    },

    async clearGutenbergCache() {
      const db = await getDb();
      await db.execute(
        'UPDATE gutenberg_panel_state SET last_fetched_at = NULL, payload_json = NULL WHERE id = 1',
      );
    },

    getCurrentPosition() {
      const { currentBookId, books } = useAppStore.getState();
      const book = books.find((candidate) => candidate.id === currentBookId);
      return book?.current_position ?? null;
    },

    async listNotes(bookId) {
      const db = await getDb();
      return notesDb.listNotesForBook(db, bookId);
    },

    async listVocabulary(bookId) {
      const db = await getDb();
      if (typeof bookId === 'number') {
        return vocabDb.listVocabularyForBook(db, bookId);
      }
      return vocabDb.listAllVocabulary(db);
    },
  };
}
