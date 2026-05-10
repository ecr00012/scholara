# OpenRouter Switch — Design Spec

**Date:** 2026-05-09
**Status:** Draft — pending user review
**Supersedes (in part):** [2026-05-08-ai-chat-design.md](2026-05-08-ai-chat-design.md) — provider, transport, and message-shape sections.

## Goal

Replace Scholara's direct Anthropic Messages API integration with OpenRouter as the sole LLM provider, using OpenRouter's OpenAI-compatible `/v1/chat/completions` endpoint. The default model becomes a curated free tool-capable model so a fresh user can use AI Chat without billing setup, while a small curated paid list (Claude, GPT-4o mini, Gemini Flash) remains available for users who want premium quality.

## Non-Goals

- Reasoning UI for DeepSeek R1 / Qwen-thinking models. Reasoning chunks are silently dropped.
- Provider abstraction or multi-provider support. OpenRouter is the only provider.
- Free-text model ID input. The picker is a curated list only.
- Removal of the legacy `anthropic_api_key` keychain entry. It is left in place, untouched and unread.
- Mid-thread model switching.
- Dropping the `messages.content_legacy` column (deferred to a follow-up `0007` migration after one clean release).

## Hard-Constraint Updates

[CLAUDE.md](../../../CLAUDE.md) and [AGENT.md](../../../AGENT.md) have two hard-constraint lines that must be rewritten:

- **LLM:** OpenRouter via the Rust `chat_stream` / `chat_oneshot` Tauri commands, using OpenRouter's OpenAI-compatible `/v1/chat/completions` endpoint. Default model is a curated free tool-capable model (e.g., `deepseek/deepseek-chat-v3-0324:free`); user-selectable from a curated picker in Settings → AI Mentor. Streaming enabled.
- **API key:** User-provided OpenRouter API key stored in the OS keychain via `getSecret('openrouter')` / `setSecret('openrouter')`. The renderer never holds the raw key — all OpenRouter HTTP traffic goes through Rust.

The `Secrets` constraint stays the same in form; only the account name changes (`openrouter_api_key`). The "AI Agent Logic" architecture paragraph swaps "Anthropic Messages API" → "OpenRouter Chat Completions API" and updates the model name and key sourcing.

## Architecture

### Rust transport layer

- File rename: [src-tauri/src/commands/anthropic.rs](../../../src-tauri/src/commands/anthropic.rs) → `src-tauri/src/commands/openrouter.rs`. Module wiring in [src-tauri/src/commands/mod.rs](../../../src-tauri/src/commands/mod.rs) and [src-tauri/src/lib.rs](../../../src-tauri/src/lib.rs) updated. Tauri command names stay `chat_stream` / `chat_oneshot` — the renderer signatures don't change.
- Constants:
  - `SERVICE = "scholara"`
  - `ACCOUNT = "openrouter_api_key"`
  - `URL = "https://openrouter.ai/api/v1/chat/completions"`
  - `REFERER = "https://scholara.app"`
  - `TITLE = "Scholara"`
- Headers on every request: `Authorization: Bearer <key>`, `Content-Type: application/json`, `HTTP-Referer`, `X-Title`. The legacy `x-api-key` and `anthropic-version` headers are removed.
- Request body shape:
  ```json
  {
    "model": "<id>",
    "messages": [...],
    "tools": [...],
    "tool_choice": "auto",
    "stream": true,
    "max_tokens": 2048
  }
  ```
  When the request has no tools, the `tools` and `tool_choice` fields are omitted entirely. The `system` field is no longer top-level — system prompt is prepended to the message array as `{role: "system", content: "..."}` in TS.
- Streaming: `chat_stream` keeps its SSE → `Channel<StreamEvent>` plumbing. `StreamEvent::Event` carries OpenAI delta chunks verbatim — parsing lives in TS. OpenRouter sends periodic `: OPENROUTER PROCESSING` SSE comments and a terminal `data: [DONE]`. Both are filtered server-side: comments are skipped silently, and `[DONE]` terminates the loop without an `Event` emission. `StreamEvent::Done` is sent after the loop completes, exactly as today.
- Redaction: `redact_key_in_message` switches its prefix from `sk-ant-` to `sk-or-v1-` and replacement to `sk-or-v1-•••`. Tests updated.
- Error mapping: shape unchanged. `http_<code>: <body>`, `network_error: ...`, `sse_error: ...` are still surfaced with key fragments redacted. 401 responses surface verbatim; the renderer maps "missing_api_key" / 401 to a friendly toast.
- `chat_oneshot` mirrors the same body / headers / URL change without `stream: true`. Response is OpenRouter's chat-completion JSON; consumed today only by `autoTitle` and `profileUpdater`.

### TS types & streaming parser

File rename: [src/agent/anthropic.ts](../../../src/agent/anthropic.ts) → `src/agent/openrouter.ts`. [src/agent/types.ts](../../../src/agent/types.ts) is rewritten. All imports across [src/agent/](../../../src/agent/) and [src/screens/Reader/agentPanel/chat/](../../../src/screens/Reader/agentPanel/chat/) are updated.

The Anthropic-shape `ContentBlock` union (`TextBlock` / `ToolUseBlock` / `ToolResultBlock`) is **deleted entirely** — there is no Anthropic-shape type anywhere in the codebase after this change.

New types:

```ts
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string }; // JSON-encoded string
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
```

`chatStream(req, onTextDelta)` returns the assembled assistant `ChatMessage`:

- Each SSE `data:` is parsed as `{choices: [{delta, finish_reason}]}`.
- `delta.content` (string) is appended to the assistant text accumulator and forwarded to `onTextDelta`.
- `delta.tool_calls[]` chunks have `index`, optional `id`, optional `function.name`, optional `function.arguments` (incremental string fragments). The parser keeps a `Map<index, {id, name, argsBuffer}>`. `id` and `name` arrive once on the first chunk for that index; `arguments` is concatenated as raw string and **not** `JSON.parse`'d in the parser. The agent loop is responsible for `JSON.parse`ing arguments before tool dispatch — matching OpenAI's spec, where `function.arguments` is canonically a JSON string.
- `delta.reasoning_content` and `delta.reasoning` are silently dropped.
- Returns `{role:'assistant', content: <accumulated text or null>, tool_calls: <accumulated array or undefined>}`. `content` is `null` only when the assistant emitted no text and only tool calls.

`chatOneshot` returns `{message: ChatMessage}` extracted from `response.choices[0].message`.

### Agent loop

[src/agent/loop.ts](../../../src/agent/loop.ts) keeps its control flow; only types and field accesses change:

```
loop:
  resp = chatStream({model, messages, tools, ...}, onTextDelta)
  messages.push(resp)
  if (!resp.tool_calls?.length) break
  for tc of resp.tool_calls:
    args = JSON.parse(tc.function.arguments)
    result = await dispatch(tc.function.name, args)
    messages.push({role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result)})
```

Iteration cap, error handling, and tool-not-found behavior are unchanged.

### Tool registry

[src/agent/tools/registry.ts](../../../src/agent/tools/registry.ts) — each tool exports its schema as an OpenAI-shape `ToolDef` (`{type:'function', function:{name, description, parameters}}`). Handler signature stays `(input: Record<string, unknown>) => Promise<unknown>`. [searchBook.ts](../../../src/agent/tools/searchBook.ts) and [searchNotes.ts](../../../src/agent/tools/searchNotes.ts) only need their schema-export wrappers updated; their bodies are untouched.

### Prompt builder

[src/agent/prompts.ts](../../../src/agent/prompts.ts) continues to produce a single system *string*. The caller prepends `{role:'system', content}` to the message array instead of passing a top-level `system` field — there is no `system` parameter in the OpenAI-shape request.

### Background updaters

[src/agent/autoTitle.ts](../../../src/agent/autoTitle.ts) and [src/agent/profileUpdater.ts](../../../src/agent/profileUpdater.ts) call `chatOneshot`. Their text-extraction helper (`extractText` from the old `anthropic.ts`) is replaced with `(msg: ChatMessage) => msg.content ?? ''`.

### Chat UI

[src/screens/Reader/agentPanel/chat/useAgentSession.ts](../../../src/screens/Reader/agentPanel/chat/useAgentSession.ts):

- User-turn construction: `{role:'user', content: text}` (string `content`, not `ContentBlock[]`).
- Tool-use chip rendering: reads `assistant.tool_calls` instead of filtering `tool_use` content blocks.
- Streaming buffer: appends `delta.content` text to the in-flight assistant message; `tool_calls` populate as chunks accumulate.

[src/screens/Reader/agentPanel/chat/ToolUseChip.tsx](../../../src/screens/Reader/agentPanel/chat/ToolUseChip.tsx) and [MessageBubble.tsx](../../../src/screens/Reader/agentPanel/chat/MessageBubble.tsx) are updated to read the new shape. Visual design and copy are unchanged.

## Data Migration (DB v6)

### File: `src-tauri/migrations/0006_openrouter_message_shape.sql`

The `messages` table currently has `CHECK (role IN ('user', 'assistant'))`. The `'tool'` role must be allowed, so this migration is a table rebuild (SQLite cannot alter a column-level CHECK constraint in place):

```sql
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

INSERT INTO messages_v6 (id, thread_id, role, content, content_legacy, position_at_send, migrated_v6, created_at)
SELECT id, thread_id, role, NULL, content, position_at_send, 0, created_at
FROM messages;

DROP TABLE messages;
ALTER TABLE messages_v6 RENAME TO messages;
CREATE INDEX idx_messages_thread ON messages(thread_id, id);
```

`content` is now nullable until backfill writes the new payload. `content_legacy` retains the original Anthropic-shape JSON as a one-release rollback safety net. A follow-up migration `0007_drop_legacy_message_content.sql` (out of scope for this spec) will drop `content_legacy` and `migrated_v6` after one clean release.

### Rust-side backfill (`backfill_messages_v6`)

Runs in [src-tauri/src/lib.rs](../../../src-tauri/src/lib.rs) on app start, after migrations apply. Idempotent: selects rows `WHERE migrated_v6 = 0`, parses `content_legacy` as `ContentBlock[]`, transforms per the rules below, writes the new payload to `content`, sets `migrated_v6 = 1`. Re-running is a no-op.

The new `content` column stores a JSON-encoded payload of just the message *body* (role stays in its own column, not duplicated inside the JSON):

| `role` | `content` JSON                                              |
| ------ | ----------------------------------------------------------- |
| `user` | `{"text": "..."}`                                           |
| `assistant` | `{"text": "..."\|null, "tool_calls": [...]\|undefined}` |
| `tool` | `{"tool_call_id": "...", "text": "..."}`                    |

### Per-row transform rules

| Source row (Anthropic blocks)                                          | Target row(s)                                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `role='user'`, blocks = `[{type:'text', text}]`                        | One row, `content = {"text": text}`                                                             |
| `role='user'`, blocks = `[{type:'tool_result', tool_use_id, content}]` | One row, **role rewritten to `'tool'`**, `content = {"tool_call_id": tool_use_id, "text": content}` |
| `role='user'`, mixed text + tool_result blocks (rare)                  | **Row split**: each tool_result becomes its own `role='tool'` row; residual text becomes a `role='user'` row. The original row is deleted; new rows are inserted in source order so their autoincrement `id`s preserve ordering under the existing `idx_messages_thread (thread_id, id)` index. New rows copy the source `created_at` and `position_at_send`. |
| `role='assistant'`, text blocks only                                   | One row, `content = {"text": concatenation}`                                                    |
| `role='assistant'`, mixed text + tool_use blocks                       | One row, `content = {"text": concatenated text or null, "tool_calls": [{id, type:'function', function: {name, arguments: JSON.stringify(input)}}]}` |

Row order is preserved by inserting in source order; queries continue to use the existing `idx_messages_thread (thread_id, id)` index, so autoincrement `id`s naturally encode the order. No new column is added.

### `threads.model` rewrite

In the same backfill pass, `threads.model` strings are translated:

| Old value             | New value                       |
| --------------------- | ------------------------------- |
| `claude-haiku-4-5`    | `anthropic/claude-haiku-4.5`    |
| `claude-sonnet-4-6`   | `anthropic/claude-sonnet-4.6`   |
| `claude-opus-4-7`     | `anthropic/claude-opus-4.7`     |
| Anything else / null  | The new free default model id   |

Models with no OpenRouter equivalent fall back to the new free default — existing threads continue to work via the new transport without surfacing an error.

### Other tables

`threads` (other columns), `book_chunks`, `book_index_state`, `preferences`, `reader_profile`, `vocabulary`, `notes` are untouched.

### Rollback

If a critical bug is found post-ship, a manual SQL step can re-derive `content` from `content_legacy`. After one clean release, `0007_drop_legacy_message_content.sql` drops `content_legacy` and `migrated_v6`.

## Settings UI

### API key form

[src/screens/Settings/index.tsx](../../../src/screens/Settings/index.tsx):

The Anthropic block is rewritten to:

```tsx
<ApiKeyForm
  storeKey="openrouterApiKey"
  saveAction="saveOpenRouterApiKey"
  heading="OpenRouter API Key"
  description="Used by the AI study mentor. Stored in your OS keychain; never written to disk by Scholara. The free default model works without billing."
  placeholder="sk-or-v1-..."
  helpHref="https://openrouter.ai/keys"
  helpLabel="Get a key at openrouter.ai/keys →"
/>
```

The store action `saveApiKey` and the `apiKey` slice in [src/store.ts](../../../src/store.ts) are renamed to `saveOpenRouterApiKey` / `openrouterApiKey`. The renderer-side wrapper that today calls `setSecret('anthropic', value)` switches to `setSecret('openrouter', value)`. Any pre-flight check that calls `getSecret('anthropic')` becomes `getSecret('openrouter')`.

The Gutenberg API key block is untouched.

### Model picker

[src/screens/Settings/ModelPicker.tsx](../../../src/screens/Settings/ModelPicker.tsx):

The hard-coded `OPTIONS` array is replaced with a curated list from a new sibling module `src/agent/models.ts`:

```ts
export interface ModelOption {
  id: string;            // OpenRouter model id, e.g. 'deepseek/deepseek-chat-v3-0324:free'
  label: string;
  tier: 'free' | 'paid';
  supportsTools: true;   // every model in the list is tool-capable
}

export const MODELS: ModelOption[] = [
  // exact ids locked at implementation time by fetching openrouter.ai/api/v1/models
  // and verifying each is currently tool-capable.
];

export const DEFAULT_MODEL_ID = MODELS[0].id; // first free entry
```

Curated tiers (illustrative — exact ids verified at implementation time):

- **Free (tool-capable):** DeepSeek V3 (default), DeepSeek R1 (reasoning silently dropped), and any other tool-capable `:free` models confirmed at impl time.
- **Paid (premium):** Claude Haiku 4.5, Claude Sonnet 4.6, GPT-4o mini, Gemini 2.0 Flash.

Picker UX: a single `<select>` writing to `localStorage['scholara_default_model']` (key unchanged). Labels include `(free)` for free-tier entries so the cost implication is obvious. Default value is `DEFAULT_MODEL_ID`. No free-text input.

### Per-thread model field

When a thread is created, `threads.model` is set from `localStorage['scholara_default_model']`. Existing threads have their model migrated as described above. There is no UI for switching models mid-thread (current behavior preserved).

### No other Settings changes

[PreferencesManager.tsx](../../../src/screens/Settings/PreferencesManager.tsx), [ReaderProfileViewer.tsx](../../../src/screens/Settings/ReaderProfileViewer.tsx), [ReembedAllButton.tsx](../../../src/screens/Settings/ReembedAllButton.tsx), [DataLocationPanel.tsx](../../../src/screens/Settings/DataLocationPanel.tsx) are untouched.

## Testing

### Vitest — unit

- [tests/db/messages.test.ts](../../../tests/db/messages.test.ts) — rewritten against the new payload shape. Round-trip for each role.
- New `tests/db/messages.migration.test.ts` — drives `backfill_messages_v6` on an in-memory SQLite seeded with legacy Anthropic-shape rows. Cases:
  - text-only user
  - text-only assistant
  - assistant with mixed text + `tool_use`
  - user wrapping a single `tool_result` (role rewrite to `'tool'`)
  - user wrapping mixed text + multiple `tool_result`s (split-row case, ordering preserved)
  - idempotency (run backfill twice → identical state)
  - `threads.model` mapping including unknown-model fallback
- [tests/agent/loop.test.ts](../../../tests/agent/loop.test.ts) — rewritten. Mocks `chatStream` to return assistant messages with `tool_calls`; asserts dispatch, `JSON.parse` of arguments, and `role:'tool'` reply construction.
- [tests/agent/prompts.test.ts](../../../tests/agent/prompts.test.ts) — system-string output unchanged in shape. Placement (now a `{role:'system'}` message) is asserted by the loop test, not here.
- [tests/agent/tools/searchBook.test.ts](../../../tests/agent/tools/searchBook.test.ts) and [searchNotes.test.ts](../../../tests/agent/tools/searchNotes.test.ts) — handler bodies unchanged; only schema export updated to OpenAI `ToolDef` shape; schema-shape assertion added.
- New `tests/agent/openrouter.streamParser.test.ts` — feeds canned OpenAI SSE chunk sequences to the parser. Cases:
  - text-only delta stream
  - tool_calls fragmented across chunks (split `name`, multi-chunk `arguments`)
  - `reasoning_content` silently dropped
  - multiple parallel tool_calls with interleaved indices
  - `[DONE]` terminator
- [tests/agent/tokenBudget.test.ts](../../../tests/agent/tokenBudget.test.ts), [spoilerGuard.test.ts](../../../tests/agent/spoilerGuard.test.ts), [tests/rag/](../../../tests/rag/) — untouched.

### Cargo — Rust

- `redact_key_in_message` tests in `src-tauri/src/commands/openrouter.rs` updated for `sk-or-v1-` (replace + no-op variants).
- New header-construction unit test asserting the request includes `Authorization: Bearer …`, `HTTP-Referer`, `X-Title`, and that legacy Anthropic headers (`x-api-key`, `anthropic-version`) are absent.
- Body-builder test: with `tools=None`, no `tools` / `tool_choice` field is emitted; with tools, `tool_choice: "auto"` is set; `system` is never top-level.

### Playwright — E2E

- [tests/playwright/ai-chat.spec.ts](../../../tests/playwright/ai-chat.spec.ts) — adapted to OpenAI-shape mock. The mock at [tests/playwright/mocks/tauriCore.ts](../../../tests/playwright/mocks/tauriCore.ts) stops emitting Anthropic `content_block_*` events and instead emits OpenAI `delta.content` / `delta.tool_calls` chunks through the same `Channel<StreamEvent>` plumbing. Existing scenarios (smoke load, indexing gate, send message, streaming render) keep their assertions.
- [tests/playwright/mocks/db.ts](../../../tests/playwright/mocks/db.ts) — updated to seed messages in the new payload shape.
- New scenario: model picker shows `(free)` label on the default and switching default persists across reload.

### Manual verification (called out in the impl plan, not automated)

1. With a real OpenRouter key, send a message using the free default — assert streaming text renders token-by-token.
2. Trigger a `search_book` tool call (e.g., "summarize chapter 3") — assert the `ToolUseChip` renders and a tool result returns to the model.
3. Run with no key configured — assert the friendly missing-key toast.
4. Switch to a paid Claude model in the picker, start a new chat — assert it works.
5. Open a pre-migration chat — assert messages render correctly and a follow-up message can be sent.

## Files Affected (summary)

**Renamed:**
- `src-tauri/src/commands/anthropic.rs` → `openrouter.rs`
- `src/agent/anthropic.ts` → `openrouter.ts`

**Modified:**
- `CLAUDE.md`, `AGENT.md` — hard-constraint lines
- `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` — module wiring + backfill call
- `src/agent/types.ts` — full rewrite to OpenAI shape
- `src/agent/loop.ts`, `prompts.ts`, `autoTitle.ts`, `profileUpdater.ts` — type/field updates
- `src/agent/tools/registry.ts`, `tools/searchBook.ts`, `tools/searchNotes.ts` — schema export shape
- `src/db/messages.ts`, `src/db/types.ts` — read/write new payload
- `src/store.ts` — rename `apiKey` → `openrouterApiKey`, `saveApiKey` → `saveOpenRouterApiKey`
- `src/screens/Settings/index.tsx` — Anthropic key form → OpenRouter key form
- `src/screens/Settings/ModelPicker.tsx` — curated list source
- `src/screens/Reader/agentPanel/chat/useAgentSession.ts`, `MessageBubble.tsx`, `ToolUseChip.tsx` — read new shape
- All affected vitest, cargo, and playwright test files (per Testing section)

**New:**
- `src-tauri/migrations/0006_openrouter_message_shape.sql`
- `src/agent/models.ts` — curated `MODELS` + `DEFAULT_MODEL_ID`
- `tests/db/messages.migration.test.ts`
- `tests/agent/openrouter.streamParser.test.ts`
