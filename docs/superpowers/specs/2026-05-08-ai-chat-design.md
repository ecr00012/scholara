# Scholara — AI Chat (Reader Agent) Design

**Date:** 2026-05-08
**Status:** Approved for design; pending implementation plan

---

## 0. Goal & Scope

Replace the `AiChatTab` placeholder in the Reader's Agent Display with a streaming, RAG-backed literature mentor. The agent grounds its answers in the open book and the user's notes/dictionary, respects a per-thread Spoiler Mode, persists multi-thread history per book, and learns from the user via both pinned preferences and an auto-summarized profile. Everything runs locally; the only network calls are to `api.anthropic.com` (user-supplied key) and the one-time embedding model download.

**Out of scope for v1:** web search tool, multi-provider LLM support, encrypted-at-rest SQLite, cloud sync, mobile, dark mode, OCR, full-reader-mode chat surface (this spec covers the Agent Display panel only).

**Resolved CLAUDE.md contradictions** (CLAUDE.md will be updated alongside implementation):
- LLM model: was "`claude-sonnet-4-20250514` only" → now Haiku default with user-selectable Sonnet/Opus.
- LLM framework: was "LangChain (TypeScript)" → now hand-rolled TS agent loop, since the API call lives in Rust.

---

## 1. Architecture & Boundaries

### 1.1 Process boundaries

- **Rust (Tauri commands):** owns the Anthropic API key (keychain via existing `getSecret`/`setSecret`); makes all HTTP calls to `api.anthropic.com`; streams SSE chunks back to the renderer over a Tauri channel. The renderer never sees the key.
- **TypeScript (renderer):** owns the agent loop — message assembly, tool-call routing, spoiler eval, history persistence, UI. No LangChain.
- **SQLite (`tauri-plugin-sql`):** stores threads, messages, embeddings (BLOB), preferences, profile.
- **transformers.js (renderer):** runs `Xenova/all-MiniLM-L6-v2` (~25 MB, downloaded once on first index) for embedding chunks and queries. Brute-force cosine in SQL.

### 1.2 Per-turn flow

1. Renderer assembles a system prompt: persona + book/position + spoiler rules + recent notes/defs/highlights + pinned prefs + profile.
2. Renderer invokes Tauri command `chat_stream({ system, messages, tools, model })`.
3. Rust opens an SSE stream to Anthropic and emits chunk events on a per-call channel.
4. Renderer parses chunks; on a `tool_use` block, executes the tool locally (`search_book`, `search_notes`), appends a `tool_result`, and calls `chat_stream` again with the updated message list.
5. Loop until `stop_reason: end_turn`. Persist each assistant + tool message.

### 1.3 Module layout (new files)

- `src-tauri/src/anthropic.rs` — `chat_stream` command, SSE parsing, channel emission, header redaction.
- `src/agent/loop.ts` — agent loop driver.
- `src/agent/prompts.ts` — system prompt builder.
- `src/agent/tools/searchBook.ts`, `src/agent/tools/searchNotes.ts` — tool implementations.
- `src/agent/spoilerGuard.ts` — query-time retrieval cap (PDF page / EPUB CFI → max ordinal).
- `src/rag/index.ts` — chunk + embed + store pipeline.
- `src/rag/embedder.ts` — transformers.js singleton wrapper.
- `src/db/threads.ts`, `src/db/messages.ts`, `src/db/bookChunks.ts`, `src/db/preferences.ts`, `src/db/readerProfile.ts`.
- `src/screens/Reader/agentPanel/AiChatTab.tsx` — replaces stub; composes subcomponents.
- `src/screens/Reader/agentPanel/chat/MessageList.tsx`, `Composer.tsx`, `SpoilerToggle.tsx`, `HistoryPopover.tsx`, `IndexingProgress.tsx`.

---

## 2. Data Model

New SQLite tables, added in a migration after the existing `conversations` table. The legacy `conversations` table stays for backward compatibility (no reads in new code) but is not extended.

```sql
-- A chat session within a book. One book has many threads.
CREATE TABLE threads (
  id              INTEGER PRIMARY KEY,
  book_id         INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title           TEXT,                          -- LLM-generated after ~3 turns; null until then
  spoiler_mode    INTEGER NOT NULL DEFAULT 1,    -- 1 = on (no-spoiler), 0 = off
  model           TEXT NOT NULL,                 -- e.g. 'claude-haiku-4-5'
  last_active_at  TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_threads_book ON threads(book_id, last_active_at DESC);

-- One row per message turn. Tool calls/results live as JSON content blocks.
CREATE TABLE messages (
  id               INTEGER PRIMARY KEY,
  thread_id        INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role             TEXT NOT NULL,                -- 'user' | 'assistant'
  content          TEXT NOT NULL,                -- JSON: Anthropic content blocks array
  position_at_send TEXT,                         -- snapshot of current_position; populated for user messages, NULL for assistant
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_messages_thread ON messages(thread_id, id);

-- Embedded chunks of book text for RAG.
CREATE TABLE book_chunks (
  id              INTEGER PRIMARY KEY,
  book_id         INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  ordinal         INTEGER NOT NULL,              -- order within book; spoiler cap = WHERE ordinal <= ?
  position_marker TEXT NOT NULL,                 -- PDF page (e.g. "12") or EPUB CFI at chunk start
  text            TEXT NOT NULL,
  embedding       BLOB NOT NULL,                 -- Float32Array, 384 dims = 1536 bytes
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_chunks_book ON book_chunks(book_id, ordinal);

-- Tracks per-book indexing state so we don't re-embed.
CREATE TABLE book_index_state (
  book_id         INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  status          TEXT NOT NULL,                 -- 'pending' | 'indexing' | 'ready' | 'failed'
  chunk_count     INTEGER,
  embedder_model  TEXT,                          -- 'Xenova/all-MiniLM-L6-v2'
  content_hash    TEXT,                          -- detects file replacement
  error           TEXT,
  updated_at      TEXT NOT NULL
);

-- User-pinned preferences. Manually curated.
CREATE TABLE preferences (
  id          INTEGER PRIMARY KEY,
  scope       TEXT NOT NULL,                     -- 'global' | 'book'
  book_id     INTEGER REFERENCES books(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- Auto-summarized rolling profile per scope.
CREATE TABLE reader_profile (
  scope       TEXT NOT NULL,                     -- 'global' | 'book:<id>'
  summary     TEXT NOT NULL,
  turn_count  INTEGER NOT NULL,                  -- last summarized at this thread message count
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (scope)
);
```

**Notes:**
- `messages.content` is JSON (an array of Anthropic content blocks) so tool calls/results round-trip losslessly.
- `book_chunks.ordinal` makes the spoiler cap a single SQL `WHERE ordinal <= ?`.
- `content_hash` lets a re-imported/edited file trigger re-index automatically.
- Embeddings stored inline as BLOB. A 300k-word book is ~3,000 chunks ≈ 5 MB. Brute-force cosine is acceptable until libraries grow into the tens of thousands of chunks; revisit only if measured slow.

---

## 3. Agent Loop, Prompts, and Tools

### 3.1 System prompt structure

Assembled per turn by `prompts.ts`. Each section has a hard token/char cap to keep total context bounded.

```
[PERSONA]
You are Scholara's literature mentor: an avid reader and patient guide.
You discuss books the way a thoughtful friend would over coffee — close
to the text, honest about uncertainty, never lecturing. Quote sparingly
and only from passages you've retrieved or that the user has shared.

[BOOK]
Title: {title}    Author: {author}    Type: {pdf|epub}

[READER POSITION]
Currently on {page X of Y | chapter "Foo", N% through}.

[CURRENT PAGE TEXT]   (current page ± 1, ≤ 3k tokens)
<<<
{surrounding text}
>>>

[SPOILER MODE]   (only included when spoiler_mode = 1)
The reader has not yet read past their current position. You must not
reveal, hint at, or speculate about events, character developments, or
revelations that occur later in the book. If asked about something
ahead, say so plainly and offer to discuss it once they've reached it.
The search_book tool will only return passages up to the current page.

[RECENT NOTES]   (last 10, newest first, ≤ 1k tokens)
- p.{pos}: "{quote}" — {note}
…

[RECENT DEFINITIONS]   (last 10)
- {word}: {definition}

[PINNED PREFERENCES]   (global + this book)
- {text}

[READER PROFILE]   (auto-summarized; book scope + global, ≤ 500 chars each)
{summary}

[TOOLS]
You have search_book and search_notes. Prefer retrieving passages
before asserting specifics about the text.
```

### 3.2 Tools (Anthropic tool-use format; executed in renderer)

**`search_book`**
- Input: `{ query: string, k?: number = 6 }`
- Behavior: embed query with transformers.js → cosine vs `book_chunks.embedding` for the current book → take top-k. If Spoiler Mode is ON, filter `ordinal <= max_ordinal_for(current_position)` *before* taking top-k.
- Output: `[{ position_marker, text, score }]`.

**`search_notes`**
- Input: `{ query: string, k?: number = 6 }`
- Behavior: embed query → cosine vs in-memory cached embeddings of the user's notes/quotes/definitions for this book. Notes are short and few; embed lazily and cache per session — no new table in v1.
- Output: `[{ kind: 'note'|'quote'|'definition', position_marker?, text, score }]`.

### 3.3 Spoiler cap mapping (`spoilerGuard.ts`)

- **PDF:** `current_position` is a page number → `max_ordinal = max(ordinal where the chunk's start page ≤ current_page)`.
- **EPUB:** `current_position` is a CFI → use the existing `epub_locations` cache to convert to a normalized progress value, then map to `max_ordinal` via the stored `position_marker` of each chunk.
- One pure helper, unit-tested with synthetic chunks.

### 3.4 Loop driver (`agent/loop.ts`)

```
async function runTurn(thread, userText) {
  const userMsg = { role: 'user', content: [{ type: 'text', text: userText }] };
  await persistMessage(thread, userMsg);

  let messages = await loadMessages(thread);
  while (true) {
    const stream = invoke chat_stream({ system, messages, tools, model });
    const assistantMsg = await consumeStream(stream, onTextChunk);   // updates UI live
    await persistMessage(thread, assistantMsg);

    const toolUses = assistantMsg.content.filter(b => b.type === 'tool_use');
    if (toolUses.length === 0) return;

    const toolResults = await Promise.all(toolUses.map(executeTool));
    const toolMsg = { role: 'user', content: toolResults };
    await persistMessage(thread, toolMsg);
    messages.push(assistantMsg, toolMsg);
  }
}
```

### 3.5 Auto-titling and profile updates

- **Auto-title:** after the 2nd assistant turn in a thread with `title IS NULL`, fire a non-streaming Haiku call with the first 4 messages and a "title in ≤ 6 words, no quotes" instruction → set `threads.title`. Failure is silent.
- **Profile update:** after every 6 user turns within a single thread, fire a non-streaming Haiku call: *"Given the prior profile and these recent turns, write a ≤ 500-char update describing this reader's interests, reading style, and preferences for this book. Be specific, not flattering."* Replace the `reader_profile` row for `book:<id>`. The same trigger logic runs at `global` scope after every 12 user turns counted across *all* threads in *all* books (tracked in `reader_profile.turn_count` for the `global` row); the global update sees the most recent N user turns from the union, not a single thread.

### 3.6 Token budget guardrails

- Current-page text ≤ 3k tokens, recent notes ≤ 1k tokens, profile ≤ 500 chars per scope.
- If the persisted message history exceeds 20 turns, drop the oldest user/assistant pairs from what's *sent* (the DB keeps the full transcript).

---

## 4. UI Surface

### 4.1 Tab layout (`AiChatTab.tsx`, replaces stub)

```
┌──────────────────────────────────────────────────────────┐
│ {thread title or "New chat"}      [⏱ history] [🛡 spoiler]│ ← header strip
├──────────────────────────────────────────────────────────┤
│                                                          │
│  user: …                                                 │
│  mentor: streaming markdown …                            │
│         ↳ retrieved 3 passages [▸]                        │ ← collapsible tool-use chip
│                                                          │
├──────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────┐  [↑]   │ ← composer
│ │ Ask about this book…                         │        │
│ └──────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────┘
```

### 4.2 Header strip controls (right-aligned)

- **Spoiler toggle (shield icon).** ON: filled shield in `accent-orange`, tooltip *"No spoilers — agent stays at or before page X"*. OFF: outlined shield, tooltip *"Spoilers allowed — full book access"*. Persists per-thread (`threads.spoiler_mode`). New threads default to `spoiler_mode = 1` (inheriting the schema default), independent of the previous thread's choice — explicit safety default.
- **History clock icon.** Opens a shadcn `Popover` listing this book's threads, newest first: `{title or "Chat from May 8"} · {N messages} · {relative time}`. Each row has a `…` menu (Rename, Delete). A pinned `+ New chat` row at the top creates a fresh thread.

### 4.3 Message rendering

- Markdown via `react-markdown` (light styling, no images).
- Tool-use blocks render as a compact chip — e.g. `↳ searched book · 3 passages` — that expands to show retrieved snippets and their position markers. Clicking a position marker navigates the reader to that location (existing reader-jump IPC).
- Streaming: token chunks append to the in-flight assistant bubble. A subtle pulsing caret marks the streaming cursor.

### 4.4 Composer

- Multiline textarea, `Enter` to send, `Shift+Enter` newline.
- Disabled while a turn is in flight; a cancel button replaces send while streaming.
- Pin-preference affordance: a small pin button in the composer's overflow opens an inline "Pin a preference" input → writes to `preferences` (book scope by default, with a "global" toggle).

### 4.5 First-open indexing UX (`IndexingProgress.tsx`)

- If `book_index_state.status != 'ready'` when the tab mounts: show a centered card — *"Preparing study mode for {title}…"* with a determinate progress bar (chunks indexed / total). Composer is hidden until ready.
- On error: friendly message + Retry button.
- Indexing runs in the renderer; cancellation when the tab unmounts is supported.

### 4.6 Settings additions (`screens/Settings`)

- **Model picker.** Haiku (default), Sonnet, Opus options. Persisted as `default_model` in `localStorage`. New threads inherit it.
- **Pinned preferences manager.** List, edit, delete; global + per-book groups.
- **Reader profile viewer.** *"What Scholara has learned about your reading"* — view the global + per-book summaries. Includes a Clear profile button (deletes a row from `reader_profile`).
- **Re-embed all books.** Regenerates indexes if the user wants to refresh.

### 4.7 Offline behavior

- If `navigator.onLine === false` when sending: show the standard non-blocking toast *"Connect to the internet to use AI features."* Composer stays enabled; user can edit and resend.
- Indexing also requires network on first run (model download); show a clear empty state if offline before initial download.

### 4.8 Empty / cold states

- New thread, no messages: a centered prompt — *"Discuss {title} with a reader who's been there before. Ask about a passage, a character, a word."* — plus three suggested-question chips generated lazily on first focus (Haiku, cached for the thread).

---

## 5. Security, Errors, Testing

### 5.1 Security model

Security is proportionate to *"LLM wrapper, user's own key, local-only desktop app"* — strong enough that a compromised JS dependency can't steal the key, not so strong that we encrypt SQLite against the OS user themselves.

- **Key storage.** OS keychain via `getSecret('anthropic_api_key')` / `setSecret`. Service `"scholara"`. Never written to SQLite, logs, or telemetry. Settings UI shows a masked placeholder (`sk-ant-•••…last4`) and a Replace key action.
- **Key in transit.** Renderer never sees the key. `chat_stream` reads from keychain and attaches `x-api-key` in Rust (`reqwest`), streams response back. Auto-title and profile-update calls go through the same command.
- **Key in errors.** Rust strips `x-api-key` from error payloads before emission. Renderer logs never include request headers.
- **Tauri allowlist / CSP.** Restrict renderer-side fetch so it cannot reach `api.anthropic.com` directly — only the Rust command can. CSP `connect-src` allows `'self'`, `tauri:`, and the Hugging Face CDN host(s) needed for the one-time embedding model download (`https://huggingface.co` and `https://cdn-lfs.huggingface.co`); explicitly excludes `api.anthropic.com`.
- **Tool execution.** Tools are pure local SQL + cosine. No tool reads arbitrary files or shells out. `search_book` and `search_notes` accept only `{query, k}`.
- **Prompt injection from book content.** Retrieved passages are wrapped in delimited blocks (`<<<RETRIEVED PASSAGE …>>>`); the system prompt instructs the model to treat retrieved text as data, not instructions. The agent has no destructive tool surface, so the practical risk ceiling is low.
- **Embedding model integrity.** transformers.js downloads ONNX weights from the Hugging Face CDN over HTTPS on first use. Pin a specific revision id and store under app-data so subsequent loads are local.
- **Data export / wipe.** Settings has Export chat data (JSON) and Delete all chats. `ON DELETE CASCADE` ensures deleting a book also drops its threads, messages, chunks, profile.

### 5.2 Error handling

- **Network down:** standard offline toast; turn is *not* persisted as failed; user keeps the composer text.
- **HTTP 401/403 (bad key):** non-blocking inline error in the chat — *"Anthropic rejected your API key. Update it in Settings."* with a deep link.
- **HTTP 429 / 529:** retry once with backoff in Rust; if still failing, surface as inline error + Retry.
- **HTTP 5xx:** inline error + Retry. No automatic retries beyond 429/529.
- **Tool errors:** caught in the loop and returned as a `tool_result` with `is_error: true` so the model can recover.
- **Indexing failure:** sets `book_index_state.status = 'failed'`, stores `error`, shows Retry. Tab degrades gracefully — user can still chat; `search_book` returns "(book not yet indexed)" tool results.
- **Stream interruption (cancel button or tab unmount):** Rust drops the SSE connection; partial assistant message is persisted with an `[interrupted]` marker so the transcript stays coherent.

### 5.3 Testing strategy

**Unit (vitest, node env per existing memory annotation):**
- `prompts.test.ts` — system-prompt assembly across permutations (spoiler on/off, missing notes, oversized profile truncation).
- `spoilerGuard.test.ts` — PDF page mapping, EPUB CFI mapping, edges (position before first chunk, after last chunk).
- `tools/searchBook.test.ts` — top-k selection, spoiler cap correctness, deterministic with seeded synthetic embeddings.
- `agent/loop.test.ts` — drive the loop with a mocked `chat_stream` returning canned tool-use sequences; assert correct message persistence and tool dispatch.
- `db/threads.test.ts`, `db/messages.test.ts` — CRUD and cascade behavior against in-memory better-sqlite3.

**Rust unit (`cargo test`):**
- `anthropic.rs` — header redaction in error paths; SSE chunk parsing.

**Integration (Playwright, already configured):**
- Open a sample EPUB → AI Chat tab → indexing progress completes → ask a question → assert streaming text appears and the history popover shows the new thread.
- Toggle spoiler mode off → ask about a later chapter → assert response is allowed; toggle on → assert refusal language present.
- Open a fresh chat from the history popover → previous thread preserved.

**Manual checklist (recorded in plan, not automated):**
- Bad key, no network, mid-stream cancel, very long book (≥ 800 pages PDF) indexing time + memory.
- Cross-platform: macOS, Windows, Linux indexing model download + keychain access (Linux uses `secret-service`; verify availability or surface a clear error).

---

## 6. Open Questions

None blocking. Follow-up specs (not v1):
- Web search tool with spoiler-aware routing.
- Full-Reader-Display chat surface (the floating logo input on Screen 2's full-screen reader).
- Embedding-store optimization once libraries grow (sqlite-vec, ANN indexes).
