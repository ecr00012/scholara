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
