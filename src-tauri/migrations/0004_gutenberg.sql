CREATE TABLE gutenberg_panel_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  cursor_offset   INTEGER NOT NULL DEFAULT 0,
  last_fetched_at INTEGER,
  payload_json    TEXT
);

INSERT OR IGNORE INTO gutenberg_panel_state (id, cursor_offset) VALUES (1, 0);
