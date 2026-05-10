// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { makeTestDb } from '../../helpers/sqlite';
import * as booksDb from '../../../src/db/books';
import * as threadsDb from '../../../src/db/threads';
import * as messagesDb from '../../../src/db/messages';
import type { Book, SqlExecutor } from '../../../src/db/types';
import type { ChatMessage } from '../../../src/agent/types';

const {
  getDbMock,
  readDefaultModelMock,
  runTurnMock,
  maybeAutoTitleMock,
  maybeUpdateBookProfileMock,
  maybeUpdateGlobalProfileMock,
  listPreferencesMock,
  bookScopeKeyMock,
  getProfileMock,
  buildToolContextMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  readDefaultModelMock: vi.fn(),
  runTurnMock: vi.fn(),
  maybeAutoTitleMock: vi.fn(),
  maybeUpdateBookProfileMock: vi.fn(),
  maybeUpdateGlobalProfileMock: vi.fn(),
  listPreferencesMock: vi.fn(),
  bookScopeKeyMock: vi.fn(),
  getProfileMock: vi.fn(),
  buildToolContextMock: vi.fn(),
}));

vi.mock('../../../src/db/client', () => ({
  getDb: getDbMock,
}));

vi.mock('../../../src/agent/session/defaultModel', () => ({
  readDefaultModel: readDefaultModelMock,
}));

vi.mock('../../../src/agent/loop', () => ({
  runTurn: runTurnMock,
}));

vi.mock('../../../src/agent/autoTitle', () => ({
  maybeAutoTitle: maybeAutoTitleMock,
}));

vi.mock('../../../src/agent/profileUpdater', () => ({
  maybeUpdateBookProfile: maybeUpdateBookProfileMock,
  maybeUpdateGlobalProfile: maybeUpdateGlobalProfileMock,
}));

vi.mock('../../../src/db/preferences', () => ({
  listPreferences: listPreferencesMock,
}));

vi.mock('../../../src/db/readerProfile', () => ({
  bookScopeKey: bookScopeKeyMock,
  getProfile: getProfileMock,
}));

vi.mock('../../../src/screens/Reader/agentPanel/chat/toolContext', () => ({
  buildToolContext: buildToolContextMock,
}));

import {
  createAgentSessionSlice,
  type AgentSessionSlice,
} from '../../../src/agent/session/slice';

type TestStore = AgentSessionSlice;

let db: SqlExecutor;
let books: Book[];
let book: Book;

async function seedBook(input: Partial<booksDb.InsertBookInput> = {}) {
  const id = await booksDb.insertBook(db, {
    title: 'The Test Book',
    author: 'A. Reader',
    file_path: `/tmp/book-${Math.random()}.epub`,
    file_type: 'epub',
    ...input,
  });
  const rows = await booksDb.listBooks(db);
  const seeded = rows.find((row) => row.id === id);
  if (!seeded) throw new Error('seeded book not found');
  books = rows;
  return seeded;
}

function createSessionStore() {
  return createStore<TestStore>()((set, get, api) =>
    createAgentSessionSlice<TestStore>({
      getBookById: (id) => books.find((candidate) => candidate.id === id) ?? null,
      getCurrentBookNotes: () => [],
      getCurrentBookVocab: () => [],
    })(set, get, api),
  );
}

async function messagesFor(threadId: number) {
  return (await messagesDb.listMessagesForThread(db, threadId)).map((row) =>
    messagesDb.rowToMessage(row),
  );
}

beforeEach(async () => {
  vi.useRealTimers();
  vi.resetAllMocks();
  db = makeTestDb();
  books = [];
  book = await seedBook();

  getDbMock.mockResolvedValue(db);
  readDefaultModelMock.mockReturnValue('test-default-model');
  runTurnMock.mockImplementation(async ({ onAssistantMessage }) => {
    await onAssistantMessage({ role: 'assistant', content: 'hello back' });
  });
  maybeAutoTitleMock.mockResolvedValue(undefined);
  maybeUpdateBookProfileMock.mockResolvedValue(undefined);
  maybeUpdateGlobalProfileMock.mockResolvedValue(undefined);
  listPreferencesMock.mockResolvedValue([]);
  bookScopeKeyMock.mockImplementation((bookId: number) => `book:${bookId}`);
  getProfileMock.mockResolvedValue(null);
  buildToolContextMock.mockResolvedValue({
    currentPageText: 'Current page text',
    toolContext: {
      bookId: book.id,
      spoilerCap: { enabled: true, position: null, index: {} },
    },
  });

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true },
  });
});

describe('createAgentSessionSlice', () => {
  it('initializes a new thread for a seeded book', async () => {
    const store = createSessionStore();

    await store.getState().initAgentSessionForBook(book.id);

    const session = store.getState().agentSession;
    expect(session.bookId).toBe(book.id);
    expect(session.thread?.book_id).toBe(book.id);
    expect(session.thread?.model).toBe('test-default-model');
    expect(session.thread?.spoiler_mode).toBe(1);
    expect(session.messages).toEqual([]);
    expect(session.phase).toBe('idle');
    expect(readDefaultModelMock).toHaveBeenCalledTimes(1);
  });

  it('reuses an active thread and loads existing messages', async () => {
    const threadId = await threadsDb.insertThread(db, {
      book_id: book.id,
      model: 'existing-model',
    });
    await db.execute(`UPDATE threads SET last_active_at = ? WHERE id = ?`, [
      new Date().toISOString(),
      threadId,
    ]);
    await messagesDb.insertMessage(db, {
      thread_id: threadId,
      role: 'user',
      content: messagesDb.serializeUser('prior question'),
      position_at_send: null,
    });
    const store = createSessionStore();

    await store.getState().initAgentSessionForBook(book.id);

    const session = store.getState().agentSession;
    expect(session.thread?.id).toBe(threadId);
    expect(session.messages).toEqual([
      { id: expect.any(Number), role: 'user', text: 'prior question' },
    ]);
    expect(readDefaultModelMock).not.toHaveBeenCalled();
  });

  it('does not call the model when offline and keeps the draft out of the DB', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: false },
    });
    const store = createSessionStore();
    await store.getState().initAgentSessionForBook(book.id);
    const threadId = store.getState().agentSession.thread?.id;
    if (!threadId) throw new Error('missing thread');

    await store.getState().sendAgentMessage('hello?');

    expect(store.getState().agentSession.error).toBe(
      'Connect to the internet to use AI features.',
    );
    expect(runTurnMock).not.toHaveBeenCalled();
    expect(await messagesFor(threadId)).toEqual([]);
  });

  it('sends a message, streams updates, persists the assistant reply, and fires side effects', async () => {
    runTurnMock.mockImplementationOnce(
      async ({ onTextDelta, onToolResults, onAssistantMessage }) => {
        onTextDelta('hel');
        onTextDelta('lo');
        await onToolResults([
          {
            role: 'tool',
            tool_call_id: 'call_1',
            content: '[{"quote":"x"}]',
          },
        ]);
        await onAssistantMessage({
          role: 'assistant',
          content: 'final answer',
        });
      },
    );
    const store = createSessionStore();
    await store.getState().initAgentSessionForBook(book.id);
    const threadId = store.getState().agentSession.thread?.id;
    if (!threadId) throw new Error('missing thread');

    await store.getState().sendAgentMessage('tell me something');

    expect(runTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-default-model',
        system: expect.stringContaining('The Test Book'),
        messages: [],
        userText: 'tell me something',
        toolContext: expect.objectContaining({ bookId: book.id }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(store.getState().agentSession).toMatchObject({
      bookId: book.id,
      phase: 'idle',
      error: null,
    });
    expect(store.getState().agentSession.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(await messagesFor(threadId)).toEqual([
      { role: 'user', content: 'tell me something' },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: '[{"quote":"x"}]',
      },
      { role: 'assistant', content: 'final answer' },
    ] satisfies ChatMessage[]);
    expect(maybeAutoTitleMock).toHaveBeenCalledTimes(1);
    expect(maybeUpdateBookProfileMock).toHaveBeenCalledWith({
      bookId: book.id,
      threadId,
      model: 'test-default-model',
    });
    expect(maybeUpdateGlobalProfileMock).toHaveBeenCalledWith({
      model: 'test-default-model',
    });
  });

  it('aborts an in-flight send and records an interrupted assistant turn', async () => {
    runTurnMock.mockImplementationOnce(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const rejectAborted = () => reject(new Error('aborted'));
          if (signal.aborted) {
            rejectAborted();
            return;
          }
          signal.addEventListener('abort', rejectAborted);
        }),
    );
    const store = createSessionStore();
    await store.getState().initAgentSessionForBook(book.id);
    const threadId = store.getState().agentSession.thread?.id;
    if (!threadId) throw new Error('missing thread');

    const sending = store.getState().sendAgentMessage('wait');
    store.getState().cancelAgentMessage();
    await sending;

    expect(store.getState().agentSession.phase).toBe('idle');
    expect(store.getState().agentSession.error).toBe('aborted');
    expect(store.getState().agentSession.messages.some((m) => m.live)).toBe(false);
    expect(await messagesFor(threadId)).toEqual([
      { role: 'user', content: 'wait' },
      { role: 'assistant', content: '[interrupted]' },
    ] satisfies ChatMessage[]);
  });

  it('clears the active session', async () => {
    const store = createSessionStore();
    await store.getState().initAgentSessionForBook(book.id);

    store.getState().clearAgentSession();

    expect(store.getState().agentSession).toEqual({
      bookId: null,
      thread: null,
      messages: [],
      phase: 'idle',
      error: null,
    });
  });
});
