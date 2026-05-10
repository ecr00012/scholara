# Reader-Mode AI Agent Implementation Plan

**Goal:** Replace the reader-mode "AI features arriving in Phase 3" toast with a real AI agent backed by the same multi-thread chat infrastructure as the agent panel; lift session state into a Zustand slice so streaming hands off seamlessly across display modes.

**Architecture:** Move the body of `useAgentSession` into a new Zustand slice on `useAppStore` (`agentSession`), keyed to `currentBookId`. The slice owns thread + messages + phase + error; non-serializable abort controllers live in a sibling module-level `Map<bookId, AbortController>`. `AiChatRoot` (agent panel) and a new `ReaderModeAgentOverlay` (full reader display) are thin consumers. `openBook` calls `initAgentSessionForBook` (which applies a 24h idle-gap rule to pick or create the active thread); `closeBook` calls `clearAgentSession` which aborts the in-flight controller.

**Tech Stack:** Tauri + TypeScript + React, Zustand store, vitest (component + node env), Playwright e2e.

**Spec:** [`docs/superpowers/specs/2026-05-10-reader-mode-ai-design.md`](../specs/2026-05-10-reader-mode-ai-design.md)

---

## File Map

**New:**
- `src/agent/session/types.ts` — slice state types
- `src/agent/session/abortRegistry.ts` — module-level `Map<bookId, AbortController>`
- `src/agent/session/idleGap.ts` — pure 24h idle-gap thread-selection helper (testable)
- `src/agent/session/slice.ts` — Zustand slice creator (state + actions)
- `src/agent/session/defaultModel.ts` — extracted `readDefaultModel()` helper (was inline in `useAgentSession.ts`)
- `src/screens/Reader/ReaderModeAgentOverlay.tsx` — top-30% frosted-glass overlay
- `tests/agent/session/idleGap.test.ts` — unit tests for the idle-gap helper
- `tests/agent/session/slice.test.ts` — unit tests for the slice
- `tests/components/ReaderModeAgentOverlay.test.tsx` — component test

**Modified:**
- `src/store.ts` — extend `AppState` with `agentSession`, wire into `openBook`/`closeBook`
- `src/screens/Reader/agentPanel/chat/AiChatRoot.tsx` — consume slice instead of `useAgentSession`
- `src/screens/Reader/FloatingLogoInput.tsx` — submit via slice action
- `src/screens/Reader/FullReaderDisplay.tsx` — mount `ReaderModeAgentOverlay`
- `tests/playwright/ai-chat.spec.ts` — add reader-mode submit + mid-stream hand-off test

**Deleted:**
- `src/screens/Reader/agentPanel/chat/useAgentSession.ts` — body migrates into slice

---

## Subagent decomposition (per CLAUDE.md)

- **Foundation phase (sequential, blocks everything):** Task 1 — must complete before others start because every other task imports from `src/agent/session/`.
- **Parallel batch A (after Task 1):**
  - Task 2 — store wiring
  - Task 3 — `AiChatRoot` refactor + delete `useAgentSession`
  - Task 4 — `ReaderModeAgentOverlay` component
  - Task 6 — slice unit tests
  - Task 7 — overlay component test
- **Parallel batch B (after Tasks 2 & 4):**
  - Task 5 — `FloatingLogoInput` rewrite + `FullReaderDisplay` mount
- **Final (after batches A & B):**
  - Task 8 — Playwright e2e
  - Task 9 — full verification + commit

Per CLAUDE.md, the main agent gives each subagent the relevant task block from this plan, requires the subagent to first present a concise pre-implementation plan, reviews, then approves implementation. Each task includes acceptance checks the main agent verifies before approving the work.

---

## Task 1 — Foundation: extract default-model helper, create session module skeleton

**Why first:** every other task imports from this module. Tests and the slice itself depend on these primitives existing.

### 1a. Extract default-model helper

Create `src/agent/session/defaultModel.ts`:

```ts
import { DEFAULT_MODEL_ID, isKnownModel } from '../models';

export const DEFAULT_MODEL_KEY = 'scholara_default_model';

export function readDefaultModel(): string {
  const stored = localStorage.getItem(DEFAULT_MODEL_KEY);
  return stored && isKnownModel(stored) ? stored : DEFAULT_MODEL_ID;
}
```

### 1b. AbortController registry

Create `src/agent/session/abortRegistry.ts`:

```ts
const controllers = new Map<number, AbortController>();

export function setAbortController(bookId: number, ctrl: AbortController): void {
  controllers.get(bookId)?.abort();
  controllers.set(bookId, ctrl);
}

export function abortFor(bookId: number): void {
  const c = controllers.get(bookId);
  if (c) {
    c.abort();
    controllers.delete(bookId);
  }
}

export function clearAbortController(bookId: number): void {
  controllers.delete(bookId);
}

/** Test-only — fully resets the registry. */
export function __resetAbortRegistryForTests(): void {
  for (const c of controllers.values()) c.abort();
  controllers.clear();
}
```

### 1c. Idle-gap helper (pure)

Create `src/agent/session/idleGap.ts`:

```ts
import type { ThreadRow } from '../../db/types';

export const IDLE_GAP_MS = 24 * 60 * 60 * 1000;

/**
 * Decide which thread to use when initializing a session for a book.
 * Returns 'create-new' if the list is empty or the most recent thread is
 * older than IDLE_GAP_MS. Otherwise returns the most recent thread row.
 */
export function pickActiveThread(
  threads: ThreadRow[],
  now: number = Date.now(),
): ThreadRow | 'create-new' {
  if (threads.length === 0) return 'create-new';
  const mostRecent = threads[0];
  const lastActive = new Date(mostRecent.last_active_at).getTime();
  if (Number.isNaN(lastActive)) return 'create-new';
  return now - lastActive < IDLE_GAP_MS ? mostRecent : 'create-new';
}
```

### 1d. Slice types

Create `src/agent/session/types.ts`:

```ts
import type { ThreadRow, ThreadSpoilerMode } from '../../db/types';
import type { UiMessage, ChatPhase } from '../../screens/Reader/agentPanel/chat/types';

export type { UiMessage, ChatPhase };

export interface AgentSessionState {
  bookId: number | null;
  thread: ThreadRow | null;
  messages: UiMessage[];
  phase: ChatPhase;
  error: string | null;
}

export const EMPTY_AGENT_SESSION: AgentSessionState = {
  bookId: null,
  thread: null,
  messages: [],
  phase: 'idle',
  error: null,
};

export interface AgentSessionActions {
  initAgentSessionForBook: (bookId: number) => Promise<void>;
  clearAgentSession: () => void;
  loadAgentThread: (threadId: number) => Promise<void>;
  newAgentThread: () => Promise<void>;
  setAgentSpoiler: (mode: ThreadSpoilerMode) => Promise<void>;
  sendAgentMessage: (text: string) => Promise<void>;
  cancelAgentMessage: () => void;
}
```

### 1e. The slice

Create `src/agent/session/slice.ts`. This is largely a port of `src/screens/Reader/agentPanel/chat/useAgentSession.ts`, restructured as Zustand actions. Note the `bookId` parameter additions throughout — the slice has no `book` prop, it pulls book context from the store via the `getBookForId` getter passed in by the store wiring in Task 2.

```ts
import type { StateCreator } from 'zustand';
import type { Book, MessageRow, ThreadSpoilerMode } from '../../db/types';
import { getDb } from '../../db/client';
import * as threadsDb from '../../db/threads';
import * as messagesDb from '../../db/messages';
import {
  serializeUser,
  serializeAssistant,
  serializeTool,
  rowToMessage,
} from '../../db/messages';
import { runTurn } from '../loop';
import { maybeAutoTitle } from '../autoTitle';
import {
  maybeUpdateBookProfile,
  maybeUpdateGlobalProfile,
} from '../profileUpdater';
import { buildSystemPrompt } from '../prompts';
import { listPreferences } from '../../db/preferences';
import { getProfile, bookScopeKey } from '../../db/readerProfile';
import { deserializePosition } from '../../lib/positionShape';
import { buildToolContext } from '../../screens/Reader/agentPanel/chat/toolContext';
import type { ChatMessage } from '../types';
import type {
  AgentSessionState,
  AgentSessionActions,
  UiMessage,
} from './types';
import { EMPTY_AGENT_SESSION } from './types';
import { readDefaultModel } from './defaultModel';
import { pickActiveThread } from './idleGap';
import {
  setAbortController,
  abortFor,
  clearAbortController,
} from './abortRegistry';

const MAX_SENT_MESSAGES = 40;

function rowToUi(r: MessageRow): UiMessage {
  const m = rowToMessage(r);
  if (m.role === 'user') return { id: r.id, role: 'user', text: m.content };
  if (m.role === 'tool')
    return { id: r.id, role: 'tool', tool_call_id: m.tool_call_id, text: m.content };
  if (m.role === 'assistant') {
    return m.tool_calls && m.tool_calls.length > 0
      ? { id: r.id, role: 'assistant', text: m.content, tool_calls: m.tool_calls }
      : { id: r.id, role: 'assistant', text: m.content ?? '' };
  }
  return { id: r.id, role: 'assistant', text: '' };
}

/** Slice surface the host store must satisfy. */
export interface AgentSessionSlice {
  agentSession: AgentSessionState;
  initAgentSessionForBook: AgentSessionActions['initAgentSessionForBook'];
  clearAgentSession: AgentSessionActions['clearAgentSession'];
  loadAgentThread: AgentSessionActions['loadAgentThread'];
  newAgentThread: AgentSessionActions['newAgentThread'];
  setAgentSpoiler: AgentSessionActions['setAgentSpoiler'];
  sendAgentMessage: AgentSessionActions['sendAgentMessage'];
  cancelAgentMessage: AgentSessionActions['cancelAgentMessage'];
}

/** Adapters the slice needs from the host store. */
export interface AgentSessionSliceDeps {
  getBookById: (id: number) => Book | null;
  /** Recent notes for the active book, most-recent first. */
  getCurrentBookNotes: () => import('../../db/types').NoteRow[];
  /** Recent vocab for the active book, most-recent first. */
  getCurrentBookVocab: () => import('../../db/types').VocabRow[];
}

export const createAgentSessionSlice =
  (deps: AgentSessionSliceDeps): StateCreator<AgentSessionSlice, [], [], AgentSessionSlice> =>
  (set, get) => ({
    agentSession: EMPTY_AGENT_SESSION,

    initAgentSessionForBook: async (bookId) => {
      // Idempotent: if already initialized for this book, no-op.
      if (get().agentSession.bookId === bookId && get().agentSession.thread) return;

      const db = await getDb();
      const list = await threadsDb.listThreadsForBook(db, bookId);
      const choice = pickActiveThread(list);

      let threadId: number;
      if (choice === 'create-new') {
        threadId = await threadsDb.insertThread(db, {
          book_id: bookId,
          model: readDefaultModel(),
          spoiler_mode: 1,
        });
      } else {
        threadId = choice.id;
      }

      const thread = await threadsDb.getThread(db, threadId);
      const rows = await messagesDb.listMessagesForThread(db, threadId);
      set({
        agentSession: {
          bookId,
          thread,
          messages: rows.map(rowToUi),
          phase: 'idle',
          error: null,
        },
      });
    },

    clearAgentSession: () => {
      const { bookId } = get().agentSession;
      if (bookId !== null) abortFor(bookId);
      set({ agentSession: EMPTY_AGENT_SESSION });
    },

    loadAgentThread: async (threadId) => {
      const db = await getDb();
      const thread = await threadsDb.getThread(db, threadId);
      const rows = await messagesDb.listMessagesForThread(db, threadId);
      set((s) => ({
        agentSession: {
          ...s.agentSession,
          thread,
          messages: rows.map(rowToUi),
          phase: 'idle',
          error: null,
        },
      }));
    },

    newAgentThread: async () => {
      const { bookId } = get().agentSession;
      if (bookId === null) return;
      // Abort any in-flight turn — switching threads invalidates its target.
      abortFor(bookId);
      const db = await getDb();
      const id = await threadsDb.insertThread(db, {
        book_id: bookId,
        model: readDefaultModel(),
        spoiler_mode: 1,
      });
      await get().loadAgentThread(id);
    },

    setAgentSpoiler: async (mode: ThreadSpoilerMode) => {
      const thread = get().agentSession.thread;
      if (!thread) return;
      const db = await getDb();
      await threadsDb.setThreadSpoilerMode(db, thread.id, mode);
      set((s) => ({
        agentSession: s.agentSession.thread
          ? { ...s.agentSession, thread: { ...s.agentSession.thread, spoiler_mode: mode } }
          : s.agentSession,
      }));
    },

    sendAgentMessage: async (text) => {
      const { bookId, thread } = get().agentSession;
      if (bookId === null || !thread) return;
      const book = deps.getBookById(bookId);
      if (!book) return;

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        set((s) => ({
          agentSession: { ...s.agentSession, error: 'Connect to the internet to use AI features.' },
        }));
        return;
      }

      const ctrl = new AbortController();
      setAbortController(bookId, ctrl);

      // Optimistic user bubble + live assistant placeholder.
      set((s) => ({
        agentSession: {
          ...s.agentSession,
          phase: 'thinking',
          error: null,
          messages: [
            ...s.agentSession.messages,
            { id: -Date.now() as unknown as number, role: 'user', text },
            { id: 'live', role: 'assistant', text: '', live: true },
          ],
        },
      }));

      const db = await getDb();
      const positionJson = book.current_position;
      const position = positionJson ? deserializePosition(positionJson) : null;

      await messagesDb.insertMessage(db, {
        thread_id: thread.id,
        role: 'user',
        content: serializeUser(text),
        position_at_send: positionJson,
      });
      await threadsDb.touchThread(db, thread.id);

      const prefs = await listPreferences(db, book.id);
      const bookProfile = await getProfile(db, bookScopeKey(book.id));
      const globalProfile = await getProfile(db, 'global');
      const ctx = await buildToolContext(book, position);
      const system = buildSystemPrompt({
        book,
        position,
        positionLabel: book.current_position ?? '',
        currentPageText: ctx.currentPageText,
        spoilerMode: thread.spoiler_mode === 1,
        recentNotes: deps.getCurrentBookNotes().slice(0, 10),
        recentVocab: deps.getCurrentBookVocab().slice(0, 10),
        preferences: prefs,
        globalProfile,
        bookProfile,
      });

      const priorRows = await messagesDb.listMessagesForThread(db, thread.id);
      let prior: ChatMessage[] = priorRows.slice(0, -1).map((r) => rowToMessage(r));
      if (prior.length > MAX_SENT_MESSAGES) {
        prior = prior.slice(prior.length - MAX_SENT_MESSAGES);
      }

      try {
        await runTurn({
          model: thread.model,
          system,
          messages: prior,
          userText: text,
          toolContext: ctx.toolContext,
          signal: ctrl.signal,
          onTextDelta: (delta) => {
            set((s) => {
              const arr = s.agentSession.messages;
              const live = arr[arr.length - 1];
              if (!live || !live.live || live.role !== 'assistant') return s;
              const updated: UiMessage = { ...live, text: (live.text ?? '') + delta };
              return {
                agentSession: {
                  ...s.agentSession,
                  phase: 'streaming',
                  messages: [...arr.slice(0, -1), updated],
                },
              };
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
            set((s) => {
              const arr = s.agentSession.messages;
              const live = arr[arr.length - 1];
              const ui: UiMessage =
                msg.tool_calls && msg.tool_calls.length > 0
                  ? { id, role: 'assistant', text: msg.content, tool_calls: msg.tool_calls }
                  : { id, role: 'assistant', text: msg.content ?? '' };
              const messages = !live?.live ? [...arr, ui] : [...arr.slice(0, -1), ui];
              return { agentSession: { ...s.agentSession, messages } };
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
            set((s) => ({
              agentSession: {
                ...s.agentSession,
                phase: 'tool',
                messages: [
                  ...s.agentSession.messages,
                  ...msgs.map((m): UiMessage =>
                    m.role === 'tool'
                      ? {
                          id: -Date.now() as unknown as number,
                          role: 'tool',
                          tool_call_id: m.tool_call_id,
                          text: m.content,
                        }
                      : { id: -Date.now() as unknown as number, role: 'user', text: '' },
                  ),
                  { id: 'live', role: 'assistant', text: '', live: true },
                ],
              },
            }));
          },
        });

        set((s) => ({ agentSession: { ...s.agentSession, phase: 'idle' } }));
        clearAbortController(bookId);

        // Background: titling + profile updates.
        const assistantTurns = (
          await messagesDb.listMessagesForThread(db, thread.id)
        ).filter((m) => m.role === 'assistant').length;
        void maybeAutoTitle({
          threadId: thread.id,
          currentTitle: thread.title ?? null,
          assistantTurns,
          model: thread.model,
          recentMessages: prior.slice(-4).concat({ role: 'user', content: text }),
        });
        void maybeUpdateBookProfile({
          bookId: book.id,
          threadId: thread.id,
          model: thread.model,
        });
        void maybeUpdateGlobalProfile({ model: thread.model });

        const refreshed = await threadsDb.getThread(db, thread.id);
        set((s) => ({ agentSession: { ...s.agentSession, thread: refreshed } }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set((s) => ({
          agentSession: {
            ...s.agentSession,
            phase: 'idle',
            error: message,
            messages: s.agentSession.messages.filter((m) => !m.live),
          },
        }));
        clearAbortController(bookId);
        if (message === 'aborted') {
          await messagesDb.insertMessage(db, {
            thread_id: thread.id,
            role: 'assistant',
            content: serializeAssistant({ role: 'assistant', content: '[interrupted]' }),
            position_at_send: null,
          });
        }
      }
    },

    cancelAgentMessage: () => {
      const { bookId } = get().agentSession;
      if (bookId !== null) abortFor(bookId);
    },
  });
```

### 1f. Verify build

```sh
npm run lint
```

Expected: zero errors. The slice is not yet wired into the store, so nothing imports it. TypeScript should still pass.

### Acceptance for Task 1

- [ ] All five new files compile
- [ ] `npm run lint` is clean
- [ ] No file imports `useAgentSession` yet (we haven't deleted it)
- [ ] No production code consumes the slice yet (Task 2 wires it)

**Commit message:** `feat(agent): extract chat session into shared module`

---

## Task 2 — Wire slice into `useAppStore`

Modify `src/store.ts`.

### 2a. Imports

Add at the top of imports section:

```ts
import { createAgentSessionSlice, type AgentSessionSlice } from './agent/session/slice';
import { EMPTY_AGENT_SESSION } from './agent/session/types';
```

### 2b. Extend `AppState`

Change the `AppState` interface so it extends `AgentSessionSlice`:

```ts
interface AppState extends AgentSessionSlice {
  // ...existing fields unchanged
}
```

(Append `extends AgentSessionSlice` to the existing `interface AppState {` declaration.)

### 2c. Compose slice into `create<AppState>(...)`

Inside `create<AppState>((set, get) => ({ ... }))`, splat the slice. The slice creator needs a `set` and `get` typed for `AgentSessionSlice` — Zustand's spread idiom handles this when both share the same store:

```ts
export const useAppStore = create<AppState>((set, get) => ({
  ...createAgentSessionSlice({
    getBookById: (id) => get().books.find((b) => b.id === id) ?? null,
    getCurrentBookNotes: () => get().currentBookNotes,
    getCurrentBookVocab: () => get().currentBookVocab,
  })(set as never, get as never, undefined as never),

  // ...all existing fields and actions unchanged below
```

The `as never` casts here are required because `createAgentSessionSlice` returns a `StateCreator<AgentSessionSlice, ...>` and we're invoking it with the host store's wider `set`/`get`. This pattern is standard for Zustand slice composition; the values are runtime-compatible because `AgentSessionSlice` is a strict subset of `AppState`.

### 2d. Wire `openBook`

Inside the existing `openBook` action body, after the `await Promise.all([...])` block, add:

```ts
  openBook: async (id) => {
    set({
      currentBookId: id,
      view: 'reader',
      notesModeActive: false,
      currentBookNotes: [],
      currentBookVocab: [],
      readerNavItems: [],
      readerSearchQuery: '',
      readerSearchResults: [],
      readerSearchStatus: 'idle',
      agentSession: EMPTY_AGENT_SESSION,
    });
    const db = await getDb();
    void booksDb.setLastOpened(db, id);
    await Promise.all([
      get().reloadNotesForCurrentBook(),
      get().reloadVocabForCurrentBook(),
    ]);
    await get().initAgentSessionForBook(id);
  },
```

Note the new `agentSession: EMPTY_AGENT_SESSION` in the initial `set` — this clears any prior book's session before init runs.

### 2e. Wire `closeBook`

Replace the existing `closeBook` body:

```ts
  closeBook: () => {
    get().clearAgentSession();
    set({
      currentBookId: null,
      view: 'library',
      notesModeActive: false,
      currentBookNotes: [],
      currentBookVocab: [],
      readerNavItems: [],
      readerSearchQuery: '',
      readerSearchResults: [],
      readerSearchStatus: 'idle',
    });
  },
```

`clearAgentSession` already aborts the in-flight controller and resets `agentSession` to `EMPTY_AGENT_SESSION`; the explicit `set` above intentionally does *not* re-set `agentSession` so the slice's `set` is the single writer.

### 2f. Verify

```sh
npm run lint
npm test -- --run src/store
```

Expected: lint clean. (No store-specific tests exist today; this just ensures the type checker passes through Vitest's transformer.)

### Acceptance for Task 2

- [ ] `useAppStore` exposes `agentSession`, `initAgentSessionForBook`, `sendAgentMessage`, `cancelAgentMessage`, `clearAgentSession`, `loadAgentThread`, `newAgentThread`, `setAgentSpoiler` at runtime
- [ ] `npm run lint` clean
- [ ] `openBook` triggers `initAgentSessionForBook` once per call
- [ ] `closeBook` triggers `clearAgentSession` (manual sanity: no console errors when closing a book mid-stream during the e2e in Task 8)

**Commit message:** `feat(store): host agent-session slice on useAppStore`

---

## Task 3 — Refactor `AiChatRoot` to consume the slice; delete `useAgentSession`

### 3a. Rewrite `AiChatRoot.tsx`

Replace `src/screens/Reader/agentPanel/chat/AiChatRoot.tsx` entirely:

```tsx
import { useEffect, useState } from 'react';
import type { Book } from '../../../../db/types';
import { useAppStore } from '../../../../store';
import { IndexingProgress } from './IndexingProgress';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { SpoilerToggle } from './SpoilerToggle';
import { HistoryPopover } from './HistoryPopover';
import { EmptyState } from './EmptyState';
import { getDb } from '../../../../db/client';
import { getIndexState } from '../../../../db/bookIndexState';

interface Props {
  book: Book;
}

export function AiChatRoot({ book }: Props) {
  const session = useAppStore((s) => s.agentSession);
  const sendAgentMessage = useAppStore((s) => s.sendAgentMessage);
  const cancelAgentMessage = useAppStore((s) => s.cancelAgentMessage);
  const setAgentSpoiler = useAppStore((s) => s.setAgentSpoiler);
  const newAgentThread = useAppStore((s) => s.newAgentThread);
  const loadAgentThread = useAppStore((s) => s.loadAgentThread);

  const [indexReady, setIndexReady] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = await getDb();
      const state = await getIndexState(db, book.id);
      if (cancelled) return;
      setIndexReady(state?.status === 'ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  if (indexReady === null) return null;
  if (!indexReady) {
    return <IndexingProgress book={book} onReady={() => setIndexReady(true)} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-stone-100 px-3">
        <div className="min-w-0 truncate text-sm text-ink-muted">
          {session.thread?.title || 'New chat'}
        </div>
        <div className="flex items-center gap-1">
          <HistoryPopover
            bookId={book.id}
            activeThreadId={session.thread?.id ?? null}
            onPick={loadAgentThread}
            onNew={newAgentThread}
          />
          <SpoilerToggle
            mode={session.thread?.spoiler_mode ?? 1}
            positionLabel={book.current_position ? 'your current page' : ''}
            onChange={setAgentSpoiler}
          />
        </div>
      </div>
      {session.messages.length === 0 ? (
        <div className="flex flex-1">
          <EmptyState book={book} />
        </div>
      ) : (
        <MessageList messages={session.messages} />
      )}
      {session.error && (
        <div className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {session.error}
        </div>
      )}
      <Composer
        phase={session.phase}
        onSend={sendAgentMessage}
        onCancel={cancelAgentMessage}
      />
    </div>
  );
}
```

Key differences from before:
- No `useAgentSession(book)` call.
- The thread auto-pick `useEffect` is gone — the store's `initAgentSessionForBook` (called from `openBook`) handles that.
- Action handlers come from store selectors. Stable references because Zustand returns the same function reference across renders unless replaced.

### 3b. Delete `useAgentSession.ts`

```sh
rm src/screens/Reader/agentPanel/chat/useAgentSession.ts
```

### 3c. Verify

```sh
npm run lint
```

Expected: clean. No file should still import `useAgentSession` (we already grepped — only `AiChatRoot.tsx` referenced it). If lint flags anything, grep again:

```sh
grep -rn "useAgentSession" src tests
```

Should print nothing.

### Acceptance for Task 3

- [ ] `useAgentSession.ts` deleted
- [ ] `grep -rn "useAgentSession" src tests` returns no matches
- [ ] `npm run lint` clean
- [ ] Manual smoke (one-liner the orchestrator runs after Task 5): open a book → AI Chat tab still works, can send a message and see streaming

**Commit message:** `refactor(chat): consume agent session slice in AiChatRoot`

---

## Task 4 — Build `ReaderModeAgentOverlay`

Create `src/screens/Reader/ReaderModeAgentOverlay.tsx`:

```tsx
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { useAppStore } from '../../store';
import type { UiMessage } from '../../agent/session/types';

function lastAssistantMessage(messages: UiMessage[]): UiMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant') return m;
  }
  return null;
}

function lastUserMessageId(messages: UiMessage[]): number | string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') return m.id;
  }
  return null;
}

export function ReaderModeAgentOverlay() {
  const phase = useAppStore((s) => s.agentSession.phase);
  const messages = useAppStore((s) => s.agentSession.messages);

  const lastAssistant = lastAssistantMessage(messages);
  const userTurnId = lastUserMessageId(messages);

  // Reset dismissal each time a new user message is appended.
  const [dismissedFor, setDismissedFor] = useState<number | string | null>(null);
  useEffect(() => {
    if (userTurnId !== null && userTurnId !== dismissedFor) {
      // a new turn started — un-dismiss
      setDismissedFor(null);
    }
  }, [userTurnId, dismissedFor]);

  const isActive = phase !== 'idle';
  const dismissed = userTurnId !== null && dismissedFor === userTurnId;
  const showFinal = phase === 'idle' && lastAssistant !== null && !dismissed && userTurnId !== null;
  const visible = isActive || showFinal;

  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.button
        type="button"
        key={`overlay-${userTurnId ?? 'none'}`}
        layout
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        onClick={() => {
          if (userTurnId !== null) setDismissedFor(userTurnId);
        }}
        aria-label="Dismiss AI response"
        className="pointer-events-auto absolute inset-x-6 top-6 z-30 max-h-[30%] overflow-y-auto rounded-2xl border border-white/40 bg-white/55 p-5 text-left text-sm text-ink shadow-xl backdrop-blur-md"
      >
        {phase === 'thinking' && (
          <div className="flex items-center gap-2 text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Thinking…</span>
          </div>
        )}
        {phase === 'tool' && (
          <div className="flex items-center gap-2 text-ink-muted">
            <Search className="h-4 w-4" />
            <span>Searching the book…</span>
          </div>
        )}
        {(phase === 'streaming' || phase === 'idle') && lastAssistant && (
          <p className="whitespace-pre-wrap leading-relaxed">
            {lastAssistant.text ?? ''}
          </p>
        )}
      </motion.button>
    </AnimatePresence>
  );
}
```

### Acceptance for Task 4

- [ ] Component renders nothing when phase is `idle` and no user turn has been sent
- [ ] Component shows `Thinking…` for `thinking`, `Searching the book…` for `tool`, streaming text for `streaming`, final text for `idle` (post-turn)
- [ ] Tapping the overlay dismisses it; new user turn re-shows
- [ ] `npm run lint` clean

**Commit message:** `feat(reader): add ReaderModeAgentOverlay`

---

## Task 5 — Rewrite `FloatingLogoInput`; mount overlay in `FullReaderDisplay`

### 5a. Rewrite `FloatingLogoInput.tsx`

Replace `src/screens/Reader/FloatingLogoInput.tsx`:

```tsx
import { AnimatePresence, motion } from 'framer-motion';
import { Feather } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '../../store';

export function FloatingLogoInput() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const phase = useAppStore((s) => s.agentSession.phase);
  const sendAgentMessage = useAppStore((s) => s.sendAgentMessage);
  const inFlight = phase !== 'idle';

  function submit() {
    const trimmed = text.trim();
    setText('');
    setOpen(false);
    if (!trimmed) return;
    if (inFlight) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      toast.message('Connect to the internet to use AI features.');
      return;
    }
    void sendAgentMessage(trimmed);
  }

  return (
    <AnimatePresence mode="wait">
      {!open ? (
        <motion.button
          key="floating-logo-button"
          layoutId="floating-logo"
          type="button"
          aria-label="Ask Scholara"
          onClick={() => setOpen(true)}
          disabled={inFlight}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-amber-100 bg-cream/95 shadow-lg disabled:opacity-60"
        >
          <Feather className="h-5 w-5 text-ink" />
        </motion.button>
      ) : (
        <motion.div
          key="floating-logo-input"
          layoutId="floating-logo"
          className="flex h-14 w-[80vw] items-center rounded-full border border-white/30 bg-white/45 px-5 shadow-lg backdrop-blur-md"
        >
          <input
            autoFocus
            type="text"
            value={text}
            placeholder="Ask anything…"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                submit();
              }
              if (event.key === 'Escape') {
                setText('');
                setOpen(false);
              }
            }}
            onBlur={() => {
              setText('');
              setOpen(false);
            }}
            className="w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-muted"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

### 5b. Mount overlay in `FullReaderDisplay`

Modify `src/screens/Reader/FullReaderDisplay.tsx`. Add the import and mount the overlay alongside the existing reader leaf. The overlay only renders when `notesModeActive === false` (gated by being inside the same conditional branch as `FloatingLogoInput`):

Add to imports:

```tsx
import { ReaderModeAgentOverlay } from './ReaderModeAgentOverlay';
```

Inside the JSX, replace the existing reader-leaf block to include the overlay as a sibling:

```tsx
      <motion.div
        className="relative min-h-0 flex-1"
        variants={readerPartFade}
        transition={readerPartTransition}
      >
        <ReaderLeaf book={book} bytes={bytes} />
        {!notesModeActive && (
          <div className="pointer-events-none absolute inset-0">
            <ReaderModeAgentOverlay />
          </div>
        )}
      </motion.div>
```

The wrapper `div` has `pointer-events-none` so it doesn't intercept reader interactions; the overlay itself sets `pointer-events-auto` to remain tappable.

### 5c. Verify manually

```sh
npm run tauri dev
```

In the dev app:
1. Open an EPUB book with chat index ready.
2. Toggle to full reader display.
3. Tap the quill button, type a question, press Enter.
4. Observe the overlay opening at the top with "Thinking…" → "Searching the book…" (if tools fire) → streaming text → final answer.
5. Tap overlay to fade it.
6. Submit a second question — overlay re-opens.
7. Toggle to agent display mid-stream — same response continues streaming in the AI Chat tab.

### Acceptance for Task 5

- [ ] `npm run lint` clean
- [ ] Manual e-flow above passes
- [ ] No regression in notes mode (the orange-quill notes input still works as before)
- [ ] `disabled={inFlight}` correctly prevents double-submit while a turn is running

**Commit message:** `feat(reader): wire AI agent into full reader display`

---

## Task 6 — Slice unit tests

### 6a. Idle-gap helper test

Create `tests/agent/session/idleGap.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { pickActiveThread, IDLE_GAP_MS } from '../../../src/agent/session/idleGap';
import type { ThreadRow } from '../../../src/db/types';

function thread(overrides: Partial<ThreadRow> = {}): ThreadRow {
  return {
    id: 1,
    book_id: 1,
    title: null,
    spoiler_mode: 1,
    model: 'm',
    last_active_at: '2026-05-10 12:00:00',
    created_at: '2026-05-10 12:00:00',
    ...overrides,
  };
}

describe('pickActiveThread', () => {
  it('returns create-new when list is empty', () => {
    expect(pickActiveThread([])).toBe('create-new');
  });

  it('returns the most recent thread when within 24h', () => {
    const now = new Date('2026-05-11 11:00:00Z').getTime();
    const t = thread({ last_active_at: '2026-05-10 12:00:00' });
    // 23h gap → keep the thread.
    const result = pickActiveThread([t], now);
    expect(result).toBe(t);
  });

  it('returns create-new when most recent thread is older than 24h', () => {
    const now = new Date('2026-05-11 13:00:00Z').getTime();
    const t = thread({ last_active_at: '2026-05-10 12:00:00' });
    // 25h gap → new thread.
    expect(pickActiveThread([t], now)).toBe('create-new');
  });

  it('uses exactly the 24h boundary correctly', () => {
    const baseMs = new Date('2026-05-10 12:00:00Z').getTime();
    const t = thread({
      last_active_at: new Date(baseMs).toISOString().replace('T', ' ').slice(0, 19),
    });
    // Just under boundary → keep.
    expect(pickActiveThread([t], baseMs + IDLE_GAP_MS - 1)).toBe(t);
    // At boundary or beyond → create-new.
    expect(pickActiveThread([t], baseMs + IDLE_GAP_MS)).toBe('create-new');
  });

  it('returns create-new on unparseable timestamp', () => {
    const t = thread({ last_active_at: 'not-a-date' });
    expect(pickActiveThread([t])).toBe('create-new');
  });
});
```

### 6b. Slice integration test (happy path + abort + offline)

Create `tests/agent/session/slice.test.ts`. Reuse `tests/helpers/sqlite.ts` which already exports `makeTestDb()` (in-memory better-sqlite3 with all production migrations applied):

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { create } from 'zustand';
import {
  createAgentSessionSlice,
  type AgentSessionSlice,
} from '../../../src/agent/session/slice';
import { __resetAbortRegistryForTests } from '../../../src/agent/session/abortRegistry';
import * as dbClient from '../../../src/db/client';
import * as threadsDb from '../../../src/db/threads';
import * as messagesDb from '../../../src/db/messages';
import { makeTestDb } from '../../helpers/sqlite';
import type { Book, SqlExecutor } from '../../../src/db/types';

const FAKE_BOOK: Book = {
  id: 1,
  title: 'Test',
  author: null,
  cover_image_path: null,
  file_path: '/x.epub',
  file_type: 'epub',
  last_opened: null,
  current_position: null,
  display_mode: 'reader',
  metadata_source: 'filename',
  epub_locations: null,
  created_at: '2026-05-10 00:00:00',
};

let runTurnSpy: ReturnType<typeof vi.fn>;

vi.mock('../../../src/agent/loop', () => ({
  runTurn: vi.fn(),
}));
vi.mock('../../../src/agent/autoTitle', () => ({
  maybeAutoTitle: vi.fn(),
}));
vi.mock('../../../src/agent/profileUpdater', () => ({
  maybeUpdateBookProfile: vi.fn(),
  maybeUpdateGlobalProfile: vi.fn(),
}));
vi.mock('../../../src/screens/Reader/agentPanel/chat/toolContext', () => ({
  buildToolContext: vi.fn(async () => ({
    currentPageText: '',
    toolContext: { book: FAKE_BOOK, position: null },
  })),
}));
vi.mock('../../../src/db/preferences', () => ({ listPreferences: vi.fn(async () => []) }));
vi.mock('../../../src/db/readerProfile', () => ({
  getProfile: vi.fn(async () => null),
  bookScopeKey: (id: number) => `book:${id}`,
}));

describe('agentSession slice', () => {
  let executor: SqlExecutor;

  beforeEach(async () => {
    __resetAbortRegistryForTests();
    executor = makeTestDb();
    vi.spyOn(dbClient, 'getDb').mockResolvedValue(executor);
    const { runTurn } = await import('../../../src/agent/loop');
    runTurnSpy = runTurn as unknown as ReturnType<typeof vi.fn>;
    runTurnSpy.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeStore() {
    return create<AgentSessionSlice>()((set, get, api) =>
      createAgentSessionSlice({
        getBookById: (id) => (id === FAKE_BOOK.id ? FAKE_BOOK : null),
        getCurrentBookNotes: () => [],
        getCurrentBookVocab: () => [],
      })(set, get, api),
    );
  }

  it('initAgentSessionForBook creates a new thread when none exists', async () => {
    const store = makeStore();
    await store.getState().initAgentSessionForBook(FAKE_BOOK.id);
    const s = store.getState().agentSession;
    expect(s.bookId).toBe(FAKE_BOOK.id);
    expect(s.thread).not.toBeNull();
    expect(s.messages).toHaveLength(0);
  });

  it('initAgentSessionForBook reuses recent thread', async () => {
    // Pre-seed a recent thread.
    const id = await threadsDb.insertThread(executor, {
      book_id: FAKE_BOOK.id,
      model: 'm',
      spoiler_mode: 1,
    });
    const store = makeStore();
    await store.getState().initAgentSessionForBook(FAKE_BOOK.id);
    expect(store.getState().agentSession.thread?.id).toBe(id);
  });

  it('sendAgentMessage offline → sets error and persists nothing', async () => {
    const store = makeStore();
    await store.getState().initAgentSessionForBook(FAKE_BOOK.id);
    const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      await store.getState().sendAgentMessage('hello');
      expect(store.getState().agentSession.error).toBe(
        'Connect to the internet to use AI features.',
      );
      const threadId = store.getState().agentSession.thread!.id;
      const rows = await messagesDb.listMessagesForThread(executor, threadId);
      expect(rows).toHaveLength(0);
    } finally {
      onlineSpy.mockRestore();
    }
  });

  it('sendAgentMessage happy path streams deltas and persists', async () => {
    runTurnSpy.mockImplementation(async (args) => {
      args.onTextDelta('Hi ');
      args.onTextDelta('there.');
      await args.onAssistantMessage({ role: 'assistant', content: 'Hi there.' });
    });
    const store = makeStore();
    await store.getState().initAgentSessionForBook(FAKE_BOOK.id);
    await store.getState().sendAgentMessage('what?');
    const s = store.getState().agentSession;
    expect(s.phase).toBe('idle');
    const last = s.messages.at(-1);
    expect(last?.role).toBe('assistant');
    expect(last && 'text' in last ? last.text : '').toBe('Hi there.');
  });

  it('cancelAgentMessage aborts the in-flight controller', async () => {
    let observedSignal: AbortSignal | null = null;
    runTurnSpy.mockImplementation(async (args) => {
      observedSignal = args.signal;
      await new Promise((_, reject) => {
        args.signal.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      });
    });
    const store = makeStore();
    await store.getState().initAgentSessionForBook(FAKE_BOOK.id);
    const send = store.getState().sendAgentMessage('q');
    // Let the call reach runTurn.
    await new Promise((r) => setTimeout(r, 0));
    store.getState().cancelAgentMessage();
    await send;
    expect(observedSignal!.aborted).toBe(true);
    expect(store.getState().agentSession.phase).toBe('idle');
  });

  it('clearAgentSession aborts in-flight and resets state', async () => {
    runTurnSpy.mockImplementation(
      (args) =>
        new Promise((_, reject) => {
          args.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const store = makeStore();
    await store.getState().initAgentSessionForBook(FAKE_BOOK.id);
    void store.getState().sendAgentMessage('q');
    await new Promise((r) => setTimeout(r, 0));
    store.getState().clearAgentSession();
    expect(store.getState().agentSession.bookId).toBeNull();
    expect(store.getState().agentSession.thread).toBeNull();
  });
});
```

### 6c. Run tests

```sh
npm test -- --run tests/agent/session/
```

Expected: all 11 tests pass (5 idle-gap + 6 slice).

### Acceptance for Task 6

- [ ] `tests/agent/session/idleGap.test.ts` passes
- [ ] `tests/agent/session/slice.test.ts` passes
- [ ] No flakiness across 3 consecutive runs

**Commit message:** `test(agent): unit tests for session slice and idle-gap helper`

---

## Task 7 — `ReaderModeAgentOverlay` component test

Create `tests/components/ReaderModeAgentOverlay.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { ReaderModeAgentOverlay } from '../../src/screens/Reader/ReaderModeAgentOverlay';
import { useAppStore } from '../../src/store';
import { EMPTY_AGENT_SESSION } from '../../src/agent/session/types';
import type { UiMessage } from '../../src/agent/session/types';

function setSession(patch: Partial<typeof EMPTY_AGENT_SESSION>) {
  act(() => {
    useAppStore.setState({ agentSession: { ...EMPTY_AGENT_SESSION, ...patch } });
  });
}

const userMsg: UiMessage = { id: 100, role: 'user', text: 'q' };

describe('ReaderModeAgentOverlay', () => {
  beforeEach(() => {
    cleanup();
    act(() => {
      useAppStore.setState({ agentSession: EMPTY_AGENT_SESSION });
    });
  });

  it('renders nothing in idle with no messages', () => {
    render(<ReaderModeAgentOverlay />);
    expect(screen.queryByLabelText('Dismiss AI response')).toBeNull();
  });

  it("shows Thinking… in 'thinking' phase", () => {
    setSession({ phase: 'thinking', messages: [userMsg] });
    render(<ReaderModeAgentOverlay />);
    expect(screen.getByText('Thinking…')).toBeInTheDocument();
  });

  it("shows Searching the book… in 'tool' phase", () => {
    setSession({ phase: 'tool', messages: [userMsg] });
    render(<ReaderModeAgentOverlay />);
    expect(screen.getByText('Searching the book…')).toBeInTheDocument();
  });

  it("streams assistant text in 'streaming' phase", () => {
    setSession({
      phase: 'streaming',
      messages: [
        userMsg,
        { id: 'live', role: 'assistant', text: 'Streaming text', live: true },
      ],
    });
    render(<ReaderModeAgentOverlay />);
    expect(screen.getByText('Streaming text')).toBeInTheDocument();
  });

  it('dismisses on tap and re-shows on next user message', () => {
    setSession({
      phase: 'idle',
      messages: [userMsg, { id: 200, role: 'assistant', text: 'final' }],
    });
    render(<ReaderModeAgentOverlay />);
    const btn = screen.getByLabelText('Dismiss AI response');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    // After click the overlay is dismissed for this turn.
    expect(screen.queryByText('final')).toBeNull();

    // New user message arrives — overlay re-shows.
    setSession({
      phase: 'thinking',
      messages: [
        userMsg,
        { id: 200, role: 'assistant', text: 'final' },
        { id: 300, role: 'user', text: 'q2' },
      ],
    });
    expect(screen.getByText('Thinking…')).toBeInTheDocument();
  });
});
```

Run:

```sh
npm test -- --run tests/components/ReaderModeAgentOverlay.test.tsx
```

Expected: 5 passing tests.

### Acceptance for Task 7

- [ ] All 5 component tests pass
- [ ] Test file uses `@vitest-environment jsdom` annotation

**Commit message:** `test(reader): ReaderModeAgentOverlay component tests`

---

## Task 8 — Playwright e2e: reader-mode submit + mid-stream hand-off

Append to `tests/playwright/ai-chat.spec.ts` after the existing tests. Read the existing `beforeEach` and reuse the chat-stream mock pattern.

```ts
test('Reader mode streams AI response in overlay and hands off to agent panel', async ({ page }) => {
  // Slow the stream so we have time to toggle modes mid-stream.
  await page.addInitScript(() => {
    (
      window as Window & {
        __SCHOLARA_CHAT_STREAM__?: { textChunks?: string[]; delayMs?: number };
      }
    ).__SCHOLARA_CHAT_STREAM__ = {
      textChunks: ['Reader-mode ', 'streaming ', 'response.'],
      delayMs: 250,
    };
  });

  const seededBook = await page.evaluate(async () => {
    const book = await window.__appTestHooks.seedBook({
      title: 'Reader EPUB',
      file_path: '/mock/sample.epub',
      file_type: 'epub',
    });
    await window.__appTestHooks.seedChatIndex({
      book_id: book.id,
      chunks: ['Stub chunk one.', 'Stub chunk two.'],
    });
    return book;
  });
  expect(seededBook.id).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Open Reader EPUB' }).click();
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 10_000 });

  // Switch to full reader display.
  await page.getByRole('button', { name: 'Full reader display' }).click();

  // Open the floating logo input and submit a question.
  await page.getByRole('button', { name: 'Ask Scholara' }).click();
  const input = page.getByPlaceholder('Ask anything…');
  await input.fill('What is this about?');
  await input.press('Enter');

  // Overlay appears at top with thinking/streaming text.
  // We expect the streaming text to materialize within the overlay.
  await expect(page.getByText(/Reader-mode|Thinking…/)).toBeVisible({ timeout: 5_000 });

  // While streaming is mid-flight, toggle back to agent display.
  await page.getByRole('button', { name: 'Agent display' }).click();

  // The AI Chat tab is the default. The same response should continue
  // streaming into the message list.
  await expect(
    page.getByText('Reader-mode streaming response.'),
  ).toBeVisible({ timeout: 8_000 });

  // The user bubble for "What is this about?" is visible — proves the
  // reader-mode submission landed on the same thread the panel reads.
  await expect(page.getByText('What is this about?')).toBeVisible();
});
```

Run:

```sh
npx playwright test tests/playwright/ai-chat.spec.ts
```

Expected: all tests pass including the new one.

### Acceptance for Task 8

- [ ] New test passes 3× consecutively (no flakes)
- [ ] Existing tests in the file still pass

**Commit message:** `test(playwright): reader-mode AI hand-off across display modes`

---

## Task 9 — Final verification + manual QA

Run the full suite:

```sh
npm run lint
npm test -- --run
npx playwright test
```

Manual checks:

1. **Cold open of book with no threads:** opens a fresh thread, AI Chat tab shows empty state, reader-mode submit works.
2. **Cold open with recent thread (<24h):** that thread is active in both modes.
3. **Cold open with stale thread (>24h):** new thread created; old visible via History popover.
4. **Reader → Agent mid-stream:** answer continues in panel.
5. **Agent → Reader mid-stream:** answer continues in overlay.
6. **Notes mode toggle:** does not show the overlay; reader-mode quill input still works.
7. **Offline reader-mode submit:** toast appears; nothing persisted.
8. **`closeBook` mid-stream:** no console errors; reopening the book starts fresh.

### Acceptance for Task 9

- [ ] Lint, vitest, playwright all green
- [ ] All 8 manual checks pass

**Final commit (if not already done by individual tasks):** ensure each task's commit has shipped. No squashing.

---

## Out of scope (do not implement)

- Cancel button in reader mode (intentionally absent — users toggle to agent panel for that).
- Showing prior turns in the reader-mode overlay.
- New "kind" column on threads or any other schema change.
- Additional thread-management affordances in reader mode.
