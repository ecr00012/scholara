import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAppStore } from '../../store';
import type { UiMessage } from '../../agent/session/types';

function lastAssistantMessage(messages: UiMessage[]): UiMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'assistant') return message;
  }
  return null;
}

function lastUserMessageId(messages: UiMessage[]): number | string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'user') return message.id;
  }
  return null;
}

export function ReaderModeAgentOverlay() {
  const phase = useAppStore((state) => state.agentSession.phase);
  const messages = useAppStore((state) => state.agentSession.messages);
  // Treat any pre-existing turn at mount as already-dismissed so toggling
  // agent → reader doesn't pop the stale last response back up. If we mount
  // mid-stream (cross-mode hand-off), keep null so the live overlay renders.
  const [dismissedFor, setDismissedFor] = useState<number | string | null>(() => {
    const session = useAppStore.getState().agentSession;
    return session.phase === 'idle' ? lastUserMessageId(session.messages) : null;
  });

  const lastAssistant = lastAssistantMessage(messages);
  const userTurnId = lastUserMessageId(messages);

  useEffect(() => {
    if (userTurnId !== null && dismissedFor !== null && dismissedFor !== userTurnId) {
      setDismissedFor(null);
    }
  }, [dismissedFor, userTurnId]);

  const isActive = phase !== 'idle';
  const dismissed = userTurnId !== null && dismissedFor === userTurnId;
  const showFinal =
    phase === 'idle' && lastAssistant !== null && userTurnId !== null;
  const visible = (isActive || showFinal) && !dismissed;

  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.button
        type="button"
        key={`overlay-${userTurnId ?? 'none'}`}
        layout
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        onClick={() => {
          if (userTurnId !== null) setDismissedFor(userTurnId);
        }}
        aria-label="Dismiss AI response"
        aria-live={isActive ? 'polite' : 'off'}
        className="pointer-events-auto absolute inset-x-6 top-6 z-30 max-h-[30%] overflow-y-auto rounded-2xl border border-white/40 bg-white/55 p-5 text-left text-sm text-ink shadow-xl backdrop-blur-md"
      >
        {phase === 'thinking' && (
          <div className="flex items-center gap-2 text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Thinking...</span>
          </div>
        )}
        {phase === 'tool' && (
          <div className="flex items-center gap-2 text-ink-muted">
            <Search className="h-4 w-4" aria-hidden="true" />
            <span>Searching the book...</span>
          </div>
        )}
        {(phase === 'streaming' || phase === 'idle') && lastAssistant && (
          <p className="whitespace-pre-wrap leading-relaxed">
            {lastAssistant.text ?? ''}
          </p>
        )}
      </motion.button>
    </AnimatePresence>
  );
}
