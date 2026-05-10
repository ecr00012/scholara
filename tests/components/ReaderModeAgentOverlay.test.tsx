// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderModeAgentOverlay } from '../../src/screens/Reader/ReaderModeAgentOverlay';
import { useAppStore } from '../../src/store';
import { EMPTY_AGENT_SESSION } from '../../src/agent/session/types';
import type {
  AgentSessionState,
  UiMessage,
} from '../../src/agent/session/types';

vi.mock('framer-motion', () => {
  const passthrough = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
    ({ children, ...props }, ref) =>
      React.createElement('div', { ...props, ref }, children),
  );

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    motion: new Proxy(
      {},
      {
        get:
          (_target, tag: string) =>
          ({
            children,
            layout,
            initial,
            animate,
            exit,
            transition,
            ...props
          }: React.HTMLAttributes<HTMLElement> & {
            children?: React.ReactNode;
            layout?: unknown;
            initial?: unknown;
            animate?: unknown;
            exit?: unknown;
            transition?: unknown;
          }) => {
            void layout;
            void initial;
            void animate;
            void exit;
            void transition;
            return React.createElement(tag, props, children);
          },
      },
    ),
    passthrough,
  };
});

function setSession(patch: Partial<AgentSessionState>) {
  act(() => {
    useAppStore.setState({
      agentSession: { ...EMPTY_AGENT_SESSION, ...patch },
    });
  });
}

const userMsg: UiMessage = { id: 100, role: 'user', text: 'q' };

describe('ReaderModeAgentOverlay', () => {
  beforeEach(() => {
    cleanup();
    act(() => {
      useAppStore.setState({ agentSession: EMPTY_AGENT_SESSION });
    });
  });

  it('renders nothing in idle with no messages', () => {
    render(<ReaderModeAgentOverlay />);

    expect(screen.queryByLabelText('Dismiss AI response')).toBeNull();
  });

  it("shows Thinking... in 'thinking' phase", () => {
    setSession({ phase: 'thinking', messages: [userMsg] });

    render(<ReaderModeAgentOverlay />);

    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  it("shows Searching the book... in 'tool' phase", () => {
    setSession({ phase: 'tool', messages: [userMsg] });

    render(<ReaderModeAgentOverlay />);

    expect(screen.getByText('Searching the book...')).toBeInTheDocument();
  });

  it("streams assistant text in 'streaming' phase", () => {
    setSession({
      phase: 'streaming',
      messages: [
        userMsg,
        { id: 'live', role: 'assistant', text: 'Streaming text', live: true },
      ],
    });

    render(<ReaderModeAgentOverlay />);

    expect(screen.getByText('Streaming text')).toBeInTheDocument();
  });

  it('dismisses on tap and re-shows on next user message', () => {
    setSession({
      phase: 'idle',
      messages: [userMsg, { id: 200, role: 'assistant', text: 'final' }],
    });
    render(<ReaderModeAgentOverlay />);

    const button = screen.getByLabelText('Dismiss AI response');
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByText('final')).toBeNull();

    setSession({
      phase: 'thinking',
      messages: [
        userMsg,
        { id: 200, role: 'assistant', text: 'final' },
        { id: 300, role: 'user', text: 'q2' },
      ],
    });

    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });
});
