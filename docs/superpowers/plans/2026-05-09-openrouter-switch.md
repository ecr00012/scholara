# OpenRouter Switch Implementation Plan

**Goal:** Replace the direct Anthropic Messages API integration with OpenRouter's OpenAI-compatible `/v1/chat/completions` endpoint as Scholara's sole LLM provider, defaulting to a curated free tool-capable model.

**Architecture:** Full rewrite to OpenAI shape end-to-end — Rust transport, TS types, streaming parser, agent loop, message storage, Settings UI. No provider abstraction. DB migration 0006 rebuilds the `messages` table to permit a `'tool'` role and runs a Rust-side backfill to translate legacy Anthropic-shape rows. Curated model picker in Settings; free-default with a short paid list. Legacy `anthropic_api_key` keychain entry is left untouched.

**Tech Stack:** Tauri 2 + Rust (`reqwest` + `eventsource-stream`) + TypeScript + React + Vitest + Cargo test + Playwright + SQLite via `tauri-plugin-sql`.

**Spec:** [docs/superpowers/specs/2026-05-09-openrouter-switch-design.md](../specs/2026-05-09-openrouter-switch-design.md)

**Branch:** continue on `chat`. Each task ends with a commit so the branch stays bisectable.

---

## Conventions

- Commit at the end of each task with a Conventional-Commits message; co-author trailer is added by the harness.
- Run `npm test` (vitest), `cargo test --manifest-path src-tauri/Cargo.toml`, and (where relevant) `npx playwright test` after the task's stated checkpoint.
- No `--no-verify`. If a hook fails, fix the underlying issue and create a new commit.
- Filenames use absolute paths from the repo root: `/Users/creekrichmond/Documents/projects/scholara/...`.

---

## File Structure

**Renamed:**
- `src-tauri/src/commands/anthropic.rs` → `src-tauri/src/commands/openrouter.rs`
- `src/agent/anthropic.ts` → `src/agent/openrouter.ts`

**New:**
- `src-tauri/migrations/0006_openrouter_message_shape.sql` — table rebuild
- `src-tauri/src/migrate_v6.rs` — Rust-side backfill (`backfill_messages_v6`)
- `src/agent/models.ts` — curated `MODELS`, `DEFAULT_MODEL_ID`
- `tests/db/messages.migration.test.ts` — backfill tests *(deferred — backfill is in Rust; covered by a new cargo test in Task 11 instead. This `.ts` file is NOT created.)*
- `tests/agent/openrouter.streamParser.test.ts` — SSE chunk parser tests

**Modified:**
- `CLAUDE.md`, `AGENT.md`
- `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`
- `src/agent/types.ts`, `loop.ts`, `prompts.ts` *(call site only)*, `autoTitle.ts`, `profileUpdater.ts`
- `src/agent/tools/registry.ts`, `tools/searchBook.ts` *(import only)*, `tools/searchNotes.ts` *(import only)*
- `src/db/messages.ts`, `src/db/types.ts`
- `src/store.ts`
- `src/screens/Settings/index.tsx`, `Settings/ModelPicker.tsx`, `Settings/ApiKeyForm.tsx`
- `src/screens/Reader/agentPanel/chat/useAgentSession.ts`, `MessageBubble.tsx`, `ToolUseChip.tsx`
- `tests/agent/loop.test.ts`, `tests/db/messages.test.ts`, `tests/agent/prompts.test.ts` *(import only)*, `tests/agent/tools/searchBook.test.ts`, `tests/agent/tools/searchNotes.test.ts`
- `tests/playwright/ai-chat.spec.ts`, `tests/playwright/mocks/tauriCore.ts`, `tests/playwright/mocks/db.ts`

---

# Tasks

## Task 1 — Update hard-constraint docs

**Files:** `/Users/creekrichmond/Documents/projects/scholara/CLAUDE.md`, `/Users/creekrichmond/Documents/projects/scholara/AGENT.md`

**Why:** The two hard-constraint lines (`LLM` and `API key`) are out of date the moment this branch lands. Update them first so subsequent tasks have accurate guard rails. Also update the "AI Agent Logic" architecture paragraph that mentions the Anthropic Messages API.

**Edits — apply identically to both files** (the relevant lines are identical):

Replace the `LLM:` line:

```
- **LLM:** Direct Anthropic Messages API via the Rust `chat_stream` / `chat_oneshot` Tauri commands. Default model `claude-haiku-4-5`; user-pickable in Settings → AI Mentor. Streaming enabled.
```

with:

```
- **LLM:** OpenRouter via the Rust `chat_stream` / `chat_oneshot` Tauri commands, hitting OpenRouter's OpenAI-compatible `/v1/chat/completions` endpoint. Default model is a curated free tool-capable model (see `src/agent/models.ts`); user-selectable in Settings → AI Mentor. Streaming enabled.
```

Replace the `API key:` line:

```
- **API key:** User-provided Anthropic API key stored in the OS keychain via `getSecret('anthropic')` / `setSecret('anthropic')`. The renderer never holds the raw key — all Anthropic HTTP traffic goes through Rust.
```

with:

```
- **API key:** User-provided OpenRouter API key stored in the OS keychain via `getSecret('openrouter')` / `setSecret('openrouter')`. The renderer never holds the raw key — all OpenRouter HTTP traffic goes through Rust. The legacy `anthropic_api_key` keychain entry, if present, is left untouched and unread.
```

In CLAUDE.md, the `### AI Agent Logic` section opening sentence:

```
The Reader Agent (AI Chat tab) is a streaming, per-book study mentor. It runs the Anthropic Messages API directly via the Rust `chat_stream` / `chat_oneshot` Tauri commands (default model `claude-haiku-4-5`, user-selectable). Implementation details:
```

becomes:

```
The Reader Agent (AI Chat tab) is a streaming, per-book study mentor. It runs OpenRouter's OpenAI-compatible Chat Completions API via the Rust `chat_stream` / `chat_oneshot` Tauri commands (default model is the first entry of `src/agent/models.ts`, user-selectable). Implementation details:
```

The same update applies to AGENT.md's identical section.

In CLAUDE.md, the `### Settings Screen` paragraph:

```
Accessible from Library. Allows user to enter/save their Anthropic API key and view the app's internal documents directory path.
```

becomes:

```
Accessible from Library. Allows user to enter/save their OpenRouter API key and view the app's internal documents directory path.
```

Same change in AGENT.md.

**Verify:**

```
grep -n 'Anthropic\|anthropic' CLAUDE.md AGENT.md
```

Expected output: no matches (or only matches inside backtick-quoted code that legitimately references the legacy keychain entry name in the API-key bullet).

**Commit:**

```
docs(ai-chat): rewrite LLM/API-key hard constraints for OpenRouter
```

---

## Task 2 — Add curated model list module

**File:** `/Users/creekrichmond/Documents/projects/scholara/src/agent/models.ts` (new)

**Why:** Centralize the curated model list so the picker, defaults, and any future per-model logic share one source of truth. The exact model IDs require verification against `https://openrouter.ai/api/v1/models` at implementation time — see the **ID lock-in checkpoint** at the bottom of this task.

**ID lock-in checkpoint** — before committing this task, run:

```
curl -s https://openrouter.ai/api/v1/models | jq '.data[] | select(.id | test(":free$")) | select(.supported_parameters // [] | index("tools")) | {id, name, context_length}'
```

Verify the IDs and tool-call support flags listed in the file below are still valid. If any free tool-capable model in the list returns nothing, replace it with the closest current equivalent (note the substitution in the commit message). Also verify the paid IDs return non-empty:

```
curl -s https://openrouter.ai/api/v1/models | jq '.data[] | select(.id == "anthropic/claude-haiku-4.5") | .id'
```

(repeat for each paid id — `anthropic/claude-sonnet-4.6`, `anthropic/claude-opus-4.7`, `openai/gpt-4o-mini`, `google/gemini-2.0-flash-001`).

**File contents:**

```ts
// src/agent/models.ts
//
// Curated OpenRouter model list. Every entry is verified to support function
// calling at the time of authoring — see the ID lock-in checkpoint in the
// implementation plan task that introduced this file.

export interface ModelOption {
  /** OpenRouter model ID, e.g. 'deepseek/deepseek-chat-v3-0324:free'. */
  id: string;
  /** Human-readable label rendered in the picker. */
  label: string;
  tier: 'free' | 'paid';
  /** Always true — non-tool-capable models are excluded by curation. */
  supportsTools: true;
}

export const MODELS: ModelOption[] = [
  // Free, tool-capable. The first entry is the default.
  {
    id: 'deepseek/deepseek-chat-v3-0324:free',
    label: 'DeepSeek V3 (free) — default',
    tier: 'free',
    supportsTools: true,
  },
  {
    id: 'deepseek/deepseek-r1:free',
    label: 'DeepSeek R1 (free, reasoning trace hidden)',
    tier: 'free',
    supportsTools: true,
  },

  // Paid premium models, ordered cheapest → priciest within each provider.
  {
    id: 'anthropic/claude-haiku-4.5',
    label: 'Claude Haiku 4.5',
    tier: 'paid',
    supportsTools: true,
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6',
    tier: 'paid',
    supportsTools: true,
  },
  {
    id: 'openai/gpt-4o-mini',
    label: 'GPT-4o mini',
    tier: 'paid',
    supportsTools: true,
  },
  {
    id: 'google/gemini-2.0-flash-001',
    label: 'Gemini 2.0 Flash',
    tier: 'paid',
    supportsTools: true,
  },
];

export const DEFAULT_MODEL_ID = MODELS[0].id;

export function isKnownModel(id: string): boolean {
  return MODELS.some((m) => m.id === id);
}
```

**Verify:**

```
npx tsc --noEmit -p tsconfig.json 2>&1 | head -20
```

Expected: no errors *new* to this file. (There may be unrelated errors from the in-progress migration in later tasks if you stage them; this task should compile cleanly on its own.)

**Commit:**

```
feat(ai-chat): add curated OpenRouter model list and default

If the ID lock-in checkpoint required substitutions, append:
- replaced X with Y because the original ID returned no entries from openrouter.ai/api/v1/models on <date>
```

---

## Task 3 — Add migration 0006 SQL file (schema rebuild only)

**File:** `/Users/creekrichmond/Documents/projects/scholara/src-tauri/migrations/0006_openrouter_message_shape.sql` (new)

**Why:** SQLite cannot alter a column-level CHECK constraint in place. The current `messages.role CHECK (role IN ('user', 'assistant'))` has to be rebuilt to allow `'tool'`. The rebuild is also where we add `content_legacy` (one-release rollback safety net) and `migrated_v6` (idempotency flag for the Rust-side backfill in Task 11).

**File contents:**

```sql
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
```

Note: the `INSERT … SELECT` preserves all existing rows, copying their original `content` (Anthropic-shape JSON) into `content_legacy` and leaving the new `content` column NULL. The Rust backfill in Task 11 fills `content` and flips `migrated_v6 = 1`.

**Wire into the migrations vec.** Edit `/Users/creekrichmond/Documents/projects/scholara/src-tauri/src/lib.rs`:

Find the `migrations` vec, after the version-5 entry, append:

```rust
        Migration {
            version: 6,
            description: "openrouter: rebuild messages table for tool role + new payload shape",
            sql: include_str!("../migrations/0006_openrouter_message_shape.sql"),
            kind: MigrationKind::Up,
        },
```

**Verify:**

```
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20
```

Expected: build succeeds. (Backfill is added in Task 11; for now the schema-only migration runs but `content` stays NULL until then.)

**Commit:**

```
feat(ai-chat): migration 0006 — rebuild messages table for tool role
```

---

## Task 4 — Rewrite TS agent types to OpenAI shape

**File:** `/Users/creekrichmond/Documents/projects/scholara/src/agent/types.ts`

**Why:** The whole rewrite descends from these types. After this file changes, ~10 other files temporarily fail to compile; Tasks 5–10 fix them in dependency order. We tolerate a temporarily red tree across these tasks because the alternative (parallel adapter layer) was rejected during design.

**Replace the entire file contents with:**

```ts
// src/agent/types.ts
//
// OpenAI-shape chat-completion types used end-to-end in Scholara's AI Chat.
// Wire format = OpenRouter's /v1/chat/completions; the same shape is what we
// store in the DB (per-row payload only — `role` lives in its own column).

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** JSON-encoded arguments string, per OpenAI spec. Parser does NOT JSON.parse this. */
    arguments: string;
  };
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    /** JSON-Schema parameters object. */
    parameters: Record<string, unknown>;
  };
}

/** Stream event protocol between Rust `chat_stream` and the TS parser. */
export type StreamEvent =
  | { kind: 'event'; event: string; data: unknown }
  | { kind: 'error'; message: string }
  | { kind: 'done' };
```

The deleted exports (`TextBlock`, `ToolUseBlock`, `ToolResultBlock`, `ContentBlock`, `AnthropicMessage`, `AnthropicToolDef`) are removed entirely — no re-exports, no aliases. Compiler errors in dependent files are fixed in subsequent tasks.

**Verify:**

```
grep -rn "ContentBlock\|AnthropicMessage\|AnthropicToolDef\|ToolUseBlock\|ToolResultBlock\|TextBlock" src/ tests/ | grep -v node_modules
```

Note: this will show the broken references in *other files* — that's expected; they're fixed in Tasks 5–14. The point is no remaining definition lives in `src/agent/types.ts`.

**Commit:** **deferred** — this task is part of the larger TS rewrite. Stage the change but do **not** commit until Task 10 completes (commit message and steps below). Reason: the working tree won't compile in between, and committing red-tree intermediates makes bisecting harder.

---

## Task 5 — Rewrite Anthropic transport file as OpenRouter / OpenAI-shape transport

**File rename:** `/Users/creekrichmond/Documents/projects/scholara/src/agent/anthropic.ts` → `/Users/creekrichmond/Documents/projects/scholara/src/agent/openrouter.ts`

Use `git mv`:

```
git mv src/agent/anthropic.ts src/agent/openrouter.ts
```

Then **replace the entire file contents** with:

```ts
// src/agent/openrouter.ts
//
// Wraps the Rust `chat_stream` / `chat_oneshot` Tauri commands, parsing
// OpenAI-shape SSE deltas streamed by OpenRouter's /v1/chat/completions.

import { Channel, invoke } from '@tauri-apps/api/core';
import type { ChatMessage, StreamEvent, ToolCall, ToolDef } from './types';

export interface ChatStreamRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  max_tokens?: number;
}

export type OnTextDelta = (delta: string) => void;

interface PendingToolCall {
  id: string;
  name: string;
  argsBuffer: string;
}

/**
 * Streams a chat completion. Returns the assembled assistant message.
 * Throws on transport error (network, http_4xx, etc.).
 */
export async function chatStream(
  req: ChatStreamRequest,
  onTextDelta: OnTextDelta,
): Promise<ChatMessage> {
  let textBuffer = '';
  const toolCalls = new Map<number, PendingToolCall>();

  let resolveDone: () => void;
  let rejectDone: (e: unknown) => void;
  const done = new Promise<void>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });

  const channel = new Channel<StreamEvent>();
  channel.onmessage = (msg) => {
    if (msg.kind === 'done') return resolveDone();
    if (msg.kind === 'error') return rejectDone(new Error(msg.message));
    handleEvent(msg.data, textBufferAppender, toolCalls);
  };

  function textBufferAppender(delta: string): void {
    textBuffer += delta;
    onTextDelta(delta);
  }

  const invokePromise = invoke<void>('chat_stream', { req, onEvent: channel });
  await Promise.race([done, invokePromise.then(() => {})]);
  // Surface any error from the invoke itself (e.g., missing key, http_4xx).
  await invokePromise;

  const assembled = assembleAssistant(textBuffer, toolCalls);
  return assembled;
}

function handleEvent(
  data: unknown,
  appendText: (s: string) => void,
  toolCalls: Map<number, PendingToolCall>,
): void {
  // OpenRouter's SSE chunks follow the OpenAI Chat Completions stream format:
  //   { choices: [{ index, delta: { content?, tool_calls?, reasoning?, reasoning_content? }, finish_reason }] }
  // We ignore reasoning fields per design (silently dropped).
  const d = data as {
    choices?: Array<{
      delta?: {
        content?: string;
        tool_calls?: Array<{
          index: number;
          id?: string;
          type?: 'function';
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  };
  const delta = d?.choices?.[0]?.delta;
  if (!delta) return;

  if (typeof delta.content === 'string' && delta.content.length > 0) {
    appendText(delta.content);
  }

  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index;
      if (typeof idx !== 'number') continue;
      let entry = toolCalls.get(idx);
      if (!entry) {
        entry = { id: '', name: '', argsBuffer: '' };
        toolCalls.set(idx, entry);
      }
      if (typeof tc.id === 'string' && tc.id.length > 0) entry.id = tc.id;
      const fn = tc.function;
      if (fn) {
        if (typeof fn.name === 'string' && fn.name.length > 0) entry.name = fn.name;
        if (typeof fn.arguments === 'string') entry.argsBuffer += fn.arguments;
      }
    }
  }
  // delta.reasoning, delta.reasoning_content, finish_reason: intentionally ignored.
}

function assembleAssistant(
  text: string,
  toolCalls: Map<number, PendingToolCall>,
): ChatMessage {
  const sortedCalls: ToolCall[] = [...toolCalls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: c.argsBuffer },
    }));

  const hasText = text.length > 0;
  if (sortedCalls.length === 0) {
    return { role: 'assistant', content: hasText ? text : '' };
  }
  return {
    role: 'assistant',
    content: hasText ? text : null,
    tool_calls: sortedCalls,
  };
}

export interface ChatOneshotRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
}

export interface ChatOneshotResponse {
  message: ChatMessage;
}

/** Non-streaming variant. Returns the assistant message extracted from
 *  response.choices[0].message. */
export async function chatOneshot(req: ChatOneshotRequest): Promise<ChatOneshotResponse> {
  const raw = await invoke<{
    choices?: Array<{ message?: { role?: string; content?: string | null; tool_calls?: ToolCall[] } }>;
  }>('chat_oneshot', { req });
  const m = raw?.choices?.[0]?.message;
  const role = m?.role ?? 'assistant';
  if (role !== 'assistant') {
    return { message: { role: 'assistant', content: '' } };
  }
  const content = typeof m?.content === 'string' ? m.content : (m?.content === null ? null : '');
  const tool_calls = Array.isArray(m?.tool_calls) ? m!.tool_calls : undefined;
  return {
    message: tool_calls && tool_calls.length > 0
      ? { role: 'assistant', content, tool_calls }
      : { role: 'assistant', content: content ?? '' },
  };
}

/** Convenience: extract the assistant text from a ChatMessage. */
export function messageText(m: ChatMessage): string {
  if (m.role === 'assistant') return m.content ?? '';
  if (m.role === 'system' || m.role === 'user' || m.role === 'tool') return m.content;
  return '';
}
```

**Commit:** deferred to Task 10 alongside the rest of the TS rewrite.

---

## Task 6 — Stream parser tests (TDD red→green)

**File:** `/Users/creekrichmond/Documents/projects/scholara/tests/agent/openrouter.streamParser.test.ts` (new)

**Why:** The new parser's correctness is the load-bearing piece of the whole rewrite. We exercise it in isolation with canned SSE-shaped events fed through `Channel`.

**File contents:**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

class FakeChannel<T> {
  onmessage: ((msg: T) => void) | null = null;
  emit(msg: T): void { this.onmessage?.(msg); }
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  Channel: FakeChannel,
}));

import { chatStream } from '../../src/agent/openrouter';
import type { StreamEvent } from '../../src/agent/types';

beforeEach(() => {
  invokeMock.mockReset();
});

interface DriveOpts {
  events: Array<Omit<StreamEvent & { kind: 'event' }, 'kind'>>;
  finalKind?: 'done' | { error: string };
}

function driveInvoke(opts: DriveOpts) {
  invokeMock.mockImplementation(async (_cmd: string, args: { onEvent: FakeChannel<StreamEvent> }) => {
    for (const ev of opts.events) {
      args.onEvent.emit({ kind: 'event', event: ev.event, data: ev.data });
    }
    if (opts.finalKind === 'done' || opts.finalKind === undefined) {
      args.onEvent.emit({ kind: 'done' });
    } else {
      args.onEvent.emit({ kind: 'error', message: opts.finalKind.error });
      throw new Error(opts.finalKind.error);
    }
  });
}

describe('chatStream OpenAI-shape parser', () => {
  it('assembles text-only deltas', async () => {
    const deltas: string[] = [];
    driveInvoke({
      events: [
        { event: 'message', data: { choices: [{ delta: { content: 'Hello ' } }] } },
        { event: 'message', data: { choices: [{ delta: { content: 'world.' } }] } },
      ],
    });
    const msg = await chatStream(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      (d) => deltas.push(d),
    );
    expect(deltas).toEqual(['Hello ', 'world.']);
    expect(msg).toEqual({ role: 'assistant', content: 'Hello world.' });
  });

  it('accumulates fragmented tool_calls into a single ToolCall', async () => {
    driveInvoke({
      events: [
        // First chunk: id + name, partial args
        { event: 'message', data: { choices: [{ delta: { tool_calls: [{
          index: 0, id: 'call_1', type: 'function',
          function: { name: 'search_book', arguments: '{"que' },
        }] } }] } },
        // Second chunk: more args (no id, no name)
        { event: 'message', data: { choices: [{ delta: { tool_calls: [{
          index: 0, function: { arguments: 'ry":"hello"}' },
        }] } }] } },
      ],
    });
    const msg = await chatStream(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      () => {},
    );
    expect(msg).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_1', type: 'function',
        function: { name: 'search_book', arguments: '{"query":"hello"}' },
      }],
    });
  });

  it('silently drops reasoning_content and reasoning fields', async () => {
    driveInvoke({
      events: [
        { event: 'message', data: { choices: [{ delta: { reasoning_content: 'thinking…' } }] } },
        { event: 'message', data: { choices: [{ delta: { reasoning: 'still thinking' } }] } },
        { event: 'message', data: { choices: [{ delta: { content: 'answer' } }] } },
      ],
    });
    const msg = await chatStream(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      () => {},
    );
    expect(msg).toEqual({ role: 'assistant', content: 'answer' });
  });

  it('handles two parallel tool_calls with interleaved indices', async () => {
    driveInvoke({
      events: [
        { event: 'message', data: { choices: [{ delta: { tool_calls: [
          { index: 0, id: 'call_a', type: 'function', function: { name: 'search_book', arguments: '{}' } },
          { index: 1, id: 'call_b', type: 'function', function: { name: 'search_notes', arguments: '{}' } },
        ] } }] } },
      ],
    });
    const msg = await chatStream(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      () => {},
    );
    expect(msg.role).toBe('assistant');
    if (msg.role !== 'assistant') throw new Error('unreachable');
    expect(msg.tool_calls?.map((tc) => tc.id)).toEqual(['call_a', 'call_b']);
  });

  it('propagates an error event as a thrown error', async () => {
    driveInvoke({
      events: [
        { event: 'message', data: { choices: [{ delta: { content: 'partial' } }] } },
      ],
      finalKind: { error: 'http_429: rate limited' },
    });
    await expect(
      chatStream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, () => {}),
    ).rejects.toThrow(/http_429/);
  });
});
```

**Verify (red → green sequence):**

1. With Task 4 staged but Task 5 not: `npx vitest run tests/agent/openrouter.streamParser.test.ts` → fails (cannot import `src/agent/openrouter`). That's the red phase.
2. After Task 5: same command → all 5 tests pass. Green.

**Commit:** deferred to Task 10.

---

## Task 7 — Rewrite agent loop, tool registry, prompts call site

**Files:**
- `/Users/creekrichmond/Documents/projects/scholara/src/agent/loop.ts`
- `/Users/creekrichmond/Documents/projects/scholara/src/agent/tools/registry.ts`
- `/Users/creekrichmond/Documents/projects/scholara/src/agent/tools/searchBook.ts` (import only)
- `/Users/creekrichmond/Documents/projects/scholara/src/agent/tools/searchNotes.ts` (import only — no body change needed; verify imports compile)

**Why:** `loop.ts` is the agent's control flow; it must speak the new types. `registry.ts` exports tool schemas in the new OpenAI `ToolDef` shape. `prompts.ts`'s body needs no change (it still produces a system *string*); the call site is updated in Task 9 (`useAgentSession.ts`) where the system prompt is now prepended as a `{role:'system'}` message.

### 7a — `src/agent/tools/registry.ts`

**Replace the entire file with:**

```ts
import type { ToolDef } from '../types';
import { searchBook, type SearchBookParams } from './searchBook';
import { searchNotes } from './searchNotes';
import type { Position } from '../../lib/positionShape';
import type { ChunkOrdinalIndex } from '../spoilerGuard';

export const TOOL_DEFS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'search_book',
      description:
        'Retrieve the most relevant passages from the book. Use this before quoting or asserting specific facts about the text.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A natural-language search query.' },
          k: { type: 'integer', description: 'Number of passages, default 6.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_notes',
      description:
        "Retrieve the user's relevant notes, saved quotes, and dictionary definitions for this book.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A natural-language search query.' },
          k: { type: 'integer', description: 'Number of items, default 6.' },
        },
        required: ['query'],
      },
    },
  },
];

export interface ToolContext {
  bookId: number;
  spoilerCap: { enabled: boolean; position: Position | null; index: ChunkOrdinalIndex };
}

export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ content: string; is_error: boolean }> {
  try {
    if (name === 'search_book') {
      const results = await searchBook({
        bookId: ctx.bookId,
        query: String(input.query ?? ''),
        k: typeof input.k === 'number' ? input.k : undefined,
        spoilerCap: ctx.spoilerCap,
      } satisfies SearchBookParams);
      return { content: JSON.stringify(results), is_error: false };
    }
    if (name === 'search_notes') {
      const results = await searchNotes({
        bookId: ctx.bookId,
        query: String(input.query ?? ''),
        k: typeof input.k === 'number' ? input.k : undefined,
      });
      return { content: JSON.stringify(results), is_error: false };
    }
    return { content: `unknown tool: ${name}`, is_error: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `tool_error: ${message}`, is_error: true };
  }
}
```

The `dispatchTool` body is unchanged from the prior version; only the `TOOL_DEFS` shape and the import line at the top changed.

### 7b — `src/agent/loop.ts`

**Replace the entire file with:**

```ts
// src/agent/loop.ts
import { chatStream } from './openrouter';
import type { ChatMessage } from './types';
import { TOOL_DEFS, dispatchTool, type ToolContext } from './tools/registry';

export interface RunTurnArgs {
  model: string;
  /** System prompt body. The loop prepends a {role:'system'} message itself. */
  system: string;
  /** All prior messages in OpenAI shape. The new user turn is added below. */
  messages: ChatMessage[];
  userText: string;
  toolContext: ToolContext;
  onTextDelta: (text: string) => void;
  onAssistantMessage: (msg: ChatMessage) => void;
  /** Called whenever a batch of tool messages is produced (one per tool_call). */
  onToolResults: (msgs: ChatMessage[]) => void;
  signal?: AbortSignal;
  maxIterations?: number;
}

export async function runTurn(args: RunTurnArgs): Promise<void> {
  const userMsg: ChatMessage = { role: 'user', content: args.userText };
  const sysMsg: ChatMessage = { role: 'system', content: args.system };
  const messages: ChatMessage[] = [sysMsg, ...args.messages, userMsg];

  const limit = args.maxIterations ?? 8;
  for (let i = 0; i < limit; i++) {
    if (args.signal?.aborted) throw new Error('aborted');

    const assistant = await chatStream(
      { model: args.model, messages, tools: TOOL_DEFS },
      args.onTextDelta,
    );
    args.onAssistantMessage(assistant);
    messages.push(assistant);

    const calls = assistant.role === 'assistant' ? assistant.tool_calls ?? [] : [];
    if (calls.length === 0) return;

    const toolMessages: ChatMessage[] = await Promise.all(
      calls.map(async (tc): Promise<ChatMessage> => {
        let parsedInput: Record<string, unknown> = {};
        try {
          parsedInput = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          parsedInput = {};
        }
        const out = await dispatchTool(tc.function.name, parsedInput, args.toolContext);
        return {
          role: 'tool',
          tool_call_id: tc.id,
          content: out.is_error ? `tool_error: ${out.content}` : out.content,
        };
      }),
    );
    args.onToolResults(toolMessages);
    for (const tm of toolMessages) messages.push(tm);
  }
  // If we hit the iteration cap, stop quietly — the last assistant message has already been delivered.
}
```

**Note on signature change:** `onToolResults` now receives `ChatMessage[]` instead of a single `AnthropicMessage`. The previous API bundled all tool results as a single `{role:'user', content: ToolResultBlock[]}`; OpenAI shape requires one `{role:'tool', ...}` message per call, so the array surfaces the change to the caller. Task 9 updates the consumer.

### 7c — Verify `searchBook.ts` and `searchNotes.ts` still compile

These files do not depend on any of the deleted types — `searchBook.ts` imports from `'./searchBook'` (its own params interface), `'../../db/client'`, `'../../db/bookChunks'`, `'../../rag/embedder'`, `'../../rag/cosine'`, `'../spoilerGuard'`, `'../../lib/positionShape'`. None of those reference the old types. Re-read the imports in `/Users/creekrichmond/Documents/projects/scholara/src/agent/tools/searchBook.ts` and `/Users/creekrichmond/Documents/projects/scholara/src/agent/tools/searchNotes.ts` to confirm; if any line imports `ContentBlock`, `AnthropicMessage`, `AnthropicToolDef`, `ToolUseBlock`, `ToolResultBlock`, or `TextBlock`, remove that import. (Confirmed at plan time: neither file does.)

**Verify:**

```
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'agent/(loop|tools/)' | head -10
```

Expected: no diagnostics on `loop.ts`, `tools/registry.ts`, `tools/searchBook.ts`, `tools/searchNotes.ts`. (Other files may still be red — fixed in Tasks 8–10.)

**Commit:** deferred to Task 10.

---

## Task 8 — Rewrite autoTitle and profileUpdater for the new shape

**Files:**
- `/Users/creekrichmond/Documents/projects/scholara/src/agent/autoTitle.ts`
- `/Users/creekrichmond/Documents/projects/scholara/src/agent/profileUpdater.ts`

**Why:** Both modules call `chatOneshot` and consumed Anthropic content blocks via `extractText`. The new `chatOneshot` returns `{message: ChatMessage}` whose body is plain string content. `profileUpdater.safeText` parsed the legacy stored JSON (Anthropic blocks) — it must now read the new payload shape `{text: ...}`.

### 8a — Replace `src/agent/autoTitle.ts` with:

```ts
import { chatOneshot, messageText } from './openrouter';
import type { ChatMessage } from './types';
import { updateThreadTitle } from '../db/threads';
import { getDb } from '../db/client';

export const TITLE_TRIGGER_ASSISTANT_TURNS = 2;

export async function maybeAutoTitle(args: {
  threadId: number;
  currentTitle: string | null;
  assistantTurns: number;
  recentMessages: ChatMessage[];
  model: string;
}): Promise<void> {
  if (args.currentTitle) return;
  if (args.assistantTurns < TITLE_TRIGGER_ASSISTANT_TURNS) return;
  try {
    const sys: ChatMessage = {
      role: 'system',
      content:
        'Title this short conversation in 6 words or fewer. Respond with the title only — no quotes, no period.',
    };
    const out = await chatOneshot({
      model: args.model,
      messages: [sys, ...args.recentMessages],
      max_tokens: 32,
    });
    const title = messageText(out.message).trim().replace(/^["']|["']$/g, '');
    if (!title) return;
    const db = await getDb();
    await updateThreadTitle(db, args.threadId, title.slice(0, 80));
  } catch {
    // Silent failure — title stays null and UI shows the date.
  }
}
```

### 8b — Replace `src/agent/profileUpdater.ts` with:

```ts
import { chatOneshot, messageText } from './openrouter';
import type { ChatMessage } from './types';
import { getDb } from '../db/client';
import { getProfile, upsertProfile, bookScopeKey } from '../db/readerProfile';
import {
  countUserMessages,
  countUserMessagesGlobal,
  listRecentUserMessagesGlobal,
  listMessagesForThread,
} from '../db/messages';

const BOOK_TURN_INTERVAL = 6;
const GLOBAL_TURN_INTERVAL = 12;
const RECENT_TURNS = 8;

async function summarize(
  model: string,
  prior: string | null,
  recentText: string,
): Promise<string | null> {
  try {
    const sys: ChatMessage = {
      role: 'system',
      content: `Given the prior reader profile (may be empty) and these recent user messages,
write a concise (≤ 500 chars) updated profile describing this reader's interests,
reading style, and preferences. Be specific, not flattering. No headers.`,
    };
    const userMsg: ChatMessage = {
      role: 'user',
      content: `Prior profile:\n${prior ?? '(none)'}\n\nRecent messages:\n${recentText}`,
    };
    const out = await chatOneshot({
      model,
      messages: [sys, userMsg],
      max_tokens: 250,
    });
    return messageText(out.message).trim().slice(0, 500) || null;
  } catch {
    return null;
  }
}

export async function maybeUpdateBookProfile(args: {
  bookId: number;
  threadId: number;
  model: string;
}): Promise<void> {
  const db = await getDb();
  const userTurns = await countUserMessages(db, args.threadId);
  const scope = bookScopeKey(args.bookId);
  const existing = await getProfile(db, scope);
  const last = existing?.turn_count ?? 0;
  if (userTurns - last < BOOK_TURN_INTERVAL) return;

  const msgs = await listMessagesForThread(db, args.threadId);
  const recent = msgs
    .filter((m) => m.role === 'user')
    .slice(-RECENT_TURNS)
    .map((m) => safeText(m.content))
    .filter(Boolean)
    .join('\n---\n');

  const summary = await summarize(args.model, existing?.summary ?? null, recent);
  if (!summary) return;
  await upsertProfile(db, { scope, summary, turn_count: userTurns });
}

export async function maybeUpdateGlobalProfile(args: { model: string }): Promise<void> {
  const db = await getDb();
  const total = await countUserMessagesGlobal(db);
  const existing = await getProfile(db, 'global');
  const last = existing?.turn_count ?? 0;
  if (total - last < GLOBAL_TURN_INTERVAL) return;

  const recent = (await listRecentUserMessagesGlobal(db, RECENT_TURNS))
    .map((m) => safeText(m.content))
    .filter(Boolean)
    .join('\n---\n');

  const summary = await summarize(args.model, existing?.summary ?? null, recent);
  if (!summary) return;
  await upsertProfile(db, { scope: 'global', summary, turn_count: total });
}

/**
 * The DB stores the per-row payload as JSON; for user rows that's `{"text": "..."}`.
 * Returns the text or '' on parse failure.
 */
function safeText(json: string): string {
  try {
    const obj = JSON.parse(json) as { text?: string };
    return typeof obj.text === 'string' ? obj.text : '';
  } catch {
    return '';
  }
}
```

**Verify:**

```
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'agent/(autoTitle|profileUpdater)' | head -10
```

Expected: no diagnostics on either file.

**Commit:** deferred to Task 10.

---

## Task 9 — Rewrite DB types/messages module and chat UI consumers

**Files:**
- `/Users/creekrichmond/Documents/projects/scholara/src/db/types.ts`
- `/Users/creekrichmond/Documents/projects/scholara/src/db/messages.ts`
- `/Users/creekrichmond/Documents/projects/scholara/src/screens/Reader/agentPanel/chat/useAgentSession.ts`
- `/Users/creekrichmond/Documents/projects/scholara/src/screens/Reader/agentPanel/chat/MessageBubble.tsx`
- `/Users/creekrichmond/Documents/projects/scholara/src/screens/Reader/agentPanel/chat/ToolUseChip.tsx`
- `/Users/creekrichmond/Documents/projects/scholara/src/screens/Reader/agentPanel/chat/types.ts` (UiMessage)

**Why:** The DB row's stored payload changes shape (per Task 3 + Task 11). The TS row type must reflect that, the messages module now writes the new payload, and the UI must render the new shape.

### 9a — `src/db/types.ts`

Make these specific edits:

```diff
-export type MessageRole = 'user' | 'assistant';
+export type MessageRole = 'user' | 'assistant' | 'tool';
```

```diff
 export interface MessageRow {
   id: number;
   thread_id: number;
   role: MessageRole;
-  /** JSON-encoded array of Anthropic content blocks. */
-  content: string;
+  /** JSON-encoded message payload. Shape depends on role:
+   *  - 'user'      → {"text": string}
+   *  - 'assistant' → {"text": string|null, "tool_calls"?: ToolCall[]}
+   *  - 'tool'      → {"tool_call_id": string, "text": string}
+   */
+  content: string;
   position_at_send: string | null;
   created_at: string;
 }
```

Leave `ConversationRole`, `ConversationRow`, `Book`, `NoteRow`, `VocabRow`, etc. alone — `ConversationRole` is the legacy `conversations` table type and unrelated to chat threads.

### 9b — `src/db/messages.ts`

**Replace the entire file with:**

```ts
import type { MessageRole, MessageRow, SqlExecutor } from './types';
import type { ChatMessage, ToolCall } from '../agent/types';

export type { MessageRow };

export interface InsertMessageInput {
  thread_id: number;
  role: MessageRole;
  /** JSON-encoded payload — see MessageRow.content docstring. Use the
   *  serialize* helpers below to construct this. */
  content: string;
  position_at_send: string | null;
}

export async function insertMessage(
  db: SqlExecutor,
  input: InsertMessageInput,
): Promise<number> {
  const { lastInsertId } = await db.execute(
    `INSERT INTO messages (thread_id, role, content, position_at_send, migrated_v6)
     VALUES (?, ?, ?, ?, 1)`,
    [input.thread_id, input.role, input.content, input.position_at_send],
  );
  return lastInsertId;
}

export async function listMessagesForThread(
  db: SqlExecutor,
  threadId: number,
): Promise<MessageRow[]> {
  return db.select<MessageRow>(
    `SELECT id, thread_id, role, content, position_at_send, created_at
     FROM messages
     WHERE thread_id = ?
     ORDER BY id ASC`,
    [threadId],
  );
}

export async function countUserMessages(
  db: SqlExecutor,
  threadId: number,
): Promise<number> {
  const rows = await db.select<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages WHERE thread_id = ? AND role = 'user'`,
    [threadId],
  );
  return rows[0]?.n ?? 0;
}

export async function countUserMessagesGlobal(db: SqlExecutor): Promise<number> {
  const rows = await db.select<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages WHERE role = 'user'`,
  );
  return rows[0]?.n ?? 0;
}

export async function listRecentUserMessagesGlobal(
  db: SqlExecutor,
  limit: number,
): Promise<MessageRow[]> {
  return db.select<MessageRow>(
    `SELECT id, thread_id, role, content, position_at_send, created_at
     FROM messages
     WHERE role = 'user'
     ORDER BY id DESC
     LIMIT ?`,
    [limit],
  );
}

// ---------- payload (de)serialization helpers ----------

export interface UserPayload { text: string }
export interface AssistantPayload { text: string | null; tool_calls?: ToolCall[] }
export interface ToolPayload { tool_call_id: string; text: string }

export function serializeUser(text: string): string {
  return JSON.stringify({ text } satisfies UserPayload);
}
export function serializeAssistant(msg: Extract<ChatMessage, { role: 'assistant' }>): string {
  const payload: AssistantPayload = {
    text: msg.content,
    ...(msg.tool_calls && msg.tool_calls.length > 0 ? { tool_calls: msg.tool_calls } : {}),
  };
  return JSON.stringify(payload);
}
export function serializeTool(msg: Extract<ChatMessage, { role: 'tool' }>): string {
  return JSON.stringify({ tool_call_id: msg.tool_call_id, text: msg.content } satisfies ToolPayload);
}

export function rowToMessage(row: MessageRow): ChatMessage {
  if (row.role === 'user') {
    const p = JSON.parse(row.content) as UserPayload;
    return { role: 'user', content: p.text };
  }
  if (row.role === 'assistant') {
    const p = JSON.parse(row.content) as AssistantPayload;
    return p.tool_calls && p.tool_calls.length > 0
      ? { role: 'assistant', content: p.text, tool_calls: p.tool_calls }
      : { role: 'assistant', content: p.text ?? '' };
  }
  // role === 'tool'
  const p = JSON.parse(row.content) as ToolPayload;
  return { role: 'tool', tool_call_id: p.tool_call_id, content: p.text };
}
```

### 9c — `src/screens/Reader/agentPanel/chat/types.ts`

`UiMessage` carried `content: ContentBlock[]`. Replace:

```ts
import type { ChatMessage, ToolCall } from '../../../../agent/types';
import type { ThreadRow } from '../../../../db/types';

export type UiMessage = {
  id: number | string;
  live?: boolean;
} & (
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; text: string }
);

export type ChatMessageForRender = ChatMessage; // re-export for prop typing if needed

export interface AgentSessionState {
  thread: ThreadRow | null;
  messages: UiMessage[];
  phase: 'idle' | 'thinking' | 'streaming' | 'tool';
  error: string | null;
}
```

(If `types.ts` defined other exports the chat panel imports — `AgentSessionState` was the existing one — keep them. The `UiMessage` shape is the only thing redesigned.)

### 9d — `src/screens/Reader/agentPanel/chat/useAgentSession.ts`

Apply the following structural changes (the surrounding scaffolding stays):

1. Replace the imports block at the top to import `ChatMessage`, `ToolCall` from `../../../../agent/types`, `serializeUser`, `serializeAssistant`, `serializeTool`, `rowToMessage` from `../../../../db/messages`, and import `DEFAULT_MODEL_ID` from `../../../../agent/models`. Drop the `ContentBlock`/`AnthropicMessage` imports.

2. Change the model default constants:

```diff
-const DEFAULT_MODEL_KEY = 'scholara_default_model';
-const DEFAULT_MODEL = 'claude-haiku-4-5';
-
-function readDefaultModel(): string {
-  return localStorage.getItem(DEFAULT_MODEL_KEY) || DEFAULT_MODEL;
-}
+import { DEFAULT_MODEL_ID } from '../../../../agent/models';
+const DEFAULT_MODEL_KEY = 'scholara_default_model';
+function readDefaultModel(): string {
+  return localStorage.getItem(DEFAULT_MODEL_KEY) || DEFAULT_MODEL_ID;
+}
```

3. `loadThread` — replace the row-to-UiMessage projection:

```ts
const messages: UiMessage[] = rows.map((r) => rowToUi(r));
```

with helper `rowToUi`:

```ts
function rowToUi(r: MessageRow): UiMessage {
  const m = rowToMessage(r);
  if (m.role === 'user') return { id: r.id, role: 'user', text: m.content };
  if (m.role === 'tool') return { id: r.id, role: 'tool', tool_call_id: m.tool_call_id, text: m.content };
  // assistant
  return m.tool_calls && m.tool_calls.length > 0
    ? { id: r.id, role: 'assistant', text: m.content, tool_calls: m.tool_calls }
    : { id: r.id, role: 'assistant', text: m.content ?? '' };
}
```

(Place `rowToUi` and any other helpers at the top of the file, above `useAgentSession`.)

4. Inside `send`, the optimistic bubble construction changes from `userBlocks: ContentBlock[]` to a plain string:

```ts
// Optimistic user bubble.
setState((s) => ({
  ...s,
  phase: 'thinking',
  error: null,
  messages: [
    ...s.messages,
    { id: -Date.now() as unknown as number, role: 'user', text },
    { id: 'live', role: 'assistant', text: '', live: true },
  ],
}));
```

5. Persist user message:

```ts
await messagesDb.insertMessage(db, {
  thread_id: thread.id,
  role: 'user',
  content: serializeUser(text),
  position_at_send: positionJson,
});
```

6. Build prior messages from rows (drop the just-inserted user, then convert to `ChatMessage[]`):

```ts
const priorRows = await messagesDb.listMessagesForThread(db, thread.id);
let prior: ChatMessage[] = priorRows
  .slice(0, -1)
  .map((r) => rowToMessage(r));
const MAX_SENT_MESSAGES = 40;
if (prior.length > MAX_SENT_MESSAGES) prior = prior.slice(prior.length - MAX_SENT_MESSAGES);
```

7. `runTurn` callbacks:

```ts
await runTurn({
  model: thread.model,
  system,
  messages: prior,
  userText: text,
  toolContext: ctx.toolContext,
  signal: ctrl.signal,
  onTextDelta: (delta) => {
    setState((s) => {
      const live = s.messages[s.messages.length - 1];
      if (!live || !live.live || live.role !== 'assistant') return s;
      const updated: UiMessage = { ...live, text: (live.text ?? '') + delta };
      return { ...s, phase: 'streaming', messages: [...s.messages.slice(0, -1), updated] };
    });
  },
  onAssistantMessage: async (msg) => {
    if (msg.role !== 'assistant') return;
    const id = await messagesDb.insertMessage(db, {
      thread_id: thread.id,
      role: 'assistant',
      content: serializeAssistant(msg),
      position_at_send: null,
    });
    setState((s) => {
      const live = s.messages[s.messages.length - 1];
      const ui: UiMessage = msg.tool_calls && msg.tool_calls.length > 0
        ? { id, role: 'assistant', text: msg.content, tool_calls: msg.tool_calls }
        : { id, role: 'assistant', text: msg.content ?? '' };
      if (!live?.live) return { ...s, messages: [...s.messages, ui] };
      return { ...s, messages: [...s.messages.slice(0, -1), ui] };
    });
  },
  onToolResults: async (msgs) => {
    for (const m of msgs) {
      if (m.role !== 'tool') continue;
      await messagesDb.insertMessage(db, {
        thread_id: thread.id,
        role: 'tool',
        content: serializeTool(m),
        position_at_send: null,
      });
    }
    setState((s) => ({
      ...s,
      phase: 'tool',
      messages: [
        ...s.messages,
        ...msgs.map((m): UiMessage => m.role === 'tool'
          ? { id: -Date.now() as unknown as number, role: 'tool', tool_call_id: m.tool_call_id, text: m.content }
          : { id: -Date.now() as unknown as number, role: 'user', text: '' }),
        { id: 'live', role: 'assistant', text: '', live: true },
      ],
    }));
  },
});
```

8. The `recentMessages` argument to `maybeAutoTitle` is now `ChatMessage[]`:

```ts
void maybeAutoTitle({
  threadId: thread.id,
  currentTitle: state.thread?.title ?? null,
  assistantTurns,
  model: thread.model,
  recentMessages: prior.slice(-4).concat({ role: 'user', content: text }),
});
```

9. The interrupted-marker write:

```ts
if (message === 'aborted') {
  await messagesDb.insertMessage(db, {
    thread_id: thread.id,
    role: 'assistant',
    content: serializeAssistant({ role: 'assistant', content: '[interrupted]' }),
    position_at_send: null,
  });
}
```

### 9e — `src/screens/Reader/agentPanel/chat/MessageBubble.tsx`

Replace the entire file with:

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { UiMessage } from './types';
import { ToolUseChip } from './ToolUseChip';

interface Props {
  message: UiMessage;
  /** Sibling messages used to look up tool-call name from a tool message's tool_call_id. */
  siblings: UiMessage[];
}

function findToolCallName(siblings: UiMessage[], toolCallId: string): string {
  for (const m of siblings) {
    if (m.role === 'assistant' && m.tool_calls) {
      const hit = m.tool_calls.find((tc) => tc.id === toolCallId);
      if (hit) return hit.function.name;
    }
  }
  return 'tool';
}

export function MessageBubble({ message, siblings }: Props) {
  if (message.role === 'user') {
    return (
      <div className="mb-3 flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-accent-orange px-3 py-2 text-sm text-white">
          <p className="whitespace-pre-wrap">{message.text}</p>
        </div>
      </div>
    );
  }

  if (message.role === 'tool') {
    const name = findToolCallName(siblings, message.tool_call_id);
    return (
      <div className="mb-3 flex justify-start">
        <div className="max-w-[85%] rounded-2xl bg-white px-3 py-2 text-sm text-ink">
          <ToolUseChip toolName={name} resultsJson={message.text} isError={message.text.startsWith('tool_error:')} />
        </div>
      </div>
    );
  }

  // assistant
  const text = message.text || (message.live ? '…' : '');
  return (
    <div className="mb-3 flex justify-start">
      <div className="max-w-[85%] rounded-2xl bg-white px-3 py-2 text-sm text-ink">
        {text && (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            {message.live && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-accent-orange align-middle" />}
          </div>
        )}
        {message.tool_calls?.map((tc) => (
          <div key={tc.id} className="text-xs italic text-ink-muted">↳ calling {tc.function.name}…</div>
        ))}
      </div>
    </div>
  );
}
```

### 9f — `MessageList.tsx`

Update the call site to pass the new props. Open `/Users/creekrichmond/Documents/projects/scholara/src/screens/Reader/agentPanel/chat/MessageList.tsx`. Wherever it does:

```tsx
{messages.map((m) => <MessageBubble key={m.id} role={m.role} content={m.content} live={m.live} />)}
```

change to:

```tsx
{messages.map((m) => <MessageBubble key={m.id} message={m} siblings={messages} />)}
```

### 9g — `ToolUseChip.tsx`

No structural changes — its props (`toolName`, `resultsJson`, `isError`) already match the new call site. Confirm the file compiles after the surrounding rewrite; no edits needed.

**Verify:**

```
npx tsc --noEmit -p tsconfig.json 2>&1 | head -30
```

Expected: no diagnostics for any of the files in this task.

**Commit:** deferred to Task 10.

---

## Task 10 — Update store.ts and Settings UI; commit the TS rewrite

**Files:**
- `/Users/creekrichmond/Documents/projects/scholara/src/store.ts`
- `/Users/creekrichmond/Documents/projects/scholara/src/screens/Settings/index.tsx`
- `/Users/creekrichmond/Documents/projects/scholara/src/screens/Settings/ModelPicker.tsx`
- `/Users/creekrichmond/Documents/projects/scholara/src/screens/Settings/ApiKeyForm.tsx`

**Why:** Final TS surface area. Renames the API-key slice/action, swaps the form, replaces the hard-coded picker options.

### 10a — `src/store.ts`

Apply these specific renames:

```diff
   apiKey: string | null;
+  openrouterApiKey: string | null;
```

Wait — that's an addition. Actually we **rename** `apiKey` → `openrouterApiKey` everywhere it appears (no dual fields). Use a single replace pass:

In the `interface AppState` block, change:

```diff
-  apiKey: string | null;
+  openrouterApiKey: string | null;
```

```diff
-  loadApiKey: () => Promise<void>;
-  saveApiKey: (key: string) => Promise<void>;
+  loadOpenrouterApiKey: () => Promise<void>;
+  saveOpenrouterApiKey: (key: string) => Promise<void>;
```

In the `create<AppState>(...)` body, change:

```diff
-  apiKey: null,
+  openrouterApiKey: null,
```

```diff
-  loadApiKey: async () => {
-    const apiKey = await secretsIpc.getSecret('anthropic');
-    set({ apiKey });
-  },
-
-  saveApiKey: async (key) => {
-    await secretsIpc.setSecret('anthropic', key);
-    set({ apiKey: key === '' ? null : key });
-  },
+  loadOpenrouterApiKey: async () => {
+    const openrouterApiKey = await secretsIpc.getSecret('openrouter');
+    set({ openrouterApiKey });
+  },
+
+  saveOpenrouterApiKey: async (key) => {
+    await secretsIpc.setSecret('openrouter', key);
+    set({ openrouterApiKey: key === '' ? null : key });
+  },
```

### 10b — Find and update all call sites of `apiKey` / `loadApiKey` / `saveApiKey`

```
grep -rn "loadApiKey\|saveApiKey\|\.apiKey\b\|apiKeyBannerDismissed" src/ tests/ | grep -v node_modules
```

Update each match:

- `loadApiKey` → `loadOpenrouterApiKey`
- `saveApiKey` → `saveOpenrouterApiKey`
- `s.apiKey` → `s.openrouterApiKey` (zustand selector access)
- `dismissApiKeyBanner` / `apiKeyBannerDismissed` are about the missing-key warning banner; those identifiers are deliberately retained — they're about *the* API key banner regardless of provider, and renaming them is out of scope. The store still holds `apiKeyBannerDismissed: boolean`.

Likely files needing the fix beyond the ones already in this plan:
- `src/screens/Settings/ApiKeyForm.tsx` (see 10d below)
- Any banner/onboarding component checking for the key — search to confirm:

```
grep -rn "loadApiKey\|saveApiKey\|store-state.apiKey\|s\.apiKey" src/ | grep -v node_modules
```

For each result, apply the corresponding rename.

### 10c — `src/screens/Settings/index.tsx`

Replace the Anthropic block:

```diff
-      <ApiKeyForm
-        storeKey="apiKey"
-        saveAction="saveApiKey"
-        heading="Anthropic API Key"
-        description="Used by the AI study mentor. Stored in your OS keychain; never written to disk by Scholara."
-        placeholder="sk-ant-..."
-        helpHref="https://console.anthropic.com"
-        helpLabel="Get a key at console.anthropic.com →"
-      />
+      <ApiKeyForm
+        storeKey="openrouterApiKey"
+        saveAction="saveOpenrouterApiKey"
+        heading="OpenRouter API Key"
+        description="Used by the AI study mentor. Stored in your OS keychain; never written to disk by Scholara. The free default model works without billing."
+        placeholder="sk-or-v1-..."
+        helpHref="https://openrouter.ai/keys"
+        helpLabel="Get a key at openrouter.ai/keys →"
+      />
```

### 10d — `src/screens/Settings/ApiKeyForm.tsx`

The `StoreKey` and `SaveAction` types are hard-coded to the old slice names. Update:

```diff
-type StoreKey = 'apiKey' | 'gutenbergApiKey';
-type SaveAction = 'saveApiKey' | 'saveGutenbergApiKey';
+type StoreKey = 'openrouterApiKey' | 'gutenbergApiKey';
+type SaveAction = 'saveOpenrouterApiKey' | 'saveGutenbergApiKey';
```

The body of the component compiles unchanged because it indexes the store by these literal types.

### 10e — `src/screens/Settings/ModelPicker.tsx`

Replace the entire file with:

```tsx
import { useEffect, useState } from 'react';
import { MODELS, DEFAULT_MODEL_ID } from '../../agent/models';

const KEY = 'scholara_default_model';

export function ModelPicker() {
  const [model, setModel] = useState<string>(
    () => localStorage.getItem(KEY) || DEFAULT_MODEL_ID,
  );

  useEffect(() => {
    localStorage.setItem(KEY, model);
  }, [model]);

  const free = MODELS.filter((m) => m.tier === 'free');
  const paid = MODELS.filter((m) => m.tier === 'paid');

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
        Default Model
      </h2>
      <p className="text-sm text-ink-muted">
        Used for new chats. Existing chats keep the model they were started with.
      </p>
      <select
        value={model}
        onChange={(e) => setModel(e.target.value)}
        className="block w-full rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm text-ink"
      >
        <optgroup label="Free">
          {free.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </optgroup>
        <optgroup label="Paid">
          {paid.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </optgroup>
      </select>
    </section>
  );
}
```

### 10f — Verify and commit the TS rewrite

```
npx tsc --noEmit -p tsconfig.json
npm run lint
npm test
```

All three should pass. (Tests `tests/agent/loop.test.ts` and `tests/db/messages.test.ts` still target the OLD shape and will fail — they are rewritten in Task 12. Until Task 12, they are *expected red*. To unblock: temporarily skip them by running `npm test -- --exclude tests/agent/loop.test.ts --exclude tests/db/messages.test.ts` for the green check. Do not commit the skip.)

A cleaner sequencing alternative if you prefer green commits: jump ahead and do Task 12 before committing Task 10. The plan's stated order is fine either way.

**Commit (single commit covering Tasks 4–10):**

```
feat(ai-chat): rewrite agent and chat UI to OpenRouter / OpenAI shape

- Replace Anthropic ContentBlock types with OpenAI ChatMessage / ToolCall / ToolDef
- Rename src/agent/anthropic.ts → src/agent/openrouter.ts; new SSE parser
  consumes OpenAI delta chunks (content + tool_calls), drops reasoning fields
- Rewrite agent loop to feed system prompt as {role:'system'} message and
  emit one {role:'tool'} message per tool call
- Rewrite tool registry to OpenAI ToolDef schema; tool bodies unchanged
- Rewrite autoTitle and profileUpdater for the new chatOneshot shape
- Update DB messages module to read/write the new payload (per-row {text,
  tool_calls?} or {tool_call_id, text}); MessageRole adds 'tool'
- Rewrite chat UI (useAgentSession, MessageBubble, MessageList, types) for
  the new UiMessage shape; ToolUseChip unchanged
- Settings: rename apiKey slice → openrouterApiKey; swap form to OpenRouter
- ModelPicker: read curated list from src/agent/models.ts with free/paid optgroups
```

---

## Task 11 — Rewrite Rust transport + add backfill_messages_v6

**Files:**
- `git mv` `/Users/creekrichmond/Documents/projects/scholara/src-tauri/src/commands/anthropic.rs` → `/Users/creekrichmond/Documents/projects/scholara/src-tauri/src/commands/openrouter.rs`
- `/Users/creekrichmond/Documents/projects/scholara/src-tauri/src/commands/openrouter.rs` (rewritten contents)
- `/Users/creekrichmond/Documents/projects/scholara/src-tauri/src/commands/mod.rs`
- `/Users/creekrichmond/Documents/projects/scholara/src-tauri/src/migrate_v6.rs` (new)
- `/Users/creekrichmond/Documents/projects/scholara/src-tauri/src/lib.rs`

**Why:** Switch the wire to OpenRouter's OpenAI-shape endpoint, run the v6 backfill on app startup, and rename the Cargo module accordingly.

### 11a — Rename + replace contents of openrouter.rs

```
git mv src-tauri/src/commands/anthropic.rs src-tauri/src/commands/openrouter.rs
```

**Replace the entire file contents with:**

```rust
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;

const SERVICE: &str = "scholara";
const ACCOUNT: &str = "openrouter_api_key";
const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const REFERER: &str = "https://scholara.app";
const APP_TITLE: &str = "Scholara";

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<Value>,
    pub tools: Option<Vec<Value>>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "kind")]
pub enum StreamEvent {
    #[serde(rename = "event")]
    Event { event: String, data: Value },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "done")]
    Done,
}

fn redact_key_in_message(s: &str) -> String {
    if let Some(idx) = s.find("sk-or-v1-") {
        let mut out = s.to_string();
        out.replace_range(idx..s.len().min(idx + 12), "sk-or-v1-•••");
        out
    } else {
        s.to_string()
    }
}

fn load_api_key() -> Result<String, String> {
    let entry = Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| format!("Could not access keychain: {e}"))?;
    match entry.get_password() {
        Ok(s) => Ok(s),
        Err(KeyringError::NoEntry) => Err("missing_api_key".into()),
        Err(e) => Err(format!("Could not load api key: {e}")),
    }
}

fn build_body(req: &ChatRequest, stream: bool) -> Value {
    let mut body = serde_json::json!({
        "model": req.model,
        "max_tokens": req.max_tokens.unwrap_or(2048),
        "messages": req.messages,
    });
    if stream {
        body["stream"] = Value::Bool(true);
    }
    if let Some(tools) = &req.tools {
        if !tools.is_empty() {
            body["tools"] = Value::Array(tools.clone());
            body["tool_choice"] = Value::String("auto".into());
        }
    }
    body
}

fn add_common_headers(builder: reqwest::RequestBuilder, key: &str) -> reqwest::RequestBuilder {
    builder
        .header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/json")
        .header("HTTP-Referer", REFERER)
        .header("X-Title", APP_TITLE)
}

#[tauri::command]
pub async fn chat_stream(req: ChatRequest, on_event: Channel<StreamEvent>) -> Result<(), String> {
    let key = load_api_key()?;
    let body = build_body(&req, true);

    let client = reqwest::Client::new();
    let resp = add_common_headers(client.post(OPENROUTER_URL), &key)
        .json(&body)
        .send()
        .await
        .map_err(|e| redact_key_in_message(&format!("network_error: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(redact_key_in_message(&format!("http_{status}: {text}")));
    }

    let mut stream = resp.bytes_stream().eventsource();
    while let Some(event) = stream.next().await {
        match event {
            Ok(ev) => {
                // OpenRouter terminates with `data: [DONE]`.
                if ev.data.trim() == "[DONE]" {
                    break;
                }
                let data: Value = serde_json::from_str(&ev.data).unwrap_or(Value::Null);
                let event_name = if ev.event.is_empty() { "message".to_string() } else { ev.event };
                on_event
                    .send(StreamEvent::Event { event: event_name, data })
                    .map_err(|e| format!("channel_error: {e}"))?;
            }
            Err(e) => {
                let msg = redact_key_in_message(&format!("sse_error: {e}"));
                let _ = on_event.send(StreamEvent::Error { message: msg.clone() });
                return Err(msg);
            }
        }
    }
    on_event
        .send(StreamEvent::Done)
        .map_err(|e| format!("channel_error: {e}"))?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct OneshotRequest {
    pub model: String,
    pub messages: Vec<Value>,
    pub max_tokens: Option<u32>,
}

#[tauri::command]
pub async fn chat_oneshot(req: OneshotRequest) -> Result<Value, String> {
    let key = load_api_key()?;
    let body = build_body(
        &ChatRequest {
            model: req.model,
            messages: req.messages,
            tools: None,
            max_tokens: req.max_tokens.or(Some(512)),
        },
        false,
    );
    let client = reqwest::Client::new();
    let resp = add_common_headers(client.post(OPENROUTER_URL), &key)
        .json(&body)
        .send()
        .await
        .map_err(|e| redact_key_in_message(&format!("network_error: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(redact_key_in_message(&format!("http_{status}: {text}")));
    }
    let value: Value = resp
        .json()
        .await
        .map_err(|e| redact_key_in_message(&format!("decode_error: {e}")))?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn redacts_sk_or_fragments() {
        let msg = "Authorization failed for sk-or-v1-abcdef yikes";
        let red = redact_key_in_message(msg);
        assert!(!red.contains("sk-or-v1-abcdef"));
        assert!(red.contains("sk-or-v1-•••"));
    }
    #[test]
    fn no_op_when_no_key_in_message() {
        let msg = "boring error";
        assert_eq!(redact_key_in_message(msg), "boring error");
    }
    #[test]
    fn body_omits_tools_when_none() {
        let req = ChatRequest {
            model: "m".into(),
            messages: vec![],
            tools: None,
            max_tokens: None,
        };
        let body = build_body(&req, true);
        assert!(body.get("tools").is_none());
        assert!(body.get("tool_choice").is_none());
        assert_eq!(body["stream"], Value::Bool(true));
    }
    #[test]
    fn body_sets_tool_choice_auto_when_tools_present() {
        let req = ChatRequest {
            model: "m".into(),
            messages: vec![],
            tools: Some(vec![serde_json::json!({"type": "function"})]),
            max_tokens: None,
        };
        let body = build_body(&req, true);
        assert_eq!(body["tool_choice"], Value::String("auto".into()));
        assert!(body["tools"].is_array());
    }
    #[test]
    fn body_omits_stream_when_false() {
        let req = ChatRequest { model: "m".into(), messages: vec![], tools: None, max_tokens: None };
        let body = build_body(&req, false);
        assert!(body.get("stream").is_none());
    }
    #[test]
    fn body_does_not_include_top_level_system() {
        let req = ChatRequest { model: "m".into(), messages: vec![], tools: None, max_tokens: None };
        let body = build_body(&req, true);
        assert!(body.get("system").is_none());
    }
}
```

### 11b — `src-tauri/src/commands/mod.rs`

```diff
-pub mod anthropic;
+pub mod openrouter;
```

### 11c — Add `src-tauri/src/migrate_v6.rs` (backfill)

**File contents:**

```rust
//! Backfill task for migration 0006: rewrite legacy Anthropic-shape `messages.content_legacy`
//! rows into the new OpenAI-shape payload in `messages.content`. Runs once per row at app
//! startup; idempotent via the `migrated_v6` flag.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::PathBuf;

/// Public entry point. Opens the same SQLite file `tauri-plugin-sql` uses,
/// runs the per-row backfill, and rewrites `threads.model` strings.
pub fn backfill_messages_v6(db_path: &PathBuf) -> rusqlite::Result<()> {
    let conn = Connection::open(db_path)?;

    backfill_messages(&conn)?;
    rewrite_thread_models(&conn)?;
    Ok(())
}

fn backfill_messages(conn: &Connection) -> rusqlite::Result<()> {
    // Collect the rows that still need migrating. Doing this up front avoids
    // iterator-mutation issues when split-row cases delete the source.
    let mut stmt = conn.prepare(
        "SELECT id, thread_id, role, content_legacy, position_at_send, created_at
         FROM messages WHERE migrated_v6 = 0",
    )?;
    let rows: Vec<(i64, i64, String, Option<String>, Option<String>, String)> = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?
        .collect::<Result<_, _>>()?;
    drop(stmt);

    for (id, thread_id, role, legacy, pos, created_at) in rows {
        match transform_row(&role, legacy.as_deref()) {
            // No split: 1 → 1 row. Update in place.
            TransformResult::Single { role: new_role, content } => {
                conn.execute(
                    "UPDATE messages SET role = ?, content = ?, migrated_v6 = 1 WHERE id = ?",
                    params![new_role, content, id],
                )?;
            }
            // Split: 1 source → N rows. Delete source, insert in source order.
            TransformResult::Split(rows) => {
                conn.execute("DELETE FROM messages WHERE id = ?", params![id])?;
                for (new_role, content) in rows {
                    conn.execute(
                        "INSERT INTO messages
                         (thread_id, role, content, content_legacy, position_at_send, migrated_v6, created_at)
                         VALUES (?, ?, ?, NULL, ?, 1, ?)",
                        params![thread_id, new_role, content, pos, created_at],
                    )?;
                }
            }
            // Unparseable legacy content: write empty payload, keep role, mark migrated.
            TransformResult::Empty => {
                let new_content = if role == "tool" {
                    json!({ "tool_call_id": "", "text": "" }).to_string()
                } else {
                    json!({ "text": "" }).to_string()
                };
                conn.execute(
                    "UPDATE messages SET content = ?, migrated_v6 = 1 WHERE id = ?",
                    params![new_content, id],
                )?;
            }
        }
    }

    Ok(())
}

enum TransformResult {
    Single { role: String, content: String },
    Split(Vec<(String, String)>), // (role, content) tuples in insertion order
    Empty,
}

fn transform_row(role: &str, legacy: Option<&str>) -> TransformResult {
    let Some(legacy_str) = legacy else { return TransformResult::Empty };
    let blocks: Vec<Value> = match serde_json::from_str(legacy_str) {
        Ok(Value::Array(a)) => a,
        _ => return TransformResult::Empty,
    };

    match role {
        "user" => transform_user(blocks),
        "assistant" => transform_assistant(blocks),
        _ => TransformResult::Empty,
    }
}

fn transform_user(blocks: Vec<Value>) -> TransformResult {
    // Partition blocks into text and tool_result preserving order.
    let mut text_parts: Vec<String> = Vec::new();
    let mut tool_blocks: Vec<(String /*tool_use_id*/, String /*content*/)> = Vec::new();
    for b in &blocks {
        let ty = b.get("type").and_then(Value::as_str).unwrap_or("");
        if ty == "text" {
            if let Some(t) = b.get("text").and_then(Value::as_str) {
                text_parts.push(t.to_string());
            }
        } else if ty == "tool_result" {
            let id = b.get("tool_use_id").and_then(Value::as_str).unwrap_or("").to_string();
            let content = b.get("content").and_then(Value::as_str).unwrap_or("").to_string();
            tool_blocks.push((id, content));
        }
    }

    if tool_blocks.is_empty() {
        let payload = json!({ "text": text_parts.join("") }).to_string();
        return TransformResult::Single { role: "user".into(), content: payload };
    }

    if text_parts.is_empty() && tool_blocks.len() == 1 {
        // Pure single-tool-result: rewrite role to 'tool'.
        let (id, content) = tool_blocks.into_iter().next().unwrap();
        let payload = json!({ "tool_call_id": id, "text": content }).to_string();
        return TransformResult::Single { role: "tool".into(), content: payload };
    }

    // Mixed or multi-tool case: split into rows preserving the source order.
    let mut out: Vec<(String, String)> = Vec::new();
    for b in blocks {
        let ty = b.get("type").and_then(Value::as_str).unwrap_or("");
        if ty == "text" {
            let t = b.get("text").and_then(Value::as_str).unwrap_or("");
            if !t.is_empty() {
                out.push(("user".into(), json!({ "text": t }).to_string()));
            }
        } else if ty == "tool_result" {
            let id = b.get("tool_use_id").and_then(Value::as_str).unwrap_or("");
            let c = b.get("content").and_then(Value::as_str).unwrap_or("");
            out.push(("tool".into(), json!({ "tool_call_id": id, "text": c }).to_string()));
        }
    }
    if out.is_empty() {
        TransformResult::Single {
            role: "user".into(),
            content: json!({ "text": "" }).to_string(),
        }
    } else {
        TransformResult::Split(out)
    }
}

fn transform_assistant(blocks: Vec<Value>) -> TransformResult {
    let mut text = String::new();
    let mut tool_calls: Vec<Value> = Vec::new();
    for b in &blocks {
        let ty = b.get("type").and_then(Value::as_str).unwrap_or("");
        if ty == "text" {
            if let Some(t) = b.get("text").and_then(Value::as_str) {
                text.push_str(t);
            }
        } else if ty == "tool_use" {
            let id = b.get("id").and_then(Value::as_str).unwrap_or("");
            let name = b.get("name").and_then(Value::as_str).unwrap_or("");
            let input = b.get("input").cloned().unwrap_or(json!({}));
            tool_calls.push(json!({
                "id": id,
                "type": "function",
                "function": { "name": name, "arguments": input.to_string() }
            }));
        }
    }
    let mut payload = serde_json::Map::new();
    if tool_calls.is_empty() {
        payload.insert("text".into(), Value::String(text));
    } else {
        payload.insert(
            "text".into(),
            if text.is_empty() { Value::Null } else { Value::String(text) },
        );
        payload.insert("tool_calls".into(), Value::Array(tool_calls));
    }
    TransformResult::Single {
        role: "assistant".into(),
        content: Value::Object(payload).to_string(),
    }
}

fn rewrite_thread_models(conn: &Connection) -> rusqlite::Result<()> {
    // Map legacy Anthropic short ids to OpenRouter slugs. Unknown / NULL → fall back
    // to the curated default. The default id is duplicated here from
    // `src/agent/models.ts` (keep in sync if the TS default changes).
    const DEFAULT: &str = "deepseek/deepseek-chat-v3-0324:free";

    fn translate(model: &str) -> &str {
        match model {
            "claude-haiku-4-5" => "anthropic/claude-haiku-4.5",
            "claude-sonnet-4-6" => "anthropic/claude-sonnet-4.6",
            "claude-opus-4-7" => "anthropic/claude-opus-4.7",
            // Already-slug values (e.g., from a previous run) pass through unchanged.
            other if other.contains('/') => other,
            _ => DEFAULT,
        }
    }

    let mut stmt = conn.prepare("SELECT id, model FROM threads")?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<_, _>>()?;
    drop(stmt);

    for (id, model) in rows {
        let new_id = translate(&model).to_string();
        if new_id != model {
            conn.execute("UPDATE threads SET model = ? WHERE id = ?", params![new_id, id])?;
        }
    }
    Ok(())
}

// ---------- tests ----------
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fresh_db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        // Minimal schema mirroring 0005 + 0006.
        c.execute_batch(
            "CREATE TABLE threads (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               book_id INTEGER NOT NULL,
               title TEXT,
               spoiler_mode INTEGER NOT NULL DEFAULT 1,
               model TEXT NOT NULL,
               last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
               created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE TABLE messages (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               thread_id INTEGER NOT NULL,
               role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
               content TEXT,
               content_legacy TEXT,
               position_at_send TEXT,
               migrated_v6 INTEGER NOT NULL DEFAULT 0,
               created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );",
        ).unwrap();
        c
    }

    fn insert_legacy(c: &Connection, role: &str, legacy: &str) -> i64 {
        c.execute(
            "INSERT INTO threads (book_id, model) VALUES (1, 'claude-haiku-4-5')",
            [],
        ).ok(); // idempotent across calls
        let thread_id: i64 = c
            .query_row("SELECT id FROM threads ORDER BY id ASC LIMIT 1", [], |r| r.get(0))
            .unwrap();
        c.execute(
            "INSERT INTO messages (thread_id, role, content, content_legacy, migrated_v6)
             VALUES (?, ?, NULL, ?, 0)",
            params![thread_id, role, legacy],
        ).unwrap();
        c.last_insert_rowid()
    }

    fn read_row(c: &Connection, id: i64) -> (String, String) {
        c.query_row(
            "SELECT role, content FROM messages WHERE id = ?",
            params![id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        ).unwrap()
    }

    fn read_all(c: &Connection) -> Vec<(i64, String, String)> {
        let mut s = c.prepare("SELECT id, role, content FROM messages ORDER BY id ASC").unwrap();
        s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn user_text_only_is_rewritten() {
        let c = fresh_db();
        let id = insert_legacy(&c, "user", r#"[{"type":"text","text":"hello"}]"#);
        backfill_messages(&c).unwrap();
        let (role, content) = read_row(&c, id);
        assert_eq!(role, "user");
        let v: Value = serde_json::from_str(&content).unwrap();
        assert_eq!(v["text"], "hello");
    }

    #[test]
    fn assistant_text_and_tool_use_combine_into_one_row() {
        let c = fresh_db();
        let id = insert_legacy(
            &c,
            "assistant",
            r#"[{"type":"text","text":"sure"},{"type":"tool_use","id":"tu1","name":"search_book","input":{"query":"q"}}]"#,
        );
        backfill_messages(&c).unwrap();
        let (role, content) = read_row(&c, id);
        assert_eq!(role, "assistant");
        let v: Value = serde_json::from_str(&content).unwrap();
        assert_eq!(v["text"], "sure");
        assert_eq!(v["tool_calls"][0]["id"], "tu1");
        assert_eq!(v["tool_calls"][0]["function"]["name"], "search_book");
        assert_eq!(v["tool_calls"][0]["function"]["arguments"], r#"{"query":"q"}"#);
    }

    #[test]
    fn user_single_tool_result_becomes_tool_role() {
        let c = fresh_db();
        let id = insert_legacy(
            &c,
            "user",
            r#"[{"type":"tool_result","tool_use_id":"tu1","content":"[]"}]"#,
        );
        backfill_messages(&c).unwrap();
        let (role, content) = read_row(&c, id);
        assert_eq!(role, "tool");
        let v: Value = serde_json::from_str(&content).unwrap();
        assert_eq!(v["tool_call_id"], "tu1");
        assert_eq!(v["text"], "[]");
    }

    #[test]
    fn user_mixed_tool_results_split_into_multiple_rows_in_order() {
        let c = fresh_db();
        let _ = insert_legacy(
            &c,
            "user",
            r#"[
              {"type":"text","text":"check this:"},
              {"type":"tool_result","tool_use_id":"tu1","content":"a"},
              {"type":"tool_result","tool_use_id":"tu2","content":"b"}
            ]"#,
        );
        backfill_messages(&c).unwrap();
        let rows = read_all(&c);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].1, "user");
        assert_eq!(rows[1].1, "tool");
        assert_eq!(rows[2].1, "tool");
    }

    #[test]
    fn backfill_is_idempotent() {
        let c = fresh_db();
        let id = insert_legacy(&c, "user", r#"[{"type":"text","text":"hi"}]"#);
        backfill_messages(&c).unwrap();
        let first = read_row(&c, id);
        backfill_messages(&c).unwrap();
        let second = read_row(&c, id);
        assert_eq!(first, second);
    }

    #[test]
    fn thread_models_translate_known_ids_and_default_unknowns() {
        let c = fresh_db();
        c.execute("INSERT INTO threads (book_id, model) VALUES (1, 'claude-haiku-4-5')", []).unwrap();
        c.execute("INSERT INTO threads (book_id, model) VALUES (1, 'something-else')", []).unwrap();
        c.execute("INSERT INTO threads (book_id, model) VALUES (1, 'anthropic/claude-haiku-4.5')", []).unwrap();
        rewrite_thread_models(&c).unwrap();
        let rows: Vec<String> = c
            .prepare("SELECT model FROM threads ORDER BY id ASC").unwrap()
            .query_map([], |r| r.get::<_, String>(0)).unwrap()
            .collect::<Result<_, _>>().unwrap();
        assert_eq!(rows[0], "anthropic/claude-haiku-4.5");
        assert_eq!(rows[1], "deepseek/deepseek-chat-v3-0324:free");
        assert_eq!(rows[2], "anthropic/claude-haiku-4.5");
    }
}
```

### 11d — Wire the backfill into app startup (`src-tauri/src/lib.rs`)

Replace the entire current contents with:

```rust
mod commands;
mod migrate_v6;

use commands::openrouter::{chat_oneshot, chat_stream};
use commands::books::{
    app_data_dir_path, copy_uploaded_file, delete_book_files, read_book_bytes,
    reveal_in_file_manager, save_cover_bytes,
};
use commands::gutenberg::download_gutenberg_epub;
use commands::secrets::{diagnose_secret, get_secret, set_secret};
use commands::wordnet::{lookup_wordnet, WordnetState};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "init schema",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "phase 2: epub_locations",
            sql: include_str!("../migrations/0002_phase2.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "vocabulary unique per book",
            sql: include_str!("../migrations/0003_vocab_unique.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "phase 4a: gutenberg panel state",
            sql: include_str!("../migrations/0004_gutenberg.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "ai chat: threads, messages, chunks, preferences, profile",
            sql: include_str!("../migrations/0005_ai_chat.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "openrouter: rebuild messages table for tool role + new payload shape",
            sql: include_str!("../migrations/0006_openrouter_message_shape.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .manage(WordnetState::default())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:scholara.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // After tauri-plugin-sql has applied migrations, run the v6 backfill on
            // the same db file. Failure is logged but non-fatal — startup still proceeds.
            let app_data = app.path().app_data_dir().ok();
            if let Some(mut dir) = app_data {
                dir.push("scholara.db");
                if let Err(e) = migrate_v6::backfill_messages_v6(&dir) {
                    eprintln!("backfill_messages_v6 failed: {e}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            copy_uploaded_file,
            app_data_dir_path,
            reveal_in_file_manager,
            read_book_bytes,
            save_cover_bytes,
            delete_book_files,
            get_secret,
            set_secret,
            diagnose_secret,
            download_gutenberg_epub,
            lookup_wordnet,
            chat_stream,
            chat_oneshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 11e — Add `rusqlite` import path

`rusqlite` is already in `src-tauri/Cargo.toml` as a `bundled` dependency, so no Cargo edit is needed.

**Verify:**

```
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -40
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20
```

Expected: all `openrouter::tests` (6) and `migrate_v6::tests` (6) pass; build succeeds.

**Commit:**

```
feat(ai-chat): rust transport + v6 backfill for OpenRouter

- Rename src-tauri/src/commands/anthropic.rs → openrouter.rs; rewrite to
  POST openrouter.ai/api/v1/chat/completions with Bearer auth, HTTP-Referer,
  X-Title, OpenAI-shape body (no top-level system, tool_choice when tools)
- Filter `data: [DONE]` SSE terminator; redact sk-or-v1- key fragments
- Add src-tauri/src/migrate_v6.rs: backfill content_legacy → new payload,
  rewrite threads.model from short ids to OpenRouter slugs, idempotent
- Wire backfill into app startup .setup() after migrations apply
```

---

## Task 12 — Rewrite vitest db/messages tests against the new shape

**File:** `/Users/creekrichmond/Documents/projects/scholara/tests/db/messages.test.ts`

**Why:** The existing tests insert `content: '[]'` (legacy Anthropic shape) and exercise the count/list helpers. They will already keep passing, but the test data is misleading after the rewrite. Update to use the new payload via `serializeUser` etc., add a round-trip test for `rowToMessage`, and verify the `'tool'` role round-trips.

**Replace the entire file with:**

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../helpers/sqlite';
import * as booksDb from '../../src/db/books';
import { insertThread } from '../../src/db/threads';
import {
  insertMessage,
  listMessagesForThread,
  countUserMessages,
  countUserMessagesGlobal,
  listRecentUserMessagesGlobal,
  serializeUser,
  serializeAssistant,
  serializeTool,
  rowToMessage,
} from '../../src/db/messages';
import type { SqlExecutor } from '../../src/db/types';

let db: SqlExecutor;
let bookId: number;
let threadA: number;
let threadB: number;

beforeEach(async () => {
  db = makeTestDb();
  bookId = await booksDb.insertBook(db, {
    title: 'Test', author: null, file_path: '/p.epub', file_type: 'epub',
  });
  threadA = await insertThread(db, { book_id: bookId, model: 'deepseek/deepseek-chat-v3-0324:free' });
  threadB = await insertThread(db, { book_id: bookId, model: 'deepseek/deepseek-chat-v3-0324:free' });
});

describe('messages (OpenAI shape)', () => {
  it('user round-trip: serializeUser ↔ rowToMessage', async () => {
    const id = await insertMessage(db, {
      thread_id: threadA, role: 'user',
      content: serializeUser('hello world'), position_at_send: null,
    });
    const rows = await listMessagesForThread(db, threadA);
    const row = rows.find((r) => r.id === id)!;
    expect(rowToMessage(row)).toEqual({ role: 'user', content: 'hello world' });
  });

  it('assistant with tool_calls round-trip', async () => {
    const msg = {
      role: 'assistant' as const,
      content: null,
      tool_calls: [{
        id: 'call_1', type: 'function' as const,
        function: { name: 'search_book', arguments: '{"query":"q"}' },
      }],
    };
    await insertMessage(db, {
      thread_id: threadA, role: 'assistant',
      content: serializeAssistant(msg), position_at_send: null,
    });
    const [row] = await listMessagesForThread(db, threadA);
    expect(rowToMessage(row)).toEqual(msg);
  });

  it('assistant with text-only round-trip', async () => {
    const msg = { role: 'assistant' as const, content: 'just text' };
    await insertMessage(db, {
      thread_id: threadA, role: 'assistant',
      content: serializeAssistant(msg), position_at_send: null,
    });
    const [row] = await listMessagesForThread(db, threadA);
    expect(rowToMessage(row)).toEqual(msg);
  });

  it("tool role round-trip with tool_call_id", async () => {
    await insertMessage(db, {
      thread_id: threadA, role: 'tool',
      content: serializeTool({ role: 'tool', tool_call_id: 'call_42', content: '[]' }),
      position_at_send: null,
    });
    const [row] = await listMessagesForThread(db, threadA);
    expect(row.role).toBe('tool');
    expect(rowToMessage(row)).toEqual({ role: 'tool', tool_call_id: 'call_42', content: '[]' });
  });

  it('listMessagesForThread orders by id ASC', async () => {
    const a = await insertMessage(db, { thread_id: threadA, role: 'user', content: serializeUser('a'), position_at_send: null });
    const b = await insertMessage(db, { thread_id: threadA, role: 'assistant', content: serializeAssistant({ role: 'assistant', content: 'b' }), position_at_send: null });
    const rows = await listMessagesForThread(db, threadA);
    expect(rows.map((r) => r.id)).toEqual([a, b]);
  });

  it("countUserMessages counts only role='user' on the given thread", async () => {
    await insertMessage(db, { thread_id: threadA, role: 'user', content: serializeUser('1'), position_at_send: null });
    await insertMessage(db, { thread_id: threadA, role: 'assistant', content: serializeAssistant({ role: 'assistant', content: 'a' }), position_at_send: null });
    await insertMessage(db, { thread_id: threadA, role: 'tool', content: serializeTool({ role: 'tool', tool_call_id: 't1', content: '[]' }), position_at_send: null });
    await insertMessage(db, { thread_id: threadA, role: 'user', content: serializeUser('2'), position_at_send: null });
    await insertMessage(db, { thread_id: threadB, role: 'user', content: serializeUser('3'), position_at_send: null });
    expect(await countUserMessages(db, threadA)).toBe(2);
    expect(await countUserMessages(db, threadB)).toBe(1);
  });

  it('countUserMessagesGlobal sums user across threads, ignores tool/assistant', async () => {
    await insertMessage(db, { thread_id: threadA, role: 'user', content: serializeUser('1'), position_at_send: null });
    await insertMessage(db, { thread_id: threadA, role: 'tool', content: serializeTool({ role: 'tool', tool_call_id: 't1', content: '[]' }), position_at_send: null });
    await insertMessage(db, { thread_id: threadB, role: 'user', content: serializeUser('2'), position_at_send: null });
    expect(await countUserMessagesGlobal(db)).toBe(2);
  });

  it('listRecentUserMessagesGlobal limits and orders DESC', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(await insertMessage(db, {
        thread_id: threadA, role: 'user',
        content: serializeUser(`m${i}`), position_at_send: null,
      }));
    }
    const rows = await listRecentUserMessagesGlobal(db, 2);
    expect(rows.map((r) => r.id)).toEqual([ids[3], ids[2]]);
  });
});
```

**Note on the test SQLite helper:** `tests/helpers/sqlite.ts` (a one-line file according to its 1-line size in `git diff --stat`) sets up the in-memory db. Confirm it applies migration 0006's CHECK constraint that allows `'tool'`. Open `/Users/creekrichmond/Documents/projects/scholara/tests/helpers/sqlite.ts` and read it. If it inlines the legacy CHECK, update it to allow `'tool'`. The expected change is:

```diff
-  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
+  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
```

If it instead reads the migration files (which is the cleaner pattern), no edit is needed once 0006 is in place.

**Verify:**

```
npm test -- tests/db/messages.test.ts
```

Expected: all 8 tests pass.

**Commit:**

```
test(ai-chat): rewrite db/messages tests for OpenAI-shape payload + tool role
```

---

## Task 13 — Rewrite vitest agent/loop tests

**File:** `/Users/creekrichmond/Documents/projects/scholara/tests/agent/loop.test.ts`

**Why:** The existing test mocks the old `chatStream` shape and asserts on `tool_use` / `tool_result` blocks. Both must be updated.

**Replace the entire file with:**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { chatStreamMock, dispatchToolMock } = vi.hoisted(() => ({
  chatStreamMock: vi.fn(),
  dispatchToolMock: vi.fn(),
}));

vi.mock('../../src/agent/openrouter', async () => {
  const actual = await vi.importActual<typeof import('../../src/agent/openrouter')>(
    '../../src/agent/openrouter',
  );
  return { ...actual, chatStream: chatStreamMock };
});

vi.mock('../../src/agent/tools/registry', () => ({
  TOOL_DEFS: [],
  dispatchTool: dispatchToolMock,
}));

import { runTurn } from '../../src/agent/loop';

beforeEach(() => {
  chatStreamMock.mockReset();
  dispatchToolMock.mockReset();
});

describe('runTurn (OpenAI shape)', () => {
  it('stops after a single text-only response', async () => {
    chatStreamMock.mockResolvedValueOnce({ role: 'assistant', content: 'hello' });
    const onAssistant = vi.fn();
    await runTurn({
      model: 'm', system: 's', messages: [], userText: 'hi',
      toolContext: { bookId: 1, spoilerCap: { enabled: false, position: null, index: {} } },
      onTextDelta: () => {}, onAssistantMessage: onAssistant, onToolResults: () => {},
    });
    expect(chatStreamMock).toHaveBeenCalledTimes(1);
    expect(onAssistant).toHaveBeenCalledTimes(1);
  });

  it('dispatches tool_calls and feeds back role:tool messages', async () => {
    chatStreamMock
      .mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1', type: 'function',
          function: { name: 'search_book', arguments: '{"query":"q"}' },
        }],
      })
      .mockResolvedValueOnce({ role: 'assistant', content: 'final' });
    dispatchToolMock.mockResolvedValueOnce({ content: '[]', is_error: false });

    const onTool = vi.fn();
    await runTurn({
      model: 'm', system: 's', messages: [], userText: 'hi',
      toolContext: { bookId: 1, spoilerCap: { enabled: false, position: null, index: {} } },
      onTextDelta: () => {}, onAssistantMessage: () => {}, onToolResults: onTool,
    });
    expect(chatStreamMock).toHaveBeenCalledTimes(2);
    expect(dispatchToolMock).toHaveBeenCalledWith('search_book', { query: 'q' }, expect.anything());
    expect(onTool).toHaveBeenCalledTimes(1);
    const toolMsgs = onTool.mock.calls[0][0];
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '[]' });
  });

  it('prepends a system message and the new user turn into the conversation sent to chatStream', async () => {
    chatStreamMock.mockResolvedValueOnce({ role: 'assistant', content: 'ok' });
    await runTurn({
      model: 'm', system: 'SYS', messages: [{ role: 'user', content: 'prior' }], userText: 'now',
      toolContext: { bookId: 1, spoilerCap: { enabled: false, position: null, index: {} } },
      onTextDelta: () => {}, onAssistantMessage: () => {}, onToolResults: () => {},
    });
    const reqArg = chatStreamMock.mock.calls[0][0];
    expect(reqArg.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(reqArg.messages[1]).toEqual({ role: 'user', content: 'prior' });
    expect(reqArg.messages[2]).toEqual({ role: 'user', content: 'now' });
  });

  it('marks tool errors with tool_error: prefix in the tool message content', async () => {
    chatStreamMock
      .mockResolvedValueOnce({
        role: 'assistant', content: null,
        tool_calls: [{ id: 'c', type: 'function', function: { name: 'search_book', arguments: '{}' } }],
      })
      .mockResolvedValueOnce({ role: 'assistant', content: 'done' });
    dispatchToolMock.mockResolvedValueOnce({ content: 'whoops', is_error: true });

    const onTool = vi.fn();
    await runTurn({
      model: 'm', system: 's', messages: [], userText: 'hi',
      toolContext: { bookId: 1, spoilerCap: { enabled: false, position: null, index: {} } },
      onTextDelta: () => {}, onAssistantMessage: () => {}, onToolResults: onTool,
    });
    expect(onTool.mock.calls[0][0][0].content).toMatch(/^tool_error:/);
  });
});
```

**Verify:**

```
npm test -- tests/agent/loop.test.ts
```

Expected: 4 tests pass.

**Commit:**

```
test(ai-chat): rewrite agent/loop tests for OpenAI-shape tool_calls / role:tool
```

---

## Task 14 — Touch tool/prompts tests for new imports

**Files:**
- `/Users/creekrichmond/Documents/projects/scholara/tests/agent/tools/searchBook.test.ts`
- `/Users/creekrichmond/Documents/projects/scholara/tests/agent/tools/searchNotes.test.ts`
- `/Users/creekrichmond/Documents/projects/scholara/tests/agent/prompts.test.ts`

**Why:** Each test imports from `../../src/agent/...`. Confirm these no longer reference deleted types. Add a single schema-shape assertion to the tool tests so the new `ToolDef` shape is locked in by a regression test.

For `tests/agent/tools/searchBook.test.ts`, add at the bottom (after the existing `describe` block):

```ts
import { TOOL_DEFS } from '../../../src/agent/tools/registry';

describe('TOOL_DEFS schema shape', () => {
  it('search_book is exposed in OpenAI ToolDef shape', () => {
    const def = TOOL_DEFS.find((d) => d.function.name === 'search_book');
    expect(def).toBeDefined();
    expect(def?.type).toBe('function');
    expect(def?.function.parameters).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    });
  });
});
```

For `tests/agent/tools/searchNotes.test.ts`, add the analogous assertion for `search_notes`.

For `tests/agent/prompts.test.ts`, no edits should be required — `buildSystemPrompt` is unchanged. Run the file to confirm:

```
npm test -- tests/agent/prompts.test.ts tests/agent/tools/
```

Expected: all pass.

**Commit:**

```
test(ai-chat): assert TOOL_DEFS expose OpenAI-shape function schemas
```

---

## Task 15 — Update Playwright mocks and spec to OpenAI-shape SSE

**Files:**
- `/Users/creekrichmond/Documents/projects/scholara/tests/playwright/mocks/tauriCore.ts`
- `/Users/creekrichmond/Documents/projects/scholara/tests/playwright/ai-chat.spec.ts`
- `/Users/creekrichmond/Documents/projects/scholara/tests/playwright/mocks/db.ts` (verify-only — see step 15c)

**Why:** The mock currently emits Anthropic `content_block_*` events; the new TS parser ignores those and consumes OpenAI deltas. The spec's assertion on the streamed text is fine; only the chunk format changes.

### 15a — `tests/playwright/mocks/tauriCore.ts` `chat_stream` case

Replace the body of the `case 'chat_stream':` block with:

```ts
    case 'chat_stream': {
      const channel = args.onEvent as Channel<ChatStreamEvent> | undefined;
      const script = getChatStreamScript();
      if (!channel) {
        throw new Error('chat_stream mock invoked without onEvent channel');
      }
      if (script.error) {
        channel.emit({ kind: 'error', message: script.error });
        throw new Error(script.error);
      }
      const chunks = script.textChunks ?? ['Hello from the mocked OpenRouter stream.'];
      const delay = script.delayMs ?? 0;

      const emitChunk = async (i: number) => {
        if (i >= chunks.length) {
          channel.emit({ kind: 'done' });
          return;
        }
        // OpenAI-shape delta: { choices: [{ delta: { content } }] }
        channel.emit({
          kind: 'event',
          event: 'message',
          data: { choices: [{ delta: { content: chunks[i] } }] },
        });
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
        await emitChunk(i + 1);
      };
      await emitChunk(0);
      return undefined as T;
    }
```

For `chat_oneshot`, the mock currently returns the legacy Anthropic shape `{content: [{type:'text', text}]}`. Update to the OpenAI shape that the new TS `chatOneshot` consumes:

```ts
    case 'chat_oneshot': {
      const script = getChatOneshotScript();
      if (script.error) {
        throw new Error(script.error);
      }
      return {
        choices: [{ message: { role: 'assistant', content: script.text ?? '' } }],
      } as T;
    }
```

### 15b — `tests/playwright/ai-chat.spec.ts`

Update the default `__SCHOLARA_CHAT_STREAM__` script and the assertion to drop the word "Anthropic":

```diff
-    (
-      window as Window & {
-        __SCHOLARA_CHAT_STREAM__?: { textChunks?: string[]; delayMs?: number };
-      }
-    ).__SCHOLARA_CHAT_STREAM__ = {
-      textChunks: ['Hello from the ', 'mocked Anthropic ', 'stream.'],
-      delayMs: 0,
-    };
+    (
+      window as Window & {
+        __SCHOLARA_CHAT_STREAM__?: { textChunks?: string[]; delayMs?: number };
+      }
+    ).__SCHOLARA_CHAT_STREAM__ = {
+      textChunks: ['Hello from the ', 'mocked OpenRouter ', 'stream.'],
+      delayMs: 0,
+    };
```

```diff
-  await expect(
-    page.getByText('Hello from the mocked Anthropic stream.'),
-  ).toBeVisible({ timeout: 5_000 });
+  await expect(
+    page.getByText('Hello from the mocked OpenRouter stream.'),
+  ).toBeVisible({ timeout: 5_000 });
```

### 15c — `tests/playwright/mocks/db.ts`

This file mocks the SQLite plugin in-browser. The legacy version stores message rows with the Anthropic-shape JSON. Read the file:

```
sed -n '1,50p' tests/playwright/mocks/db.ts
```

If the seed inserts any `messages` rows with hard-coded Anthropic content, update those literals to the new payload (`{"text":"..."}`). If the mock simply forwards INSERT statements through an in-memory SQLite, it will already accept the new format from production code paths and only the (smaller) seeded fixtures need updating.

(If unsure after reading the file, leave it alone and let the e2e run fail — the failure will pinpoint the seed line that needs fixing.)

**Verify:**

```
npx playwright test tests/playwright/ai-chat.spec.ts
```

Expected: spec passes; the streamed text appears verbatim.

**Commit:**

```
test(ai-chat): playwright mocks emit OpenAI-shape deltas
```

---

## Task 16 — Final verification, lint, and full suite

Run the complete verification from a clean state:

```
npm run lint
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npx playwright test
```

If any check fails, fix the underlying issue and add a small follow-up commit. Do **not** rebase or amend earlier commits in this branch.

Manual verification (from the spec — not automated):

1. `npm run tauri dev` → set a real OpenRouter key in Settings → start a fresh chat → confirm streaming text renders token-by-token.
2. Ask "summarize chapter 3" → confirm the `ToolUseChip` renders and a tool result is fed back to the model.
3. Clear the OpenRouter key → confirm the missing-key toast appears.
4. Switch to `anthropic/claude-haiku-4.5` in the picker → confirm a fresh chat works.
5. Reopen a thread that existed pre-migration → confirm messages render correctly and a follow-up turn can be sent.

**Commit (only if changes were necessary):**

```
chore(ai-chat): final verification across lint, vitest, cargo, playwright
```

---

## Self-Review

**Spec coverage:**

- Hard-constraint updates → Task 1 ✓
- Rust transport rewrite (URL, headers, auth, body, redaction, [DONE] handling) → Task 11 ✓
- TS types (ChatMessage, ToolCall, ToolDef, deletion of Anthropic types) → Task 4 ✓
- Streaming parser (delta.content, delta.tool_calls fragmentation, reasoning drop) → Task 5 + tests in Task 6 ✓
- Agent loop (system as message, JSON.parse arguments, role:'tool' replies) → Task 7 ✓
- Tool registry (OpenAI ToolDef shape) → Task 7 ✓
- autoTitle / profileUpdater (chatOneshot + safeText for new payload) → Task 8 ✓
- DB types + messages module (new payload, role 'tool', serialize helpers, rowToMessage) → Task 9 ✓
- Migration 0006 SQL (table rebuild, content_legacy, migrated_v6) → Task 3 ✓
- Rust backfill (per-row transform incl. split case, threads.model rewrite, idempotency) → Task 11 ✓
- Settings UI (key form swap, store rename, ModelPicker uses curated list) → Task 10 ✓
- Chat UI (useAgentSession, MessageBubble, ToolUseChip, types) → Task 9 ✓
- Curated model list (`src/agent/models.ts`) → Task 2 ✓
- Vitest updates (db/messages, agent/loop, tool-schema assertions) → Tasks 12, 13, 14 ✓
- New stream-parser tests → Task 6 ✓
- New backfill tests → Task 11 (in `migrate_v6.rs#tests`) ✓
- Cargo redaction + body-builder tests → Task 11 ✓
- Playwright mock + spec updates → Task 15 ✓

**Non-goals are honored:**
- No reasoning UI added (parser drops; bubble does not render).
- No provider abstraction layer (single hard-coded transport).
- No free-text model input (picker is curated only).
- Legacy `anthropic_api_key` keychain entry is left untouched (no Rust delete; renderer no longer reads it).
- No mid-thread model switching (no UI added).
- No 0007 migration that drops `content_legacy` (deferred, called out at end of spec).

**Placeholder scan:** none of "TBD", "implement later", "appropriate error handling", "similar to Task N", or generic "add tests" present. Every task includes literal code or literal diffs.

**Type consistency:**
- `ChatMessage`, `ToolCall`, `ToolDef` defined in Task 4; consumed verbatim in Tasks 5, 7, 8, 9, 12, 13.
- `serializeUser` / `serializeAssistant` / `serializeTool` / `rowToMessage` defined in Task 9b; used in Task 9d (useAgentSession) and Task 12 (tests) with matching signatures.
- `runTurn`'s new `onToolResults: (msgs: ChatMessage[]) => void` signature in Task 7 is matched by the consumer in Task 9d's send() and the test in Task 13.
- `messageText` is defined in Task 5 and consumed in Task 8 (autoTitle, profileUpdater) — name and signature match.
- `DEFAULT_MODEL_ID` defined in Task 2; consumed in Task 9d (useAgentSession) and Task 10e (ModelPicker) — name matches.
- Rust `backfill_messages_v6(db_path: &PathBuf)` defined in Task 11c; called in Task 11d's `.setup()` block — signature matches.
- Default model id duplicated in Rust (`migrate_v6.rs::DEFAULT`) and TS (`models.ts::DEFAULT_MODEL_ID`); a comment in `migrate_v6.rs` flags the duplication so a future change to the TS default is paired with the Rust constant.

No type/name drift detected.

---

## Plan complete and saved to `docs/superpowers/plans/2026-05-09-openrouter-switch.md`.

**Execution options:**

1. **Subagent-Driven Development** — dispatch a fresh subagent per task; main agent reviews between tasks; fast iteration.
2. **Inline / single-agent execution** — proceed task-by-task in this conversation.

Pick one to start.
