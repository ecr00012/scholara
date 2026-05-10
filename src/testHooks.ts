import { getDb } from './db/client';
import * as booksDb from './db/books';
import * as notesDb from './db/notes';
import * as vocabDb from './db/vocabulary';
import * as gutenbergPanelDb from './db/gutenbergPanel';
import { upsertIndexState } from './db/bookIndexState';
import { useAppStore } from './store';
import type { Book, FileType } from './db/types';
import type { GutenbergBook } from './lib/gutenbergApi';

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

interface SeedChatIndexInput {
  book_id: number;
  /** Plain-text chunks to insert as `book_chunks` rows. Defaults to a small stub set. */
  chunks?: string[];
  /** position_marker for each chunk; defaults to "1", "2", ... */
  positionMarkers?: string[];
}

interface AppTestHooks {
  seedBook(input: SeedBookInput): Promise<Book>;
  seedNote(input: SeedNoteInput): Promise<number>;
  clearGutenbergCache(): Promise<void>;
  seedGutenbergCache(input: {
    cursor: number;
    lastFetchedAt: number | null;
    payload: GutenbergBook[] | null;
  }): Promise<void>;
  getCurrentPosition(): string | null;
  listNotes(bookId: number): Promise<Awaited<ReturnType<typeof notesDb.listNotesForBook>>>;
  listVocabulary(bookId?: number): Promise<Awaited<ReturnType<typeof vocabDb.listAllVocabulary>>>;
  /**
   * Pre-seed `book_index_state` to 'ready' and insert stub `book_chunks` rows
   * so the AI Chat tab opens directly into the chat UI without triggering
   * the real (transformers.js + extractText) indexing pipeline during E2E.
   * Embeddings are stored as zero-filled 384-dim vectors — fine because
   * Playwright tests never hit the real RAG search path; the chat_stream
   * mock short-circuits the LLM call.
   */
  seedChatIndex(input: SeedChatIndexInput): Promise<void>;
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

    async seedGutenbergCache(input) {
      const db = await getDb();
      await gutenbergPanelDb.setCachedFetch(db, input);
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

    async seedChatIndex(input) {
      const db = await getDb();
      const chunks = input.chunks ?? [
        'Stub chunk one.',
        'Stub chunk two.',
        'Stub chunk three.',
      ];
      const markers =
        input.positionMarkers ?? chunks.map((_, i) => String(i + 1));
      // Clear any previous chunks for this book.
      await db.execute(`DELETE FROM book_chunks WHERE book_id = ?`, [input.book_id]);
      // Insert stub chunks with zero-filled 384-dim embeddings (1536 bytes each).
      const zeroBytes = new Uint8Array(384 * 4);
      for (let i = 0; i < chunks.length; i++) {
        await db.execute(
          `INSERT INTO book_chunks (book_id, ordinal, position_marker, text, embedding)
           VALUES (?, ?, ?, ?, ?)`,
          [input.book_id, i, markers[i] ?? String(i + 1), chunks[i], zeroBytes],
        );
      }
      await upsertIndexState(db, {
        book_id: input.book_id,
        status: 'ready',
        chunk_count: chunks.length,
        embedder_model: 'Xenova/all-MiniLM-L6-v2',
        content_hash: 'e2e-stub',
        error: null,
      });
    },
  };
}
