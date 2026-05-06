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
    <div className="grid h-screen grid-cols-[1fr_22rem] grid-rows-1 overflow-hidden">
      <section className="flex min-h-0 min-w-0 flex-col">
        <ReaderChrome book={book} variant="split" />
        <div className="relative min-h-0 flex-1">
          <ReaderLeaf book={book} bytes={bytes} />
        </div>
        {notesModeActive ? (
          <div className="border-t border-stone-200 bg-amber-50/40 p-3">
            <NotesModeInput book={book} fullWidth={false} />
          </div>
        ) : null}
      </section>

      <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-stone-200 bg-cream/50">
        <AgentPanel book={book} />
      </aside>
    </div>
  );
}
