CREATE TABLE books (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT    NOT NULL,
  author            TEXT,
  cover_image_path  TEXT,
  file_path         TEXT    NOT NULL UNIQUE,
  file_type         TEXT    NOT NULL CHECK (file_type IN ('pdf','epub')),
  last_opened       TEXT,
  current_position  TEXT,
  display_mode      TEXT    NOT NULL DEFAULT 'agent' CHECK (display_mode IN ('agent','reader')),
  metadata_source   TEXT    NOT NULL DEFAULT 'filename' CHECK (metadata_source IN ('filename','user','extracted')),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE vocabulary (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  word        TEXT    NOT NULL,
  definition  TEXT    NOT NULL,
  book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vocab_book ON vocabulary(book_id);
CREATE INDEX idx_vocab_recent ON vocabulary(created_at DESC);

CREATE TABLE notes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id           INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  page_or_position  TEXT    NOT NULL,
  note_text         TEXT,
  quote_text        TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (note_text IS NOT NULL OR quote_text IS NOT NULL)
);
CREATE INDEX idx_notes_book ON notes(book_id);

CREATE TABLE conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  role        TEXT    NOT NULL CHECK (role IN ('user','assistant')),
  content     TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_conv_book_time ON conversations(book_id, created_at);
