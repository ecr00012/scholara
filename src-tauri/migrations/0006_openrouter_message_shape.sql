-- AI Chat: switch message storage from Anthropic-shape ContentBlock[] to
-- OpenAI-shape payload. Permits a 'tool' role; backfill happens at app
-- startup via Rust (see backfill_messages_v6).

CREATE TABLE messages_v6 (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id        INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content          TEXT,
  content_legacy   TEXT,
  position_at_send TEXT,
  migrated_v6      INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO messages_v6 (
  id, thread_id, role, content, content_legacy, position_at_send, migrated_v6, created_at
)
SELECT
  id, thread_id, role, NULL, content, position_at_send, 0, created_at
FROM messages;

DROP TABLE messages;
ALTER TABLE messages_v6 RENAME TO messages;

CREATE INDEX idx_messages_thread ON messages(thread_id, id);
