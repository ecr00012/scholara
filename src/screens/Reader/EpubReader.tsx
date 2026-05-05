import { useEffect, useRef } from 'react';
import ePub, {
  EpubCFI,
  type Book as EpubBook,
  type Contents,
  type NavItem,
  type Rendition,
} from 'epubjs';
import type { Book } from '../../db/types';
import type { EpubQuoteRange, Position } from '../../lib/positionShape';
import { useAppStore } from '../../store';
import { applyEpubAnnotations } from './annotations/EpubAnnotations';

interface Props {
  book: Book;
  bytes: ArrayBuffer;
}

interface SelectionDetail {
  kind: 'word' | 'range';
  text: string;
  range: EpubQuoteRange;
}

export function EpubReader({ book, bytes }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<Rendition | null>(null);

  const notes = useAppStore((state) => state.currentBookNotes);
  const notesModeActive = useAppStore((state) => state.notesModeActive);
  const setBookCurrentPosition = useAppStore(
    (state) => state.setBookCurrentPosition,
  );
  const setBookEpubLocations = useAppStore((state) => state.setBookEpubLocations);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const epubBook = ePub(bytes) as EpubBook;
    const rendition = epubBook.renderTo(container, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      manager: 'default',
    });
    renditionRef.current = rendition;

    const initialLocator = readInitialLocator(book.current_position);
    let relocateDebounce: number | null = null;

    const handleRelocated = (location: { start?: { cfi?: string } }) => {
      const cfi = location.start?.cfi;
      if (!cfi) return;

      if (relocateDebounce !== null) {
        window.clearTimeout(relocateDebounce);
      }

      relocateDebounce = window.setTimeout(() => {
        const position = makePosition(epubBook, cfi);
        void setBookCurrentPosition(book.id, position);
      }, 500);
    };

    const handleSelected = (cfiRange: string, contents: Contents) => {
      const selection = contents.window.getSelection();
      const text = selection?.toString().trim() ?? '';
      if (!text) return;

      const range = makeQuoteRange(epubBook, cfiRange);
      if (!range) return;

      window.dispatchEvent(
        new CustomEvent<SelectionDetail>('scholara:selection', {
          detail: {
            kind: text.split(/\s+/).length === 1 ? 'word' : 'range',
            text,
            range,
          },
        }),
      );
    };

    rendition.on('relocated', handleRelocated);
    rendition.on('selected', handleSelected);

    void rendition.display(initialLocator);

    void (async () => {
      await epubBook.ready;

      if (book.epub_locations) {
        epubBook.locations.load(book.epub_locations);
        return;
      }

      await epubBook.locations.generate(1024);
      const locations = epubBook.locations.save();
      await setBookEpubLocations(book.id, locations);
    })();

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input,textarea,[contenteditable="true"]')) return;

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        void rendition.next();
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void rendition.prev();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      if (relocateDebounce !== null) {
        window.clearTimeout(relocateDebounce);
      }

      window.removeEventListener('keydown', onKeyDown);
      rendition.off('relocated', handleRelocated);
      rendition.off('selected', handleSelected);
      rendition.destroy();
      epubBook.destroy();
      renditionRef.current = null;
    };
  }, [
    book.current_position,
    book.epub_locations,
    book.id,
    bytes,
    setBookCurrentPosition,
    setBookEpubLocations,
  ]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    const handle = applyEpubAnnotations(rendition, notes);
    return () => handle.detach();
  }, [book.id, notes]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        ref={containerRef}
        className={`absolute inset-0 ${notesModeActive ? 'bg-amber-50/30' : ''}`}
      />
    </div>
  );
}

function readInitialLocator(currentPosition: string | null): string | undefined {
  if (!currentPosition) return undefined;

  try {
    const parsed = JSON.parse(currentPosition) as Position;
    return parsed.type === 'epub' ? parsed.locator : undefined;
  } catch {
    return undefined;
  }
}

function makeQuoteRange(
  epubBook: EpubBook,
  cfiRange: string,
): EpubQuoteRange | null {
  try {
    const startCfi = new EpubCFI(cfiRange);
    startCfi.collapse(true);

    const endCfi = new EpubCFI(cfiRange);
    endCfi.collapse(false);

    return {
      start: makePosition(epubBook, startCfi.toString()),
      end: makePosition(epubBook, endCfi.toString()),
    };
  } catch {
    return null;
  }
}

function makePosition(epubBook: EpubBook, cfi: string): Extract<Position, { type: 'epub' }> {
  const fraction = epubBook.locations.percentageFromCfi(cfi);

  return {
    type: 'epub',
    locator: cfi,
    fraction: Number.isFinite(fraction) ? fraction : 0,
    label: getChapterLabel(epubBook, cfi),
  };
}

function getChapterLabel(epubBook: EpubBook, cfi: string): string {
  try {
    const section = epubBook.spine.get(cfi);
    const href = section?.href;
    const tocMatch = href ? findNavLabel(epubBook.navigation.toc, href) : null;
    return tocMatch ?? section?.idref ?? 'Chapter';
  } catch {
    return 'Chapter';
  }
}

function findNavLabel(items: NavItem[], href: string): string | null {
  for (const item of items) {
    if (item.href === href) return item.label;
    if (item.subitems?.length) {
      const childMatch = findNavLabel(item.subitems, href);
      if (childMatch) return childMatch;
    }
  }

  return null;
}
