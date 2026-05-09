// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { chatStreamMock, dispatchToolMock } = vi.hoisted(() => ({
  chatStreamMock: vi.fn(),
  dispatchToolMock: vi.fn(),
}));

vi.mock('../../src/agent/anthropic', async () => {
  const actual = await vi.importActual<typeof import('../../src/agent/anthropic')>(
    '../../src/agent/anthropic',
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

describe('runTurn', () => {
  it('stops after a single text-only response', async () => {
    chatStreamMock.mockResolvedValueOnce({
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
    });
    const onAssistant = vi.fn();
    await runTurn({
      model: 'm', system: 's', messages: [], userText: 'hi',
      toolContext: { bookId: 1, spoilerCap: { enabled: false, position: null, index: {} } },
      onTextDelta: () => {}, onAssistantMessage: onAssistant, onToolResults: () => {},
    });
    expect(chatStreamMock).toHaveBeenCalledTimes(1);
    expect(onAssistant).toHaveBeenCalledTimes(1);
  });

  it('dispatches tool calls and feeds results back', async () => {
    chatStreamMock
      .mockResolvedValueOnce({
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu1', name: 'search_book', input: { query: 'q' } },
        ],
      })
      .mockResolvedValueOnce({
        role: 'assistant',
        content: [{ type: 'text', text: 'final' }],
      });
    dispatchToolMock.mockResolvedValueOnce({ content: '[]', is_error: false });

    const onTool = vi.fn();
    await runTurn({
      model: 'm', system: 's', messages: [], userText: 'hi',
      toolContext: { bookId: 1, spoilerCap: { enabled: false, position: null, index: {} } },
      onTextDelta: () => {}, onAssistantMessage: () => {}, onToolResults: onTool,
    });
    expect(chatStreamMock).toHaveBeenCalledTimes(2);
    expect(dispatchToolMock).toHaveBeenCalledWith('search_book', { query: 'q' }, expect.anything());
    expect(onTool).toHaveBeenCalledTimes(1);
    const toolMsg = onTool.mock.calls[0][0];
    expect(toolMsg.content[0].type).toBe('tool_result');
  });
});
