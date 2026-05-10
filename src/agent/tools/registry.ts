import type { ToolDef } from '../types';
import { searchBook, type SearchBookParams } from './searchBook';
import { searchNotes } from './searchNotes';
import type { Position } from '../../lib/positionShape';
import type { ChunkOrdinalIndex } from '../spoilerGuard';

export const TOOL_DEFS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'search_book',
      description:
        'Retrieve the most relevant passages from the book. Use this before quoting or asserting specific facts about the text.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A natural-language search query.' },
          k: { type: 'integer', description: 'Number of passages, default 6.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_notes',
      description:
        "Retrieve the user's relevant notes, saved quotes, and dictionary definitions for this book.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A natural-language search query.' },
          k: { type: 'integer', description: 'Number of items, default 6.' },
        },
        required: ['query'],
      },
    },
  },
];

export interface ToolContext {
  bookId: number;
  spoilerCap: { enabled: boolean; position: Position | null; index: ChunkOrdinalIndex };
}

export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ content: string; is_error: boolean }> {
  try {
    if (name === 'search_book') {
      const results = await searchBook({
        bookId: ctx.bookId,
        query: String(input.query ?? ''),
        k: typeof input.k === 'number' ? input.k : undefined,
        spoilerCap: ctx.spoilerCap,
      } satisfies SearchBookParams);
      return { content: JSON.stringify(results), is_error: false };
    }
    if (name === 'search_notes') {
      const results = await searchNotes({
        bookId: ctx.bookId,
        query: String(input.query ?? ''),
        k: typeof input.k === 'number' ? input.k : undefined,
      });
      return { content: JSON.stringify(results), is_error: false };
    }
    return { content: `unknown tool: ${name}`, is_error: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `tool_error: ${message}`, is_error: true };
  }
}
