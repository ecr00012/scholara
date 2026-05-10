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

export type ThreadSpoilerMode = 0 | 1;

export interface ThreadRow {
  id: number;
  book_id: number;
  title: string | null;
  spoiler_mode: ThreadSpoilerMode;
  model: string;
  last_active_at: string;
  created_at: string;
}

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface MessageRow {
  id: number;
  thread_id: number;
  role: MessageRole;
  /** JSON-encoded message payload. Shape depends on role:
   *  - 'user'      → {"text": string}
   *  - 'assistant' → {"text": string|null, "tool_calls"?: ToolCall[]}
   *  - 'tool'      → {"tool_call_id": string, "text": string}
   */
  content: string;
  position_at_send: string | null;
  created_at: string;
}

export interface BookChunkRow {
  id: number;
  book_id: number;
  ordinal: number;
  position_marker: string;
  text: string;
  /** Float32 little-endian bytes; length = 384 * 4 = 1536. */
  embedding: Uint8Array;
  created_at: string;
}

export type IndexStatus = 'pending' | 'indexing' | 'ready' | 'failed';

export interface BookIndexStateRow {
  book_id: number;
  status: IndexStatus;
  chunk_count: number | null;
  embedder_model: string | null;
  content_hash: string | null;
  error: string | null;
  updated_at: string;
}

export type PreferenceScope = 'global' | 'book';

export interface PreferenceRow {
  id: number;
  scope: PreferenceScope;
  book_id: number | null;
  text: string;
  created_at: string;
}

export interface ReaderProfileRow {
  /** 'global' or 'book:<id>'. */
  scope: string;
  summary: string;
  turn_count: number;
  updated_at: string;
}
