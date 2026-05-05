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

interface MockState {
  books: BookRow[];
  notes: NoteRow[];
  vocabulary: VocabRow[];
  nextIds: {
    books: number;
    notes: number;
    vocabulary: number;
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

    if (normalized.startsWith('update books set title = ?, author = ?, metadata_source = \'user\'')) {
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

    if (normalized.startsWith('update books set last_opened = datetime(\'now\') where id = ?')) {
      const [id] = params as [number];
      requireBook(id).last_opened = nextTimestamp();
      return { lastInsertId: 0, rowsAffected: 1 };
    }

    if (normalized.startsWith('update books set epub_locations = ? where id = ?')) {
      const [locations, id] = params as [string, number];
      requireBook(id).epub_locations = locations;
      return { lastInsertId: 0, rowsAffected: 1 };
    }

    if (normalized.startsWith('update books set metadata_source = \'extracted\'')) {
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

    throw new Error(`Unhandled mock SQL execute: ${sql}`);
  }

  async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const normalized = normalizeSql(sql);

    if (
      normalized.includes('from books') &&
      normalized.includes('order by datetime(created_at) desc, id desc')
    ) {
      return [...state.books]
        .sort(compareCreatedDesc)
        .map(cloneRow) as T[];
    }

    if (
      normalized.includes('from books') &&
      normalized.includes('where metadata_source = \'filename\'')
    ) {
      return state.books
        .filter((book) => book.metadata_source === 'filename')
        .sort((a, b) => a.id - b.id)
        .map(cloneRow) as T[];
    }

    if (
      normalized.includes('from notes') &&
      normalized.includes('where book_id = ?')
    ) {
      const [bookId] = params as [number];
      return state.notes
        .filter((note) => note.book_id === bookId)
        .sort(compareCreatedAsc)
        .map(cloneRow) as T[];
    }

    if (
      normalized.includes('from vocabulary') &&
      normalized.includes('where book_id = ?')
    ) {
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
      return [...state.vocabulary]
        .sort(compareCreatedDesc)
        .map(cloneRow) as T[];
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
      nextIds: {
        books: 1,
        notes: 1,
        vocabulary: 1,
      },
      clock: 0,
    };
  }

  return target.__SCHOLARA_DB_MOCK__;
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
