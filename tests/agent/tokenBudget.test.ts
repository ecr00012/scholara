// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { approxTokens, truncateToTokens, truncateListToTokens } from '../../src/agent/tokenBudget';

describe('tokenBudget', () => {
  it('approxTokens grows roughly 1 token per 4 chars', () => {
    expect(approxTokens('')).toBe(0);
    expect(approxTokens('1234')).toBe(1);
    expect(approxTokens('12345')).toBe(2);
  });
  it('truncateToTokens caps long strings with ellipsis', () => {
    const out = truncateToTokens('a'.repeat(100), 5);
    expect(out.length).toBe(20);
    expect(out.endsWith('…')).toBe(true);
  });
  it('truncateListToTokens drops the tail past the budget', () => {
    const items = ['aaaa', 'bbbb', 'cccc', 'dddd'];
    const out = truncateListToTokens(items, (s) => s, 2);
    expect(out).toEqual(['aaaa', 'bbbb']);
  });
});
