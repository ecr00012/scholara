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
