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
import { FloatingLogoInput } from './FloatingLogoInput';

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

export function FullReaderDisplay({ book, bytes }: Props) {
  const notesModeActive = useAppStore((s) => s.notesModeActive);
  const notesInputRef = useRef<NotesModeInputHandle | null>(null);

  return (
    <motion.div
      className="relative flex h-full w-full flex-col"
      variants={displayFade}
      initial="hidden"
      animate="visible"
      exit="hidden"
      style={{ overflowAnchor: 'none' }}
    >
      <motion.div variants={readerPartFade} transition={readerPartTransition}>
        <ReaderChrome book={book} variant="fullscreen" />
      </motion.div>
      <motion.div
        className="relative min-h-0 flex-1"
        variants={readerPartFade}
        transition={readerPartTransition}
      >
        <ReaderLeaf book={book} bytes={bytes} />
      </motion.div>

      <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
        <div className="pointer-events-auto">
          <AnimatePresence mode="wait" initial={false}>
            {notesModeActive ? (
              <motion.div
                key="notes-input"
                initial={{ opacity: 0, y: 28 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 28 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                onAnimationComplete={() => {
                  notesInputRef.current?.focusInput();
                }}
              >
                <NotesModeInput ref={notesInputRef} book={book} fullWidth />
              </motion.div>
            ) : (
              <motion.div
                key="logo-input"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
              >
                <FloatingLogoInput />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
