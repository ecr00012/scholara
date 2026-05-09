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
  threadA = await insertThread(db, { book_id: bookId, model: 'haiku' });
  threadB = await insertThread(db, { book_id: bookId, model: 'haiku' });
});

describe('messages', () => {
  it('insertMessage + listMessagesForThread orders by id ASC', async () => {
    const a = await insertMessage(db, {
      thread_id: threadA,
      role: 'user',
      content: '[]',
      position_at_send: null,
    });
    const b = await insertMessage(db, {
      thread_id: threadA,
      role: 'assistant',
      content: '[]',
      position_at_send: null,
    });
    const rows = await listMessagesForThread(db, threadA);
    expect(rows.map((r) => r.id)).toEqual([a, b]);
  });

  it('countUserMessages counts only user role for the given thread', async () => {
    await insertMessage(db, {
      thread_id: threadA,
      role: 'user',
      content: '[]',
      position_at_send: null,
    });
    await insertMessage(db, {
      thread_id: threadA,
      role: 'assistant',
      content: '[]',
      position_at_send: null,
    });
    await insertMessage(db, {
      thread_id: threadA,
      role: 'user',
      content: '[]',
      position_at_send: null,
    });
    await insertMessage(db, {
      thread_id: threadB,
      role: 'user',
      content: '[]',
      position_at_send: null,
    });
    expect(await countUserMessages(db, threadA)).toBe(2);
    expect(await countUserMessages(db, threadB)).toBe(1);
  });

  it('countUserMessagesGlobal sums user messages across threads', async () => {
    await insertMessage(db, {
      thread_id: threadA,
      role: 'user',
      content: '[]',
      position_at_send: null,
    });
    await insertMessage(db, {
      thread_id: threadA,
      role: 'assistant',
      content: '[]',
      position_at_send: null,
    });
    await insertMessage(db, {
      thread_id: threadB,
      role: 'user',
      content: '[]',
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
          content: `[${i}]`,
          position_at_send: null,
        }),
      );
    }
    await insertMessage(db, {
      thread_id: threadA,
      role: 'assistant',
      content: '[]',
      position_at_send: null,
    });
    const rows = await listRecentUserMessagesGlobal(db, 2);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toEqual([ids[3], ids[2]]);
  });
});
