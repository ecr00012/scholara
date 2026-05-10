// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { chatStreamMock, dispatchToolMock } = vi.hoisted(() => ({
  chatStreamMock: vi.fn(),
  dispatchToolMock: vi.fn(),
}));

vi.mock('../../src/agent/openrouter', async () => {
  const actual = await vi.importActual<typeof import('../../src/agent/openrouter')>(
    '../../src/agent/openrouter',
  );
  return { ...actual, chatStream: chatStreamMock };
});

vi.mock('../../src/agent/tools/registry', () => ({
  TOOL_DEFS: [],
  dispatchTool: dispatchToolMock,
}));

import { runTurn } from '../../src/agent/loop';

beforeEach(() => {
  chatStreamMock.mockReset();
  dispatchToolMock.mockReset();
});

describe('runTurn (OpenAI shape)', () => {
  it('stops after a single text-only response', async () => {
    chatStreamMock.mockResolvedValueOnce({ role: 'assistant', content: 'hello' });
    const onAssistant = vi.fn();
    await runTurn({
      model: 'm',
      system: 's',
      messages: [],
      userText: 'hi',
      toolContext: { bookId: 1, spoilerCap: { enabled: false, position: null, index: {} } },
      onTextDelta: () => {},
      onAssistantMessage: onAssistant,
      onToolResults: () => {},
    });
    expect(chatStreamMock).toHaveBeenCalledTimes(1);
    expect(onAssistant).toHaveBeenCalledTimes(1);
  });

  it('dispatches tool_calls and feeds back role:tool messages', async () => {
    chatStreamMock
      .mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'search_book', arguments: '{"query":"q"}' },
          },
        ],
      })
      .mockResolvedValueOnce({ role: 'assistant', content: 'final' });
    dispatchToolMock.mockResolvedValueOnce({ content: '[]', is_error: false });

    const onTool = vi.fn();
    await runTurn({
      model: 'm',
      system: 's',
      messages: [],
      userText: 'hi',
      toolContext: { bookId: 1, spoilerCap: { enabled: false, position: null, index: {} } },
      onTextDelta: () => {},
      onAssistantMessage: () => {},
      onToolResults: onTool,
    });
    expect(chatStreamMock).toHaveBeenCalledTimes(2);
    expect(dispatchToolMock).toHaveBeenCalledWith(
      'search_book',
      { query: 'q' },
      expect.anything(),
    );
    expect(onTool).toHaveBeenCalledTimes(1);
    const toolMsgs = onTool.mock.calls[0][0];
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: '[]',
    });
  });

  it('prepends a system message and the new user turn into the conversation sent to chatStream', async () => {
    chatStreamMock.mockResolvedValueOnce({ role: 'assistant', content: 'ok' });
    await runTurn({
      model: 'm',
      system: 'SYS',
      messages: [{ role: 'user', content: 'prior' }],
      userText: 'now',
      toolContext: { bookId: 1, spoilerCap: { enabled: false, position: null, index: {} } },
      onTextDelta: () => {},
      onAssistantMessage: () => {},
      onToolResults: () => {},
    });
    const reqArg = chatStreamMock.mock.calls[0][0];
    expect(reqArg.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(reqArg.messages[1]).toEqual({ role: 'user', content: 'prior' });
    expect(reqArg.messages[2]).toEqual({ role: 'user', content: 'now' });
  });

  it('forwards dispatchTool content verbatim without re-prefixing tool_error', async () => {
    // dispatchTool already prefixes its own error string with `tool_error:`;
    // the loop must not double-prefix.
    chatStreamMock
      .mockResolvedValueOnce({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'c',
            type: 'function',
            function: { name: 'search_book', arguments: '{}' },
          },
        ],
      })
      .mockResolvedValueOnce({ role: 'assistant', content: 'done' });
    dispatchToolMock.mockResolvedValueOnce({
      content: 'tool_error: whoops',
      is_error: true,
    });

    const onTool = vi.fn();
    await runTurn({
      model: 'm',
      system: 's',
      messages: [],
      userText: 'hi',
      toolContext: { bookId: 1, spoilerCap: { enabled: false, position: null, index: {} } },
      onTextDelta: () => {},
      onAssistantMessage: () => {},
      onToolResults: onTool,
    });
    expect(onTool.mock.calls[0][0][0].content).toBe('tool_error: whoops');
  });
});
