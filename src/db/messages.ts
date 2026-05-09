import type { MessageRole, MessageRow, SqlExecutor } from './types';

export type { MessageRow };

export interface InsertMessageInput {
  thread_id: number;
  role: MessageRole;
  /** JSON-encoded Anthropic content blocks array. */
  content: string;
  position_at_send: string | null;
}

export async function insertMessage(
  db: SqlExecutor,
  input: InsertMessageInput,
): Promise<number> {
  const { lastInsertId } = await db.execute(
    `INSERT INTO messages (thread_id, role, content, position_at_send)
     VALUES (?, ?, ?, ?)`,
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

export async function countUserMessagesGlobal(
  db: SqlExecutor,
): Promise<number> {
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
