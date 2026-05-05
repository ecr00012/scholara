// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { streamWordDefinition } from '../../src/llm/dictionary';

describe('streamWordDefinition', () => {
  it('streams tokens that concatenate to the full string in done', async () => {
    const stream = streamWordDefinition('serendipity');
    let acc = '';
    for await (const t of stream.tokens) acc += t;
    const full = await stream.done;
    expect(full).toBe(acc);
    expect(full).toContain('serendipity');
  });

  it('abort() rejects done and stops yielding', async () => {
    const stream = streamWordDefinition('any');
    setTimeout(() => stream.abort(), 5);
    let err: unknown;
    try {
      for await (const _ of stream.tokens) { /* drain */ }
      await stream.done;
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('aborted');
  });
});
