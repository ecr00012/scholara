import { AnimatePresence, motion } from 'framer-motion';
import { useRef } from 'react';
import type { Book } from '../../db/types';
import { useAppStore } from '../../store';
import { ReaderChrome } from './ReaderChrome';
import { ReaderLeaf } from './ReaderLeaf';
import {
  NotesModeInput,
  type NotesModeInputHandle,
} from './NotesModeInput';
import { AgentPanel } from './agentPanel/AgentPanel';

interface Props {
  book: Book;
  bytes: ArrayBuffer;
}

const displayFade = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.04,
    },
  },
};

const readerPartFade = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const readerPartTransition = { duration: 0.22, ease: 'easeOut' } as const;

export function AgentDisplay({ book, bytes }: Props) {
  const notesModeActive = useAppStore((s) => s.notesModeActive);
  const notesInputRef = useRef<NotesModeInputHandle | null>(null);

  return (
    <motion.div
      className="grid h-screen grid-cols-[1fr_22rem] grid-rows-1 overflow-hidden"
      variants={displayFade}
      initial="hidden"
      animate="visible"
      exit="hidden"
      style={{ overflowAnchor: 'none' }}
    >
      <section className="relative flex min-h-0 min-w-0 flex-col overflow-hidden">
        <motion.div variants={readerPartFade} transition={readerPartTransition}>
          <ReaderChrome book={book} variant="split" />
        </motion.div>
        <motion.div
          className="relative min-h-0 flex-1"
          variants={readerPartFade}
          transition={readerPartTransition}
        >
          <ReaderLeaf book={book} bytes={bytes} />
        </motion.div>
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20"
          style={{ overflowAnchor: 'none' }}
        >
          <AnimatePresence initial={false}>
            {notesModeActive ? (
              <motion.div
                key="notes-input"
                className="pointer-events-auto border-t border-stone-200 bg-amber-50/95 p-3 shadow-lg"
                initial={{ opacity: 0, y: 28 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 28 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                onAnimationComplete={() => {
                  notesInputRef.current?.focusInput();
                }}
              >
                <NotesModeInput
                  ref={notesInputRef}
                  book={book}
                  fullWidth={false}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </section>

      <motion.aside
        className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-stone-200 bg-cream/50"
        variants={readerPartFade}
        transition={readerPartTransition}
      >
        <AgentPanel book={book} />
      </motion.aside>
    </motion.div>
  );
}
