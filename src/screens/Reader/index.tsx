import { AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Book } from '../../db/types';
import { useAppStore } from '../../store';
import { readBookBytes } from '../../ipc/files';
import { startBackgroundIndexing } from '../../rag/backgroundIndexing';
import { markIndexingInteraction } from '../../rag/indexingActivity';
import { AgentDisplay } from './AgentDisplay';
import { DictionaryModal } from './DictionaryModal';
import { FullReaderDisplay } from './FullReaderDisplay';
import { MissingFileScreen } from './MissingFileScreen';
import { NotePeek } from './NotePeek';
import { SelectionToolbar } from './SelectionToolbar';

export function ReaderScreen() {
  const currentBookId = useAppStore((s) => s.currentBookId);
  const books = useAppStore((s) => s.books);
  const book = useMemo(
    () => books.find((candidate) => candidate.id === currentBookId) ?? null,
    [books, currentBookId],
  );

  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [missing, setMissing] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;

    if (!book) {
      setMissing(true);
      return;
    }

    setMissing(false);
    setBytes(null);

    void (async () => {
      try {
        const nextBytes = await readBookBytes(book.file_path);
        if (!cancelled.current) {
          setBytes(nextBytes);
        }
      } catch (error) {
        console.warn('Could not read book bytes:', error);
        if (!cancelled.current) {
          setMissing(true);
        }
      }
    })();

    return () => {
      cancelled.current = true;
    };
  }, [book?.id, book?.file_path]);

  if (!book || missing) {
    return <MissingFileScreen />;
  }

  if (!bytes) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-cream">
        <p className="text-sm text-ink-muted">Opening…</p>
      </div>
    );
  }

  return <LoadedReaderScreen book={book} bytes={bytes} />;
}

function LoadedReaderScreen({ book, bytes }: { book: Book; bytes: ArrayBuffer }) {
  useEffect(() => {
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  useEffect(() => {
    void startBackgroundIndexing({
      id: book.id,
      file_path: book.file_path,
      file_type: book.file_type,
    });
  }, [book.file_path, book.file_type, book.id]);

  return (
    <div
      className="h-full w-full"
      onPointerMove={markIndexingInteraction}
      onPointerDown={markIndexingInteraction}
      onWheel={markIndexingInteraction}
      onScroll={markIndexingInteraction}
    >
      <AnimatePresence mode="wait">
        {book.display_mode === 'reader' ? (
          <FullReaderDisplay key="reader" book={book} bytes={bytes} />
        ) : (
          <AgentDisplay key="agent" book={book} bytes={bytes} />
        )}
      </AnimatePresence>
      <SelectionToolbar book={book} />
      <NotePeek />
      <DictionaryModal />
    </div>
  );
}
