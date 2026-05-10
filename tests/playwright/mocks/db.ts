type FileType = 'pdf' | 'epub';
type DisplayMode = 'agent' | 'reader';
type MetadataSource = 'filename' | 'user' | 'extracted';

interface BookRow {
  id: number;
  title: string;
  author: string | null;
  cover_image_path: string | null;
  file_path: string;
  file_type: FileType;
  last_opened: string | null;
  current_position: string | null;
  display_mode: DisplayMode;
  metadata_source: MetadataSource;
  epub_locations: string | null;
  created_at: string;
}

interface NoteRow {
  id: number;
  book_id: number;
  page_or_position: string;
  note_text: string | null;
  quote_text: string | null;
  created_at: string;
}

interface VocabRow {
  id: number;
  word: string;
  definition: string;
  book_id: number;
  created_at: string;
}

interface GutenbergPanelStateRow {
  id: 1;
  cursor_offset: number;
  last_fetched_at: number | null;
  payload_json: string | null;
}

interface ThreadRow {
  id: number;
  book_id: number;
  title: string | null;
  spoiler_mode: number;
  model: string;
  last_active_at: string;
  created_at: string;
}

interface MessageRow {
  id: number;
  thread_id: number;
  role: 'user' | 'assistant';
  content: string;
  position_at_send: string | null;
  created_at: string;
}

interface BookChunkRow {
  id: number;
  book_id: number;
  ordinal: number;
  position_marker: string;
  text: string;
  embedding: Uint8Array | number[];
  created_at: string;
}

interface BookIndexStateRow {
  book_id: number;
  status: 'pending' | 'indexing' | 'ready' | 'failed';
  chunk_count: number | null;
  embedder_model: string | null;
  content_hash: string | null;
  error: string | null;
  updated_at: string;
}

interface PreferenceRow {
  id: number;
  scope: 'global' | 'book';
  book_id: number | null;
  text: string;
  created_at: string;
}

interface ReaderProfileRow {
  scope: string;
  summary: string;
  turn_count: number;
  updated_at: string;
}

interface MockState {
  books: BookRow[];
  notes: NoteRow[];
  vocabulary: VocabRow[];
  gutenbergPanelState: GutenbergPanelStateRow;
  threads: ThreadRow[];
  messages: MessageRow[];
  bookChunks: BookChunkRow[];
  bookIndexState: BookIndexStateRow[];
  preferences: PreferenceRow[];
  readerProfile: ReaderProfileRow[];
  nextIds: {
    books: number;
    notes: number;
    vocabulary: number;
    threads: number;
    messages: number;
    bookChunks: number;
    preferences: number;
  };
  clock: number;
}

const state = getState();

export default class DatabaseMock {
  static async load(_connection: string): Promise<DatabaseMock> {
    return new DatabaseMock();
  }

  async execute(sql: string, params: unknown[] = []) {
    const normalized = normalizeSql(sql);

    if (normalized.startsWith('pragma foreign_keys = on')) {
      return { lastInsertId: 0, rowsAffected: 0 };
    }

    if (normalized.startsWith('update gutenberg_panel_state')) {
      if (normalized.includes('set cursor_offset = ?, last_fetched_at = ?, payload_json = ?')) {
        const [cursorOffset, lastFetchedAt, payloadJson] = params as [
          number,
          number | null,
          string | null,
        ];
        state.gutenbergPanelState = {
          id: 1,
          cursor_offset: cursorOffset,
          last_fetched_at: lastFetchedAt,
          payload_json: payloadJson,
        };
        return { lastInsertId: 0, rowsAffected: 1 };
      }

      if (normalized.includes('set last_fetched_at = null, payload_json = null')) {
        state.gutenbergPanelState.last_fetched_at = null;
        state.gutenbergPanelState.payload_json = null;
        return { lastInsertId: 0, rowsAffected: 1 };
      }
    }

    if (normalized.startsWith('insert into books')) {
      const [title, author, filePath, fileType] = params as [
        string,
        string | null,
        string,
        FileType,
      ];
      const existing = state.books.find((book) => book.file_path === filePath);
      if (existing) {
        throw new Error(`UNIQUE constraint failed: books.file_path (${filePath})`);
      }
      const id = state.nextIds.books++;
      state.books.push({
        id,
        title,
        author,
        cover_image_path: null,
        file_path: filePath,
        file_type: fileType,
        last_opened: null,
        current_position: null,
        display_mode: 'agent',
        metadata_source: 'filename',
        epub_locations: null,
        created_at: nextTimestamp(),
      });
      return { lastInsertId: id, rowsAffected: 1 };
    }

    if (normalized.startsWith("update books set title = ?, author = ?, metadata_source = 'user'")) {
      const [title, author, id] = params as [string, string | null, number];
      const book = requireBook(id);
      book.title = title;
      book.author = author;
      book.metadata_source = 'user';
      return { lastInsertId: 0, rowsAffected: 1 };
    }

    if (normalized.startsWith('delete from books where id = ?')) {
      const [id] = params as [number];
      const before = state.books.length;
      state.books = state.books.filter((book) => book.id !== id);
      state.notes = state.notes.filter((note) => note.book_id !== id);
      state.vocabulary = state.vocabulary.filter((row) => row.book_id !== id);
      return { lastInsertId: 0, rowsAffected: before === state.books.length ? 0 : 1 };
    }

    if (normalized.startsWith('update books set current_position = ? where id = ?')) {
      const [currentPosition, id] = params as [string, number];
      requireBook(id).current_position = currentPosition;
      return { lastInsertId: 0, rowsAffected: 1 };
    }

    if (normalized.startsWith('update books set display_mode = ? where id = ?')) {
      const [displayMode, id] = params as [DisplayMode, number];
      requireBook(id).display_mode = displayMode;
      return { lastInsertId: 0, rowsAffected: 1 };
    }

    if (normalized.startsWith("update books set last_opened = datetime('now') where id = ?")) {
      const [id] = params as [number];
      requireBook(id).last_opened = nextTimestamp();
      return { lastInsertId: 0, rowsAffected: 1 };
    }

    if (normalized.startsWith('update books set epub_locations = ? where id = ?')) {
      const [locations, id] = params as [string, number];
      requireBook(id).epub_locations = locations;
      return { lastInsertId: 0, rowsAffected: 1 };
    }

    if (normalized.startsWith("update books set metadata_source = 'extracted'")) {
      const [id] = params.slice(-1) as [number];
      const book = requireBook(id);
      let index = 0;
      if (normalized.includes('title = ?')) {
        book.title = params[index] as string;
        index += 1;
      }
      if (normalized.includes('author = ?')) {
        book.author = params[index] as string | null;
        index += 1;
      }
      if (normalized.includes('cover_image_path = ?')) {
        book.cover_image_path = params[index] as string | null;
      }
      book.metadata_source = 'extracted';
      return { lastInsertId: 0, rowsAffected: 1 };
    }

    if (normalized.startsWith('insert into notes')) {
      const [bookId, pageOrPosition, noteText, quoteText] = params as [
        number,
        string,
        string | null,
        string | null,
      ];
      requireBook(bookId);
      const id = state.nextIds.notes++;
      state.notes.push({
        id,
        book_id: bookId,
        page_or_position: pageOrPosition,
        note_text: noteText,
        quote_text: quoteText,
        created_at: nextTimestamp(),
      });
      return { lastInsertId: id, rowsAffected: 1 };
    }

    if (normalized.startsWith('delete from notes where id = ?')) {
      const [id] = params as [number];
      const before = state.notes.length;
      state.notes = state.notes.filter((note) => note.id !== id);
      return { lastInsertId: 0, rowsAffected: before === state.notes.length ? 0 : 1 };
    }

    if (normalized.startsWith('insert into vocabulary')) {
      const [word, definition, bookId] = params as [string, string, number];
      requireBook(bookId);
      const id = state.nextIds.vocabulary++;
      state.vocabulary.push({
        id,
        word,
        definition,
        book_id: bookId,
        created_at: nextTimestamp(),
      });
      return { lastInsertId: id, rowsAffected: 1 };
    }

    if (normalized.startsWith('delete from vocabulary where id = ?')) {
      const [id] = params as [number];
      const before = state.vocabulary.length;
      state.vocabulary = state.vocabulary.filter((row) => row.id !== id);
      return { lastInsertId: 0, rowsAffected: before === state.vocabulary.length ? 0 : 1 };
    }

    // ─── threads ────────────────────────────────────────────────────────────
    if (normalized.startsWith('insert into threads')) {
      const [bookId, model, spoilerMode] = params as [number, string, number];
      const id = state.nextIds.threads++;
      const ts = nextTimestamp();
      state.threads.push({
        id,
        book_id: bookId,
        title: null,
        spoiler_mode: spoilerMode,
        model,
        last_active_at: ts,
        created_at: ts,
      });
      return { lastInsertId: id, rowsAffected: 1 };
    }

    if (normalized.startsWith('update threads set title = ? where id = ?')) {
      const [title, id] = params as [string, number];
      const t = state.threads.find((row) => row.id === id);
      if (t) t.title = title;
      return { lastInsertId: 0, rowsAffected: t ? 1 : 0 };
    }

    if (normalized.startsWith('update threads set spoiler_mode = ? where id = ?')) {
      const [spoiler, id] = params as [number, number];
      const t = state.threads.find((row) => row.id === id);
      if (t) t.spoiler_mode = spoiler;
      return { lastInsertId: 0, rowsAffected: t ? 1 : 0 };
    }

    if (normalized.startsWith("update threads set last_active_at = datetime('now') where id = ?")) {
      const [id] = params as [number];
      const t = state.threads.find((row) => row.id === id);
      if (t) t.last_active_at = nextTimestamp();
      return { lastInsertId: 0, rowsAffected: t ? 1 : 0 };
    }

    if (normalized.startsWith('delete from threads where id = ?')) {
      const [id] = params as [number];
      const before = state.threads.length;
      state.threads = state.threads.filter((row) => row.id !== id);
      state.messages = state.messages.filter((row) => row.thread_id !== id);
      return { lastInsertId: 0, rowsAffected: before === state.threads.length ? 0 : 1 };
    }

    // ─── messages ───────────────────────────────────────────────────────────
    if (normalized.startsWith('insert into messages')) {
      const [threadId, role, content, positionAtSend] = params as [
        number,
        'user' | 'assistant',
        string,
        string | null,
      ];
      const id = state.nextIds.messages++;
      state.messages.push({
        id,
        thread_id: threadId,
        role,
        content,
        position_at_send: positionAtSend,
        created_at: nextTimestamp(),
      });
      return { lastInsertId: id, rowsAffected: 1 };
    }

    // ─── book_chunks ────────────────────────────────────────────────────────
    if (normalized.startsWith('insert into book_chunks')) {
      const [bookId, ordinal, marker, text, embedding] = params as [
        number,
        number,
        string,
        string,
        Uint8Array | number[],
      ];
      const id = state.nextIds.bookChunks++;
      state.bookChunks.push({
        id,
        book_id: bookId,
        ordinal,
        position_marker: marker,
        text,
        embedding,
        created_at: nextTimestamp(),
      });
      return { lastInsertId: id, rowsAffected: 1 };
    }

    if (normalized.startsWith('delete from book_chunks where book_id = ?')) {
      const [bookId] = params as [number];
      const before = state.bookChunks.length;
      state.bookChunks = state.bookChunks.filter((row) => row.book_id !== bookId);
      return { lastInsertId: 0, rowsAffected: before - state.bookChunks.length };
    }

    // ─── book_index_state ───────────────────────────────────────────────────
    if (normalized.startsWith('insert into book_index_state')) {
      const [bookId, status, chunkCount, embedderModel, contentHash, error] =
        params as [
          number,
          BookIndexStateRow['status'],
          number | null,
          string | null,
          string | null,
          string | null,
        ];
      const ts = nextTimestamp();
      const idx = state.bookIndexState.findIndex((row) => row.book_id === bookId);
      const next: BookIndexStateRow = {
        book_id: bookId,
        status,
        chunk_count: chunkCount,
        embedder_model: embedderModel,
        content_hash: contentHash,
        error,
        updated_at: ts,
      };
      if (idx === -1) {
        state.bookIndexState.push(next);
      } else {
        state.bookIndexState[idx] = next;
      }
      return { lastInsertId: 0, rowsAffected: 1 };
    }

    // ─── preferences ────────────────────────────────────────────────────────
    if (normalized.startsWith('insert into preferences')) {
      const [scope, bookId, text] = params as [
        'global' | 'book',
        number | null,
        string,
      ];
      const id = state.nextIds.preferences++;
      state.preferences.push({
        id,
        scope,
        book_id: bookId,
        text,
        created_at: nextTimestamp(),
      });
      return { lastInsertId: id, rowsAffected: 1 };
    }

    if (normalized.startsWith('delete from preferences where id = ?')) {
      const [id] = params as [number];
      const before = state.preferences.length;
      state.preferences = state.preferences.filter((row) => row.id !== id);
      return { lastInsertId: 0, rowsAffected: before - state.preferences.length };
    }

    // ─── reader_profile ─────────────────────────────────────────────────────
    if (normalized.startsWith('insert into reader_profile')) {
      const [scope, summary, turnCount] = params as [string, string, number];
      const ts = nextTimestamp();
      const idx = state.readerProfile.findIndex((row) => row.scope === scope);
      const next: ReaderProfileRow = {
        scope,
        summary,
        turn_count: turnCount,
        updated_at: ts,
      };
      if (idx === -1) {
        state.readerProfile.push(next);
      } else {
        state.readerProfile[idx] = next;
      }
      return { lastInsertId: 0, rowsAffected: 1 };
    }

    if (normalized.startsWith('delete from reader_profile where scope = ?')) {
      const [scope] = params as [string];
      const before = state.readerProfile.length;
      state.readerProfile = state.readerProfile.filter((row) => row.scope !== scope);
      return { lastInsertId: 0, rowsAffected: before - state.readerProfile.length };
    }

    throw new Error(`Unhandled mock SQL execute: ${sql}`);
  }

  async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const normalized = normalizeSql(sql);

    if (normalized.includes('from gutenberg_panel_state')) {
      if (normalized.includes('count(*)')) {
        return [{ count: 1 }] as T[];
      }
      return [cloneRow(state.gutenbergPanelState)] as T[];
    }

    if (
      normalized.includes('from books') &&
      normalized.includes('order by datetime(created_at) desc, id desc')
    ) {
      return [...state.books].sort(compareCreatedDesc).map(cloneRow) as T[];
    }

    if (
      normalized.includes('from books') &&
      normalized.includes("where metadata_source = 'filename'")
    ) {
      return state.books
        .filter((book) => book.metadata_source === 'filename')
        .sort((a, b) => a.id - b.id)
        .map(cloneRow) as T[];
    }

    if (normalized.includes('from notes') && normalized.includes('where book_id = ?')) {
      const [bookId] = params as [number];
      return state.notes
        .filter((note) => note.book_id === bookId)
        .sort(compareCreatedAsc)
        .map(cloneRow) as T[];
    }

    if (normalized.includes('from vocabulary') && normalized.includes('where book_id = ?')) {
      const [bookId] = params as [number];
      return state.vocabulary
        .filter((row) => row.book_id === bookId)
        .sort(compareCreatedDesc)
        .map(cloneRow) as T[];
    }

    if (
      normalized.includes('from vocabulary') &&
      normalized.includes('order by datetime(created_at) desc, id desc')
    ) {
      return [...state.vocabulary].sort(compareCreatedDesc).map(cloneRow) as T[];
    }

    // ─── threads ────────────────────────────────────────────────────────────
    if (normalized.includes('from threads') && normalized.includes('where book_id = ?')) {
      const [bookId] = params as [number];
      return state.threads
        .filter((row) => row.book_id === bookId)
        .sort((a, b) => {
          const cmp = b.last_active_at.localeCompare(a.last_active_at);
          return cmp !== 0 ? cmp : b.id - a.id;
        })
        .map(cloneRow) as T[];
    }

    if (normalized.includes('from threads') && normalized.includes('where id = ?')) {
      const [id] = params as [number];
      const row = state.threads.find((t) => t.id === id);
      return (row ? [cloneRow(row)] : []) as T[];
    }

    // ─── messages ───────────────────────────────────────────────────────────
    if (
      normalized.startsWith('select count(*) as n from messages') &&
      normalized.includes('thread_id = ?') &&
      normalized.includes("role = 'user'")
    ) {
      const [threadId] = params as [number];
      const n = state.messages.filter(
        (m) => m.thread_id === threadId && m.role === 'user',
      ).length;
      return [{ n }] as T[];
    }

    if (
      normalized.startsWith('select count(*) as n from messages') &&
      normalized.includes("role = 'user'")
    ) {
      const n = state.messages.filter((m) => m.role === 'user').length;
      return [{ n }] as T[];
    }

    if (
      normalized.includes('from messages') &&
      normalized.includes('where thread_id = ?')
    ) {
      const [threadId] = params as [number];
      return state.messages
        .filter((m) => m.thread_id === threadId)
        .sort((a, b) => a.id - b.id)
        .map(cloneRow) as T[];
    }

    if (
      normalized.includes('from messages') &&
      normalized.includes("where role = 'user'") &&
      normalized.includes('order by id desc')
    ) {
      const limit = (params[0] as number) ?? 0;
      return state.messages
        .filter((m) => m.role === 'user')
        .sort((a, b) => b.id - a.id)
        .slice(0, limit)
        .map(cloneRow) as T[];
    }

    // ─── book_chunks ────────────────────────────────────────────────────────
    if (
      normalized.includes('from book_chunks') &&
      normalized.startsWith('select count(*)')
    ) {
      const [bookId] = params as [number];
      const n = state.bookChunks.filter((row) => row.book_id === bookId).length;
      return [{ n }] as T[];
    }

    if (
      normalized.includes('from book_chunks') &&
      normalized.includes('book_id = ?') &&
      normalized.includes('ordinal <= ?')
    ) {
      const [bookId, maxOrdinal] = params as [number, number];
      return state.bookChunks
        .filter((row) => row.book_id === bookId && row.ordinal <= maxOrdinal)
        .sort((a, b) => a.ordinal - b.ordinal)
        .map(cloneRow) as T[];
    }

    if (
      normalized.includes('from book_chunks') &&
      normalized.includes('where book_id = ?')
    ) {
      const [bookId] = params as [number];
      return state.bookChunks
        .filter((row) => row.book_id === bookId)
        .sort((a, b) => a.ordinal - b.ordinal)
        .map(cloneRow) as T[];
    }

    // ─── book_index_state ───────────────────────────────────────────────────
    if (
      normalized.includes('from book_index_state') &&
      normalized.includes('where book_id = ?')
    ) {
      const [bookId] = params as [number];
      const row = state.bookIndexState.find((r) => r.book_id === bookId);
      return (row ? [cloneRow(row)] : []) as T[];
    }

    // ─── preferences ────────────────────────────────────────────────────────
    if (
      normalized.includes('from preferences') &&
      normalized.includes("scope = 'global'") &&
      !normalized.includes("scope = 'book'")
    ) {
      return state.preferences
        .filter((row) => row.scope === 'global')
        .sort((a, b) => a.id - b.id)
        .map(cloneRow) as T[];
    }

    if (normalized.includes('from preferences')) {
      const [bookId] = params as [number];
      return state.preferences
        .filter(
          (row) =>
            row.scope === 'global' || (row.scope === 'book' && row.book_id === bookId),
        )
        .sort((a, b) => {
          if (a.scope !== b.scope) return a.scope < b.scope ? 1 : -1; // 'global' before 'book' (DESC)
          return a.id - b.id;
        })
        .map(cloneRow) as T[];
    }

    // ─── reader_profile ─────────────────────────────────────────────────────
    if (
      normalized.includes('from reader_profile') &&
      normalized.includes('where scope = ?')
    ) {
      const [scope] = params as [string];
      const row = state.readerProfile.find((r) => r.scope === scope);
      return (row ? [cloneRow(row)] : []) as T[];
    }

    throw new Error(`Unhandled mock SQL select: ${sql}`);
  }
}

function getState(): MockState {
  const target = globalThis as typeof globalThis & {
    __SCHOLARA_DB_MOCK__?: MockState;
  };

  if (!target.__SCHOLARA_DB_MOCK__) {
    target.__SCHOLARA_DB_MOCK__ = {
      books: [],
      notes: [],
      vocabulary: [],
      gutenbergPanelState: initialGutenbergPanelState(),
      threads: [],
      messages: [],
      bookChunks: [],
      bookIndexState: [],
      preferences: [],
      readerProfile: [],
      nextIds: {
        books: 1,
        notes: 1,
        vocabulary: 1,
        threads: 1,
        messages: 1,
        bookChunks: 1,
        preferences: 1,
      },
      clock: 0,
    };
  }
  target.__SCHOLARA_DB_MOCK__.gutenbergPanelState ??= initialGutenbergPanelState();

  return target.__SCHOLARA_DB_MOCK__;
}

function initialGutenbergPanelState(): GutenbergPanelStateRow {
  return {
    id: 1,
    cursor_offset: 0,
    last_fetched_at: null,
    payload_json: null,
  };
}

function requireBook(id: number): BookRow {
  const book = state.books.find((candidate) => candidate.id === id);
  if (!book) {
    throw new Error(`Book ${id} was not found in the E2E DB mock.`);
  }
  return book;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function nextTimestamp(): string {
  const value = new Date(Date.UTC(2026, 0, 1, 0, 0, state.clock)).toISOString();
  state.clock += 1;
  return value;
}

function compareCreatedAsc<T extends { created_at: string; id: number }>(a: T, b: T) {
  if (a.created_at === b.created_at) return a.id - b.id;
  return a.created_at.localeCompare(b.created_at);
}

function compareCreatedDesc<T extends { created_at: string; id: number }>(a: T, b: T) {
  if (a.created_at === b.created_at) return b.id - a.id;
  return b.created_at.localeCompare(a.created_at);
}

function cloneRow<T>(row: T): T {
  return JSON.parse(JSON.stringify(row)) as T;
}
