// src/agent/tokenBudget.ts

const CHARS_PER_TOKEN = 4;

export function approxTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Truncate to ≤ tokenLimit by trimming from the end. Adds an ellipsis if truncated. */
export function truncateToTokens(text: string, tokenLimit: number): string {
  const charLimit = tokenLimit * CHARS_PER_TOKEN;
  if (text.length <= charLimit) return text;
  return text.slice(0, charLimit - 1).trimEnd() + '…';
}

/** Truncate a list to ≤ tokenLimit total, dropping from the end (oldest if reversed). */
export function truncateListToTokens<T>(
  items: T[],
  toText: (t: T) => string,
  tokenLimit: number,
): T[] {
  const out: T[] = [];
  let used = 0;
  for (const item of items) {
    const t = approxTokens(toText(item));
    if (used + t > tokenLimit) break;
    out.push(item);
    used += t;
  }
  return out;
}
