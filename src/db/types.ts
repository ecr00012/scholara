export type FileType = 'pdf' | 'epub';
export type DisplayMode = 'agent' | 'reader';
export type MetadataSource = 'filename' | 'user' | 'extracted';
export type ConversationRole = 'user' | 'assistant';

export interface Book {
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

export interface NoteRow {
  id: number;
  book_id: number;
  page_or_position: string;
  note_text: string | null;
  quote_text: string | null;
  created_at: string;
}

export interface VocabRow {
  id: number;
  word: string;
  definition: string;
  book_id: number;
  created_at: string;
}

export interface ConversationRow {
  id: number;
  book_id: number;
  role: ConversationRole;
  content: string;
  created_at: string;
}

/**
 * Minimal SQL surface shared by tauri-plugin-sql (production) and the
 * better-sqlite3 test wrapper. Query functions in db/ accept an instance
 * of this so they're trivially unit-testable.
 */
export interface SqlExecutor {
  execute(
    sql: string,
    params?: unknown[],
  ): Promise<{ lastInsertId: number; rowsAffected: number }>;
  select<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}
