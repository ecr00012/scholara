import { chatOneshot, messageText } from './openrouter';
import type { ChatMessage } from './types';
import { updateThreadTitle } from '../db/threads';
import { getDb } from '../db/client';

export const TITLE_TRIGGER_ASSISTANT_TURNS = 2;

export async function maybeAutoTitle(args: {
  threadId: number;
  currentTitle: string | null;
  assistantTurns: number;
  recentMessages: ChatMessage[];
  model: string;
}): Promise<void> {
  if (args.currentTitle) return;
  if (args.assistantTurns < TITLE_TRIGGER_ASSISTANT_TURNS) return;
  try {
    const sys: ChatMessage = {
      role: 'system',
      content:
        'Title this short conversation in 6 words or fewer. Respond with the title only — no quotes, no period.',
    };
    const out = await chatOneshot({
      model: args.model,
      messages: [sys, ...args.recentMessages],
      max_tokens: 32,
    });
    const title = messageText(out.message).trim().replace(/^["']|["']$/g, '');
    if (!title) return;
    const db = await getDb();
    await updateThreadTitle(db, args.threadId, title.slice(0, 80));
  } catch {
    // Silent failure — title stays null and UI shows the date.
  }
}
