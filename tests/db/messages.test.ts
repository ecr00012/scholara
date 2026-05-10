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
    title: 'Test',
    author: null,
    file_path: '/p.epub',
    file_type: 'epub',
  });
  threadA = await insertThread(db, {
    book_id: bookId,
    model: 'deepseek/deepseek-chat-v3-0324:free',
  });
  threadB = await insertThread(db, {
    book_id: bookId,
    model: 'deepseek/deepseek-chat-v3-0324:free',
  });
});

describe('messages (OpenAI shape)', () => {
  it('user round-trip: serializeUser <-> rowToMessage', async () => {
    const id = await insertMessage(db, {
      thread_id: threadA,
      role: 'user',
      content: serializeUser('hello world'),
      position_at_send: null,
    });
    const rows = await listMessagesForThread(db, threadA);
    const row = rows.find((r) => r.id === id)!;
    expect(rowToMessage(row)).toEqual({ role: 'user', content: 'hello world' });
  });

  it('assistant with tool_calls round-trip', async () => {
    const msg = {
      role: 'assistant' as const,
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function' as const,
          function: { name: 'search_book', arguments: '{"query":"q"}' },
        },
      ],
    };
    await insertMessage(db, {
      thread_id: threadA,
      role: 'assistant',
      content: serializeAssistant(msg),
      position_at_send: null,
    });
    const [row] = await listMessagesForThread(db, threadA);
    expect(rowToMessage(row)).toEqual(msg);
  });

  it('assistant with text-only round-trip', async () => {
    const msg = { role: 'assistant' as const, content: 'just text' };
    await insertMessage(db, {
      thread_id: threadA,
      role: 'assistant',
      content: serializeAssistant(msg),
      position_at_send: null,
    });
    const [row] = await listMessagesForThread(db, threadA);
    expect(rowToMessage(row)).toEqual(msg);
  });

  it('tool role round-trip with tool_call_id', async () => {
    await insertMessage(db, {
      thread_id: threadA,
      role: 'tool',
      content: serializeTool({ role: 'tool', tool_call_id: 'call_42', content: '[]' }),
      position_at_send: null,
    });
    const [row] = await listMessagesForThread(db, threadA);
    expect(row.role).toBe('tool');
    expect(rowToMessage(row)).toEqual({
      role: 'tool',
      tool_call_id: 'call_42',
      content: '[]',
    });
  });

  it('listMessagesForThread orders by id ASC', async () => {
    const a = await insertMessage(db, {
      thread_id: threadA,
      role: 'user',
      content: serializeUser('a'),
      position_at_send: null,
    });
    const b = await insertMessage(db, {
      thread_id: threadA,
      role: 'assistant',
      content: serializeAssistant({ role: 'assistant', content: 'b' }),
      position_at_send: null,
    });
    const rows = await listMessagesForThread(db, threadA);
    expect(rows.map((r) => r.id)).toEqual([a, b]);
  });

  it("countUserMessages counts only role='user' on the given thread", async () => {
    await insertMessage(db, {
      thread_id: threadA,
      role: 'user',
      content: serializeUser('1'),
      position_at_send: null,
    });
    await insertMessage(db, {
      thread_id: threadA,
      role: 'assistant',
      content: serializeAssistant({ role: 'assistant', content: 'a' }),
      position_at_send: null,
    });
    await insertMessage(db, {
      thread_id: threadA,
      role: 'tool',
      content: serializeTool({ role: 'tool', tool_call_id: 't1', content: '[]' }),
      position_at_send: null,
    });
    await insertMessage(db, {
      thread_id: threadA,
      role: 'user',
      content: serializeUser('2'),
      position_at_send: null,
    });
    await insertMessage(db, {
      thread_id: threadB,
      role: 'user',
      content: serializeUser('3'),
      position_at_send: null,
    });
    expect(await countUserMessages(db, threadA)).toBe(2);
    expect(await countUserMessages(db, threadB)).toBe(1);
  });

  it('countUserMessagesGlobal sums user across threads, ignores tool/assistant', async () => {
    await insertMessage(db, {
      thread_id: threadA,
      role: 'user',
      content: serializeUser('1'),
      position_at_send: null,
    });
    await insertMessage(db, {
      thread_id: threadA,
      role: 'tool',
      content: serializeTool({ role: 'tool', tool_call_id: 't1', content: '[]' }),
      position_at_send: null,
    });
    await insertMessage(db, {
      thread_id: threadB,
      role: 'user',
      content: serializeUser('2'),
      position_at_send: null,
    });
    expect(await countUserMessagesGlobal(db)).toBe(2);
  });

  it('listRecentUserMessagesGlobal limits and orders DESC', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(
        await insertMessage(db, {
          thread_id: threadA,
          role: 'user',
          content: serializeUser(`m${i}`),
          position_at_send: null,
        }),
      );
    }
    const rows = await listRecentUserMessagesGlobal(db, 2);
    expect(rows.map((r) => r.id)).toEqual([ids[3], ids[2]]);
  });
});
