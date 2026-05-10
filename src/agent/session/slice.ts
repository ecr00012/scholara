import type { StateCreator } from 'zustand';
import type {
  Book,
  MessageRow,
  NoteRow,
  ThreadSpoilerMode,
  VocabRow,
} from '../../db/types';
import { getDb } from '../../db/client';
import * as threadsDb from '../../db/threads';
import * as messagesDb from '../../db/messages';
import {
  rowToMessage,
  serializeAssistant,
  serializeTool,
  serializeUser,
} from '../../db/messages';
import { runTurn } from '../loop';
import { maybeAutoTitle } from '../autoTitle';
import {
  maybeUpdateBookProfile,
  maybeUpdateGlobalProfile,
} from '../profileUpdater';
import { buildSystemPrompt } from '../prompts';
import { listPreferences } from '../../db/preferences';
import { bookScopeKey, getProfile } from '../../db/readerProfile';
import { deserializePosition } from '../../lib/positionShape';
import { buildToolContext } from '../../screens/Reader/agentPanel/chat/toolContext';
import type { ChatMessage } from '../types';
import type {
  AgentSessionActions,
  AgentSessionState,
  UiMessage,
} from './types';
import { EMPTY_AGENT_SESSION } from './types';
import { readDefaultModel } from './defaultModel';
import { pickActiveThread } from './idleGap';
import {
  abortFor,
  clearAbortController,
  setAbortController,
} from './abortRegistry';

const MAX_SENT_MESSAGES = 40;

function rowToUi(r: MessageRow): UiMessage {
  const m = rowToMessage(r);
  if (m.role === 'user') return { id: r.id, role: 'user', text: m.content };
  if (m.role === 'tool') {
    return {
      id: r.id,
      role: 'tool',
      tool_call_id: m.tool_call_id,
      text: m.content,
    };
  }
  if (m.role === 'assistant') {
    return m.tool_calls && m.tool_calls.length > 0
      ? {
          id: r.id,
          role: 'assistant',
          text: m.content,
          tool_calls: m.tool_calls,
        }
      : { id: r.id, role: 'assistant', text: m.content ?? '' };
  }
  return { id: r.id, role: 'assistant', text: '' };
}

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

export interface AgentSessionSliceDeps {
  getBookById: (id: number) => Book | null;
  getCurrentBookNotes: () => NoteRow[];
  getCurrentBookVocab: () => VocabRow[];
}

export const createAgentSessionSlice =
  (
    deps: AgentSessionSliceDeps,
  ): StateCreator<AgentSessionSlice, [], [], AgentSessionSlice> =>
  (set, get) => ({
    agentSession: EMPTY_AGENT_SESSION,

    initAgentSessionForBook: async (bookId) => {
      if (get().agentSession.bookId === bookId && get().agentSession.thread) {
        return;
      }

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
      if (!thread) throw new Error(`Thread ${threadId} not found`);
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
      if (!thread) throw new Error(`Thread ${threadId} not found`);
      const rows = await messagesDb.listMessagesForThread(db, threadId);
      set((s) => ({
        agentSession: {
          ...s.agentSession,
          bookId: thread.book_id,
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
          ? {
              ...s.agentSession,
              thread: { ...s.agentSession.thread, spoiler_mode: mode },
            }
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
          agentSession: {
            ...s.agentSession,
            error: 'Connect to the internet to use AI features.',
          },
        }));
        return;
      }

      const ctrl = new AbortController();
      setAbortController(bookId, ctrl);

      set((s) => ({
        agentSession: {
          ...s.agentSession,
          phase: 'thinking',
          error: null,
          messages: [
            ...s.agentSession.messages,
            { id: -Date.now(), role: 'user', text },
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
      let prior: ChatMessage[] = priorRows
        .slice(0, -1)
        .map((r) => rowToMessage(r));
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
              const updated: UiMessage = {
                ...live,
                text: (live.text ?? '') + delta,
              };
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
                  ? {
                      id,
                      role: 'assistant',
                      text: msg.content,
                      tool_calls: msg.tool_calls,
                    }
                  : { id, role: 'assistant', text: msg.content ?? '' };
              const messages = !live?.live
                ? [...arr, ui]
                : [...arr.slice(0, -1), ui];
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
                          id: -Date.now(),
                          role: 'tool',
                          tool_call_id: m.tool_call_id,
                          text: m.content,
                        }
                      : { id: -Date.now(), role: 'user', text: '' },
                  ),
                  { id: 'live', role: 'assistant', text: '', live: true },
                ],
              },
            }));
          },
        });

        set((s) => ({ agentSession: { ...s.agentSession, phase: 'idle' } }));
        clearAbortController(bookId);

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
            content: serializeAssistant({
              role: 'assistant',
              content: '[interrupted]',
            }),
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
