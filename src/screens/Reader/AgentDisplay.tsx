import { AnimatePresence, motion } from 'framer-motion';
import type { Book } from '../../db/types';
import { useAppStore } from '../../store';
import { ReaderChrome } from './ReaderChrome';
import { ReaderLeaf } from './ReaderLeaf';
import { NotesModeInput } from './NotesModeInput';
import { AgentPanel } from './agentPanel/AgentPanel';

interface Props {
  book: Book;
  bytes: ArrayBuffer;
}

export function AgentDisplay({ book, bytes }: Props) {
  const notesModeActive = useAppStore((s) => s.notesModeActive);

  return (
    <motion.div
      className="grid h-screen grid-cols-[1fr_22rem] grid-rows-1 overflow-hidden"
      initial={{ opacity: 0, filter: 'blur(3px)' }}
      animate={{ opacity: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, filter: 'blur(3px)' }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      <section className="flex min-h-0 min-w-0 flex-col">
        <ReaderChrome book={book} variant="split" />
        <div className="relative min-h-0 flex-1">
          <ReaderLeaf book={book} bytes={bytes} />
        </div>
        <AnimatePresence initial={false}>
          {notesModeActive ? (
            <motion.div
              key="notes-input"
              className="overflow-hidden border-t border-stone-200 bg-amber-50/40"
              initial={{ height: 0, opacity: 0, y: 18 }}
              animate={{ height: 'auto', opacity: 1, y: 0 }}
              exit={{ height: 0, opacity: 0, y: 18 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              <div className="p-3">
                <NotesModeInput book={book} fullWidth={false} />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </section>

      <motion.aside
        className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-stone-200 bg-cream/50"
        initial={{ x: 48, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 48, opacity: 0 }}
        transition={{ duration: 0.24, ease: 'easeOut' }}
      >
        <AgentPanel book={book} />
      </motion.aside>
    </motion.div>
  );
}
