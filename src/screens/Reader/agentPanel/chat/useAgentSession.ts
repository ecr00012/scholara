import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book, ThreadSpoilerMode } from '../../../../db/types';
import { getDb } from '../../../../db/client';
import * as threadsDb from '../../../../db/threads';
import * as messagesDb from '../../../../db/messages';
import { runTurn } from '../../../../agent/loop';
import { maybeAutoTitle } from '../../../../agent/autoTitle';
import { maybeUpdateBookProfile, maybeUpdateGlobalProfile } from '../../../../agent/profileUpdater';
import { buildSystemPrompt } from '../../../../agent/prompts';
import { listPreferences } from '../../../../db/preferences';
import { getProfile, bookScopeKey } from '../../../../db/readerProfile';
import { useAppStore } from '../../../../store';
import type { AgentSessionState, UiMessage } from './types';
import type { ContentBlock, AnthropicMessage } from '../../../../agent/types';
import { deserializePosition } from '../../../../lib/positionShape';
import { buildToolContext } from './toolContext';

const DEFAULT_MODEL_KEY = 'scholara_default_model';
const DEFAULT_MODEL = 'claude-haiku-4-5';

function readDefaultModel(): string {
  return localStorage.getItem(DEFAULT_MODEL_KEY) || DEFAULT_MODEL;
}

export function useAgentSession(book: Book) {
  const [state, setState] = useState<AgentSessionState>({
    thread: null, messages: [], phase: 'idle', error: null,
  });
  const abortRef = useRef<AbortController | null>(null);
  const notes = useAppStore((s) => s.currentBookNotes);
  const vocab = useAppStore((s) => s.currentBookVocab);

  const loadThread = useCallback(async (threadId: number) => {
    const db = await getDb();
    const thread = await threadsDb.getThread(db, threadId);
    const rows = await messagesDb.listMessagesForThread(db, threadId);
    const messages: UiMessage[] = rows.map((r) => ({
      id: r.id, role: r.role, content: JSON.parse(r.content) as ContentBlock[],
    }));
    setState({ thread, messages, phase: 'idle', error: null });
  }, []);

  const newThread = useCallback(async () => {
    const db = await getDb();
    const id = await threadsDb.insertThread(db, { book_id: book.id, model: readDefaultModel(), spoiler_mode: 1 });
    await loadThread(id);
  }, [book.id, loadThread]);

  // Auto-pick: most recent thread, else create one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = await getDb();
      const list = await threadsDb.listThreadsForBook(db, book.id);
      if (cancelled) return;
      if (list.length > 0) await loadThread(list[0].id);
      else await newThread();
    })();
    return () => { cancelled = true; };
  }, [book.id, loadThread, newThread]);

  const setSpoiler = useCallback(async (mode: ThreadSpoilerMode) => {
    if (!state.thread) return;
    const db = await getDb();
    await threadsDb.setThreadSpoilerMode(db, state.thread.id, mode);
    setState((s) => (s.thread ? { ...s, thread: { ...s.thread, spoiler_mode: mode } } : s));
  }, [state.thread]);

  const send = useCallback(async (text: string) => {
    if (!state.thread) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setState((s) => ({ ...s, error: 'Connect to the internet to use AI features.' }));
      return;
    }
    const thread = state.thread;
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Optimistic user bubble.
    const userBlocks: ContentBlock[] = [{ type: 'text', text }];
    setState((s) => ({
      ...s,
      phase: 'thinking',
      error: null,
      messages: [
        ...s.messages,
        { id: -Date.now() as unknown as number, role: 'user', content: userBlocks },
        { id: 'live', role: 'assistant', content: [{ type: 'text', text: '' }], live: true },
      ],
    }));

    const db = await getDb();
    const positionJson = book.current_position;
    const position = positionJson ? deserializePosition(positionJson) : null;

    // Persist user message first.
    await messagesDb.insertMessage(db, {
      thread_id: thread.id,
      role: 'user',
      content: JSON.stringify(userBlocks),
      position_at_send: positionJson,
    });
    await threadsDb.touchThread(db, thread.id);

    // System prompt.
    const prefs = await listPreferences(db, book.id);
    const bookProfile = await getProfile(db, bookScopeKey(book.id));
    const globalProfile = await getProfile(db, 'global');
    const ctx = await buildToolContext(book, position);
    const system = buildSystemPrompt({
      book, position,
      positionLabel: book.current_position ?? '',
      currentPageText: ctx.currentPageText,
      spoilerMode: thread.spoiler_mode === 1,
      recentNotes: notes.slice(0, 10),
      recentVocab: vocab.slice(0, 10),
      preferences: prefs,
      globalProfile, bookProfile,
    });

    const priorRows = await messagesDb.listMessagesForThread(db, thread.id);
    // Drop the just-inserted user message (we re-add it below) and convert.
    let prior: AnthropicMessage[] = priorRows
      .slice(0, -1)
      .map((r) => ({ role: r.role, content: JSON.parse(r.content) as ContentBlock[] }));
    // Spec §3.6: if persisted history exceeds 20 turns (40 messages), drop oldest
    // user/assistant pairs from what's *sent*. DB keeps everything.
    const MAX_SENT_MESSAGES = 40;
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
          setState((s) => {
            const live = s.messages[s.messages.length - 1];
            if (!live || !live.live) return s;
            const block = live.content[0];
            if (block?.type !== 'text') return s;
            const updated: UiMessage = { ...live, content: [{ type: 'text', text: block.text + delta }] };
            return { ...s, phase: 'streaming', messages: [...s.messages.slice(0, -1), updated] };
          });
        },
        onAssistantMessage: async (msg) => {
          const id = await messagesDb.insertMessage(db, {
            thread_id: thread.id, role: 'assistant',
            content: JSON.stringify(msg.content), position_at_send: null,
          });
          setState((s) => {
            const live = s.messages[s.messages.length - 1];
            if (!live?.live) {
              return { ...s, messages: [...s.messages, { id, role: 'assistant', content: msg.content }] };
            }
            return {
              ...s,
              messages: [...s.messages.slice(0, -1), { id, role: 'assistant', content: msg.content }],
            };
          });
        },
        onToolResults: async (msg) => {
          await messagesDb.insertMessage(db, {
            thread_id: thread.id, role: 'user',
            content: JSON.stringify(msg.content), position_at_send: null,
          });
          setState((s) => ({
            ...s,
            phase: 'tool',
            messages: [...s.messages, { id: -Date.now() as unknown as number, role: 'user', content: msg.content }, { id: 'live', role: 'assistant', content: [{ type: 'text', text: '' }], live: true }],
          }));
        },
      });

      setState((s) => ({ ...s, phase: 'idle' }));

      // Background: titling + profile updates (do not await).
      const assistantTurns = (await messagesDb.listMessagesForThread(db, thread.id))
        .filter((m) => m.role === 'assistant').length;
      void maybeAutoTitle({
        threadId: thread.id, currentTitle: state.thread?.title ?? null,
        assistantTurns, model: thread.model,
        recentMessages: prior.slice(-4).concat({
          role: 'user', content: [{ type: 'text', text }],
        }),
      });
      void maybeUpdateBookProfile({ bookId: book.id, threadId: thread.id, model: thread.model });
      void maybeUpdateGlobalProfile({ model: thread.model });

      // Refresh thread row in case title changed.
      const refreshed = await threadsDb.getThread(db, thread.id);
      setState((s) => ({ ...s, thread: refreshed }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({
        ...s,
        phase: 'idle',
        error: message,
        messages: s.messages.filter((m) => !m.live),
      }));
      // Persist an interrupted marker on the assistant side.
      if (message === 'aborted') {
        await messagesDb.insertMessage(db, {
          thread_id: thread.id, role: 'assistant',
          content: JSON.stringify([{ type: 'text', text: '[interrupted]' }]),
          position_at_send: null,
        });
      }
    }
  }, [state.thread, book, notes, vocab]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { state, send, cancel, setSpoiler, newThread, loadThread };
}
