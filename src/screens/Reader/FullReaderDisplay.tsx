import { AnimatePresence, motion } from 'framer-motion';
import type { Book } from '../../db/types';
import { useAppStore } from '../../store';
import { ReaderChrome } from './ReaderChrome';
import { ReaderLeaf } from './ReaderLeaf';
import { NotesModeInput } from './NotesModeInput';
import { FloatingLogoInput } from './FloatingLogoInput';

interface Props {
  book: Book;
  bytes: ArrayBuffer;
}

export function FullReaderDisplay({ book, bytes }: Props) {
  const notesModeActive = useAppStore((s) => s.notesModeActive);

  return (
    <motion.div
      className="relative flex h-full w-full flex-col"
      initial={{ opacity: 0, filter: 'blur(3px)' }}
      animate={{ opacity: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, filter: 'blur(3px)' }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      <ReaderChrome book={book} variant="fullscreen" />
      <div className="relative min-h-0 flex-1">
        <ReaderLeaf book={book} bytes={bytes} />
      </div>

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
              >
                <NotesModeInput book={book} fullWidth />
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
