# Reader-Mode AI Agent — Design

**Status:** Approved 2026-05-10
**Related:** `docs/superpowers/specs/2026-05-08-ai-chat-design.md`

## Goal

Replace the "AI features arriving in Phase 3" toast in full reader display with a real AI agent backed by the same multi-thread chat infrastructure that powers the agent panel. The reader-mode UI (hovering quill button, frosted-glass input, top-30% overlay response) is preserved unchanged. Reader-mode questions persist into a real conversation thread; toggling back to agent display surfaces that same thread as the active thread in the AI Chat tab.

## Non-Goals

- New thread-management affordances in reader mode (no "new chat", no spoiler toggle, no history popover).
- Showing prior turns in the reader-mode overlay (it stays single-message, top 30%).
- Cancel button in reader mode (cancel lives in the agent panel; users can toggle modes to access it).

## Decisions (from brainstorm)

1. **Thread model:** reader mode appends to the most recent thread for the book.
2. **Idle-gap auto-new:** if the most recent thread's `last_active_at` is ≥ 24h old, open a new thread instead. Check runs only at session init (book open).
3. **Tools/RAG/system prompt:** identical to agent panel. Same `runTurn`, same tools, same system prompt, same spoiler-mode behavior (inherited from the active thread).
4. **Streaming UX:** overlay opens on submit, streams tokens live. `tool` phase shows "Searching the book…" indicator before tokens.
5. **Errors:** offline at submit toasts and returns without persisting the user message. Mid-stream failures mirror the agent panel: phase returns to idle, error set on slice, `live` message removed.
6. **Mid-turn mode toggle:** in-flight turn keeps streaming. The destination view picks up the live message and continues rendering it.
7. **State ownership:** session state moves into a Zustand slice on `useAppStore`. Both `FloatingLogoInput` (reader mode) and `AiChatRoot` (agent panel) become thin consumers.

## Architecture

### State (Zustand slice on `useAppStore`)

```ts
agentSession: {
  bookId: number | null;
  thread: ThreadRow | null;
  messages: UiMessage[];
  phase: 'idle' | 'thinking' | 'streaming' | 'tool';
  error: string | null;
}
```

Non-serializable refs (the `AbortController` for the in-flight turn) live in a module-level `Map<bookId, AbortController>` next to the slice — the Zustand state itself stays serializable.

### Actions

- `initAgentSessionForBook(bookId)` — idempotent. Picks the active thread per the idle-gap rule, loads its messages, populates state. Called from `openBook` after the existing book-load steps.
- `sendAgentMessage(text)` — the `send` body that lives in `useAgentSession` today, ported to the slice. Same persistence, same `runTurn` invocation, same auto-title and profile-updater follow-ups.
- `cancelAgentMessage()` — aborts the in-flight controller for the current book.
- `setAgentSpoiler(mode)`, `loadAgentThread(id)`, `newAgentThread()` — same behavior as today's hook.
- `clearAgentSession()` — aborts in-flight, resets the slice. Called from `closeBook`.

### Consumers

- `AiChatRoot`: stops calling `useAgentSession(book)`. Reads slice state via `useAppStore` selectors. Calls store actions for send/cancel/spoiler/loadThread/newThread. Otherwise visually identical.
- `FloatingLogoInput`: forwards submit text to `sendAgentMessage`. Submit is disabled while `phase !== 'idle'`. Offline submit toasts and returns without calling the store.
- `ReaderModeAgentOverlay` (new): mounted in `FullReaderDisplay` when `notesModeActive === false`, renders the most-recent assistant message in the top 30% with frosted-glass styling.

### Thread selection rule (idle-gap)

```
on initAgentSessionForBook(bookId):
  threads = listThreadsForBook(bookId) ordered by last_active_at DESC
  if threads is empty:
    create new thread with default model, spoiler_mode=1
    load it
  else:
    most_recent = threads[0]
    age_ms = Date.now() - new Date(most_recent.last_active_at).getTime()
    if age_ms < 24 * 60 * 60 * 1000:
      load most_recent
    else:
      create new thread
      load it
```

Once initialized, the active thread is sticky until: user picks another via `HistoryPopover`, user creates a new one via `newAgentThread`, or `closeBook` runs.

## Reader-mode overlay

`ReaderModeAgentOverlay` renders the most recent assistant message from the slice. Not mounted while `notesModeActive === true`.

**Visibility:** local `dismissed` flag, reset to `false` whenever a new user message is appended to the slice (so each new question opens the overlay fresh). Tapping the overlay sets `dismissed = true`, fading it.

**Phase rendering:**

| Phase | Render |
|---|---|
| `thinking` | "Thinking…" indicator, no text |
| `tool` | "Searching the book…" indicator |
| `streaming` | Live assistant text, streaming token-by-token |
| `idle` (post-turn) | Final assistant text until tap-to-fade |

Only the **most recent** assistant turn is shown. Prior turns are stored in the thread but invisible in reader mode — the user can toggle to agent mode to see full history.

## Cross-mode hand-off

The hand-off is automatic because both displays read the same slice. Toggling display mode unmounts one consumer and mounts the other; the in-flight `runTurn` keeps writing to the slice via the same `onTextDelta`/`onAssistantMessage`/`onToolResults` callbacks.

**Initialization order on `openBook`:**

```
openBook(id):
  set currentBookId, view='reader', clear support
  load notes/vocab in parallel
  await initAgentSessionForBook(id)
```

By the time either display mounts, the slice has its thread + messages.

**`closeBook`** calls `clearAgentSession()` which aborts the in-flight controller and resets the slice.

## Tools, RAG, system prompt

No changes. Reader-mode turns run the same `runTurn(...)` loop with the same `search_book` / `search_notes` tools. `buildSystemPrompt(...)` continues to receive book + position, current page text, recent notes/vocab, preferences, and global + per-book reader profiles. Auto-titling and profile updaters fire after each turn regardless of which display submitted it.

The active thread's `spoiler_mode` is honored. New threads default to `spoiler_mode = 1` per existing `insertThread` default.

**Index readiness:** `AiChatRoot` keeps its existing index-readiness gate (renders `IndexingProgress` until ready). Reader mode does **not** gate on this — `search_book` falls back to keyword search via the existing `toolContext` plumbing if the embedding index isn't ready. This is verified during implementation; if the assumption breaks, reader mode adds a one-time "Indexing…" toast and the same gate.

## Errors & edge cases

- **Offline at submit (reader mode):** toast "Connect to the internet to use AI features." Nothing persisted to the thread.
- **Mid-stream network failure:** phase → `idle`, `error` set on slice, `live` message removed. Reader mode shows a brief error toast; the agent panel's existing inline error banner reads from `slice.error`.
- **Concurrent submit:** `FloatingLogoInput` and `Composer` both disable sending while `phase !== 'idle'`. Reader-mode submit handler early-returns if `phase !== 'idle'`.
- **Cancel from reader mode:** not exposed. Tap-to-fade only hides the overlay. Users wanting to cancel toggle to agent mode and use its existing cancel button.
- **`newAgentThread` mid-stream:** aborts in-flight controller, creates a new thread, replaces slice messages. Reader mode's next submit lands in the new thread.

## Testing

- **Slice unit tests** (vitest, node env): idle-gap thread selection with mocked clock; `sendAgentMessage` happy path; abort; offline early return; `clearAgentSession` aborts in-flight.
- **`ReaderModeAgentOverlay` component test**: visibility per phase, dismiss-on-tap, reset on new user message.
- **Playwright e2e** (extend `tests/playwright/ai-chat.spec.ts`): submit from reader mode → overlay streams → toggle to agent mode mid-stream → AI Chat tab shows same live message continuing → final response matches in both views.

## Migration

- `useAgentSession` is removed; its body migrates into the slice. Existing tests of `useAgentSession` migrate to test the slice directly.
- `AiChatRoot` is rewritten to read the slice. No DB or schema changes.
