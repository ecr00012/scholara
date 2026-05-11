// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invokeMock, FakeChannel } = vi.hoisted(() => {
  class FakeChannel<T> {
    onmessage: ((msg: T) => void) | null = null;
    emit(msg: T): void { this.onmessage?.(msg); }
  }
  return { invokeMock: vi.fn(), FakeChannel };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  Channel: FakeChannel,
}));

import { chatStream } from '../../src/agent/openrouter';
import type { StreamEvent } from '../../src/agent/types';

beforeEach(() => {
  invokeMock.mockReset();
});

interface DriveOpts {
  events: Array<Omit<StreamEvent & { kind: 'event' }, 'kind'>>;
  finalKind?: 'done' | { error: string };
}

function driveInvoke(opts: DriveOpts) {
  invokeMock.mockImplementation(async (_cmd: string, args: { onEvent: FakeChannel<StreamEvent> }) => {
    for (const ev of opts.events) {
      args.onEvent.emit({ kind: 'event', event: ev.event, data: ev.data });
    }
    if (opts.finalKind === 'done' || opts.finalKind === undefined) {
      args.onEvent.emit({ kind: 'done' });
    } else {
      args.onEvent.emit({ kind: 'error', message: opts.finalKind.error });
      throw new Error(opts.finalKind.error);
    }
  });
}

describe('chatStream OpenAI-shape parser', () => {
  it('assembles text-only deltas', async () => {
    const deltas: string[] = [];
    driveInvoke({
      events: [
        { event: 'message', data: { choices: [{ delta: { content: 'Hello ' } }] } },
        { event: 'message', data: { choices: [{ delta: { content: 'world.' } }] } },
      ],
    });
    const msg = await chatStream(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      (d) => deltas.push(d),
    );
    expect(deltas).toEqual(['Hello ', 'world.']);
    expect(msg).toEqual({ role: 'assistant', content: 'Hello world.' });
  });

  it('accumulates fragmented tool_calls into a single ToolCall', async () => {
    driveInvoke({
      events: [
        // First chunk: id + name, partial args
        { event: 'message', data: { choices: [{ delta: { tool_calls: [{
          index: 0, id: 'call_1', type: 'function',
          function: { name: 'search_book', arguments: '{"que' },
        }] } }] } },
        // Second chunk: more args (no id, no name)
        { event: 'message', data: { choices: [{ delta: { tool_calls: [{
          index: 0, function: { arguments: 'ry":"hello"}' },
        }] } }] } },
      ],
    });
    const msg = await chatStream(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      () => {},
    );
    expect(msg).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_1', type: 'function',
        function: { name: 'search_book', arguments: '{"query":"hello"}' },
      }],
    });
  });

  it('silently drops reasoning_content and reasoning fields', async () => {
    driveInvoke({
      events: [
        { event: 'message', data: { choices: [{ delta: { reasoning_content: 'thinking…' } }] } },
        { event: 'message', data: { choices: [{ delta: { reasoning: 'still thinking' } }] } },
        { event: 'message', data: { choices: [{ delta: { content: 'answer' } }] } },
      ],
    });
    const msg = await chatStream(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      () => {},
    );
    expect(msg).toEqual({ role: 'assistant', content: 'answer' });
  });

  it('handles two parallel tool_calls with interleaved indices', async () => {
    driveInvoke({
      events: [
        { event: 'message', data: { choices: [{ delta: { tool_calls: [
          { index: 0, id: 'call_a', type: 'function', function: { name: 'search_book', arguments: '{}' } },
          { index: 1, id: 'call_b', type: 'function', function: { name: 'search_notes', arguments: '{}' } },
        ] } }] } },
      ],
    });
    const msg = await chatStream(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      () => {},
    );
    expect(msg.role).toBe('assistant');
    if (msg.role !== 'assistant') throw new Error('unreachable');
    expect(msg.tool_calls?.map((tc) => tc.id)).toEqual(['call_a', 'call_b']);
  });

  it('synthesizes a tool_call id when a provider omits one', async () => {
    driveInvoke({
      events: [
        { event: 'message', data: { choices: [{ delta: { tool_calls: [{
          index: 0,
          type: 'function',
          function: { name: 'search_book', arguments: '{"query":"whales"}' },
        }] } }] } },
      ],
    });
    const msg = await chatStream(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      () => {},
    );
    expect(msg).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_0',
        type: 'function',
        function: { name: 'search_book', arguments: '{"query":"whales"}' },
      }],
    });
  });

  it('accepts non-delta message tool_calls from streaming adapters', async () => {
    driveInvoke({
      events: [
        { event: 'message', data: { choices: [{ message: { tool_calls: [{
          id: 'call_final',
          type: 'function',
          function: { name: 'search_book', arguments: '{"query":"chapter"}' },
        }] } }] } },
      ],
    });
    const msg = await chatStream(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      () => {},
    );
    expect(msg).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_final',
        type: 'function',
        function: { name: 'search_book', arguments: '{"query":"chapter"}' },
      }],
    });
  });

  it('propagates an error event as a thrown error', async () => {
    driveInvoke({
      events: [
        { event: 'message', data: { choices: [{ delta: { content: 'partial' } }] } },
      ],
      finalKind: { error: 'http_429: rate limited' },
    });
    await expect(
      chatStream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }, () => {}),
    ).rejects.toThrow(/http_429/);
  });
});
