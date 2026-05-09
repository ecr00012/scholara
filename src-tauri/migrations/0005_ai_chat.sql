-- AI Chat: threads, messages, RAG chunks, preferences, reader profile.

CREATE TABLE threads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id         INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title           TEXT,
  spoiler_mode    INTEGER NOT NULL DEFAULT 1,
  model           TEXT NOT NULL,
  last_active_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_threads_book ON threads(book_id, last_active_at DESC);

CREATE TABLE messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id        INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content          TEXT NOT NULL,
  position_at_send TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_messages_thread ON messages(thread_id, id);

CREATE TABLE book_chunks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id         INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  ordinal         INTEGER NOT NULL,
  position_marker TEXT NOT NULL,
  text            TEXT NOT NULL,
  embedding       BLOB NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_chunks_book ON book_chunks(book_id, ordinal);

CREATE TABLE book_index_state (
  book_id         INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'indexing', 'ready', 'failed')),
  chunk_count     INTEGER,
  embedder_model  TEXT,
  content_hash    TEXT,
  error           TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE preferences (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope       TEXT NOT NULL CHECK (scope IN ('global', 'book')),
  book_id     INTEGER REFERENCES books(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_preferences_book ON preferences(book_id);

CREATE TABLE reader_profile (
  scope       TEXT PRIMARY KEY,
  summary     TEXT NOT NULL,
  turn_count  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
