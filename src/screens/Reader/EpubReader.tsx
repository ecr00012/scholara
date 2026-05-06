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

const OPEN_NOTE_EVENT = 'scholara:open-note';

// Choreography: phase 1 fades old text + blur out, the action runs while the
// screen is blank, phase 2 fades new text + blur in, phase 3 lifts the blur.
// Phase durations differ by trigger — slow for window resizes, snappy for
// page flips. The CSS transitionDuration is set imperatively to match.
const RESIZE_PHASE_MS = 200;
const PAGE_PHASE_MS = 60;
const RESIZE_DEBOUNCE_MS = 150;

interface Props {
  book: Book;
  bytes: ArrayBuffer;
}

interface SelectionDetail {
  kind: 'word' | 'range';
  text: string;
  range: EpubQuoteRange;
  rect?: { x: number; y: number };
}

export function EpubReader({ book, bytes }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const blurOverlayRef = useRef<HTMLDivElement | null>(null);
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
      allowScriptedContent: true,
    });
    renditionRef.current = rendition;

    const initialLocator = readInitialLocator(book.current_position);
    let relocateDebounce: number | null = null;
    let resizeDebounce: number | null = null;
    let phaseTimer: number | null = null;
    let sequenceActive = false;
    const wiredContents = new WeakSet<Contents>();
    const activeContents = new Set<Contents>();
    const detachContentListeners: Array<() => void> = [];

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
      dispatchEpubSelection(epubBook, contents, cfiRange);
    };

    const wireContents = (contents?: Contents) => {
      if (!contents || wiredContents.has(contents)) return;
      wiredContents.add(contents);
      activeContents.add(contents);

      const dispatchFromSelection = () => {
        window.setTimeout(() => {
          dispatchEpubSelection(epubBook, contents);
        }, 0);
      };

      const handleContextMenu = (event: MouseEvent) => {
        const text = contents.window.getSelection()?.toString().trim() ?? '';
        if (!text) return;
        event.preventDefault();
        dispatchEpubSelection(epubBook, contents);
      };

      // Iframe events do not propagate to the parent window, so the
      // toolbar's document-level click-off listener never sees clicks made
      // inside the EPUB viewport. Forward them as a dismiss event.
      const dispatchDismiss = () => {
        window.dispatchEvent(new CustomEvent('scholara:dismiss-toolbar'));
      };

      contents.document.addEventListener('mousedown', dispatchDismiss);
      contents.document.addEventListener('mouseup', dispatchFromSelection);
      contents.document.addEventListener('keyup', dispatchFromSelection);
      contents.document.addEventListener('contextmenu', handleContextMenu);

      detachContentListeners.push(() => {
        contents.document.removeEventListener('mousedown', dispatchDismiss);
        contents.document.removeEventListener('mouseup', dispatchFromSelection);
        contents.document.removeEventListener('keyup', dispatchFromSelection);
        contents.document.removeEventListener('contextmenu', handleContextMenu);
        activeContents.delete(contents);
      });
    };

    const handleClearSelection = () => {
      // Clear the iframe selection too — `window.getSelection().removeAllRanges()`
      // in the parent does not reach the sandboxed EPUB document.
      activeContents.forEach((contents) => {
        try {
          contents.window.getSelection()?.removeAllRanges();
        } catch {
          // Defensive: contents may have been torn down already.
        }
      });
    };

    window.addEventListener('scholara:clear-selection', handleClearSelection);

    const handleRendered = (_section: unknown, view: { contents?: Contents }) => {
      wireContents(view.contents);
    };

    rendition.on('relocated', handleRelocated);
    rendition.on('selected', handleSelected);
    rendition.on('rendered', handleRendered);

    // epub.js's default manager attaches a 50ms-throttled (leading-edge)
    // window-resize listener that destroys + re-creates the iframe view on
    // each fire — visibly flickering during interactive drag-resizes.
    // Replace it with a trailing-edge debounce so the rendition only
    // re-paginates once the user stops resizing. The .d.ts hides `.manager`
    // and overstates required args on `.resize()`; cast through an
    // internal-shape type rather than `any`.
    const renditionInternals = rendition as unknown as {
      resize: () => void;
      manager?: { stage?: { resizeFunc?: EventListener } };
    };
    const setLayerOpacity = (text: number, blur: number) => {
      if (containerRef.current) containerRef.current.style.opacity = String(text);
      if (blurOverlayRef.current) blurOverlayRef.current.style.opacity = String(blur);
    };
    const setTransitionDuration = (ms: number) => {
      const value = `${ms}ms`;
      if (containerRef.current) containerRef.current.style.transitionDuration = value;
      if (blurOverlayRef.current) blurOverlayRef.current.style.transitionDuration = value;
    };

    const runFadeSequence = (action: () => void, phaseMs: number) => {
      if (phaseTimer !== null) {
        window.clearTimeout(phaseTimer);
      }
      sequenceActive = true;
      setTransitionDuration(phaseMs);
      // Phase 1: old text + blur fade out together → screen blank.
      setLayerOpacity(0, 0);
      phaseTimer = window.setTimeout(() => {
        // Re-render while masked. epub.js handles the swap synchronously
        // enough that the upcoming blur fade-in covers the moment.
        action();
        // Phase 2: new text and blur fade in together.
        setLayerOpacity(1, 1);
        phaseTimer = window.setTimeout(() => {
          // Phase 3: blur fades out, text remains.
          setLayerOpacity(1, 0);
          phaseTimer = window.setTimeout(() => {
            phaseTimer = null;
            sequenceActive = false;
          }, phaseMs);
        }, phaseMs);
      }, phaseMs);
    };

    const settleResize = () => {
      resizeDebounce = null;
      runFadeSequence(() => renditionInternals.resize(), RESIZE_PHASE_MS);
    };

    const handleWindowResize = () => {
      // If a settle sequence was in flight, cancel it and snap back to drag
      // visuals — user is resizing again.
      if (phaseTimer !== null) {
        window.clearTimeout(phaseTimer);
        phaseTimer = null;
        sequenceActive = false;
      }
      // Drag visual: text remains visible (1) under a fully-opaque blur (1).
      setTransitionDuration(RESIZE_PHASE_MS);
      setLayerOpacity(1, 1);
      if (resizeDebounce !== null) {
        window.clearTimeout(resizeDebounce);
      }
      resizeDebounce = window.setTimeout(settleResize, RESIZE_DEBOUNCE_MS);
    };

    const triggerPageChange = (direction: 'next' | 'prev') => {
      const advance = () => {
        if (direction === 'next') void rendition.next();
        else void rendition.prev();
      };
      // If a sequence is already running (e.g. rapid arrow presses), let the
      // existing blur keep masking and just advance immediately. Spamming
      // arrows shouldn't be blocked by the fade timing.
      if (sequenceActive) {
        advance();
        return;
      }
      runFadeSequence(advance, PAGE_PHASE_MS);
    };
    const swapResizeListener = () => {
      const stageResize = renditionInternals.manager?.stage?.resizeFunc;
      if (stageResize) {
        window.removeEventListener('resize', stageResize);
      }
      window.addEventListener('resize', handleWindowResize);
    };
    rendition.once('attached', swapResizeListener);

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
        triggerPageChange('next');
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        triggerPageChange('prev');
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      if (relocateDebounce !== null) {
        window.clearTimeout(relocateDebounce);
      }
      if (resizeDebounce !== null) {
        window.clearTimeout(resizeDebounce);
      }
      if (phaseTimer !== null) {
        window.clearTimeout(phaseTimer);
      }

      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', handleWindowResize);
      window.removeEventListener('scholara:clear-selection', handleClearSelection);
      rendition.off('relocated', handleRelocated);
      rendition.off('selected', handleSelected);
      rendition.off('rendered', handleRendered);
      detachContentListeners.forEach((detach) => detach());
      rendition.destroy();
      epubBook.destroy();
      renditionRef.current = null;
    };
  }, [
    book.epub_locations,
    book.id,
    bytes,
    setBookCurrentPosition,
    setBookEpubLocations,
  ]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    const handle = applyEpubAnnotations(rendition, notes, (noteId) => {
      window.dispatchEvent(
        new CustomEvent<number>(OPEN_NOTE_EVENT, { detail: noteId }),
      );
    });
    return () => handle.detach();
  }, [book.id, notes]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        ref={containerRef}
        className={`absolute inset-0 transition-opacity ease-out ${notesModeActive ? 'bg-amber-50/30' : ''}`}
        style={{ transitionDuration: `${RESIZE_PHASE_MS}ms` }}
      />
      <div
        ref={blurOverlayRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity ease-out"
        style={{
          opacity: 0,
          transitionDuration: `${RESIZE_PHASE_MS}ms`,
          backdropFilter: 'blur(12px) saturate(1.05)',
          WebkitBackdropFilter: 'blur(12px) saturate(1.05)',
        }}
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
      cfiRange,
    };
  } catch {
    return null;
  }
}

function dispatchEpubSelection(
  epubBook: EpubBook,
  contents: Contents,
  cfiRange?: string,
): void {
  const selection = contents.window.getSelection();
  const text = selection?.toString().trim() ?? '';
  if (!selection || selection.rangeCount === 0 || !text) return;

  let resolvedCfiRange = cfiRange;
  try {
    resolvedCfiRange ??= contents.cfiFromRange(selection.getRangeAt(0));
  } catch {
    return;
  }

  const range = makeQuoteRange(epubBook, resolvedCfiRange);
  if (!range) return;

  window.dispatchEvent(
    new CustomEvent<SelectionDetail>('scholara:selection', {
      detail: {
        kind: text.split(/\s+/).length === 1 ? 'word' : 'range',
        text,
        range,
        rect: getSelectionAnchorRect(contents, selection),
      },
    }),
  );
}

function getSelectionAnchorRect(
  contents: Contents,
  selection: Selection,
): { x: number; y: number } | undefined {
  if (selection.rangeCount === 0) return undefined;

  const bounds = selection.getRangeAt(0).getBoundingClientRect();
  if (bounds.width === 0 && bounds.height === 0) return undefined;

  const frame = contents.window.frameElement as HTMLElement | null;
  const frameBounds = frame?.getBoundingClientRect();
  const left = (frameBounds?.left ?? 0) + bounds.left + bounds.width / 2;
  const top = (frameBounds?.top ?? 0) + bounds.bottom + 10;

  return {
    x: Math.min(Math.max(left, 16), window.innerWidth - 16),
    y: Math.min(Math.max(top, 16), window.innerHeight - 64),
  };
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
    if (!section) return 'Chapter';
    const tocMatch = section.href
      ? findNavLabel(epubBook.navigation.toc, section.href)
      : null;
    if (tocMatch) return tocMatch;
    // No TOC hit — fall back to the spine position rather than `idref`,
    // which is an OPF manifest slug (often literally "id_…") that leaks
    // build-time identifiers into the reader header.
    const index = (section as { index?: number }).index;
    return typeof index === 'number' ? `Chapter ${index + 1}` : 'Chapter';
  } catch {
    return 'Chapter';
  }
}

function findNavLabel(items: NavItem[], href: string): string | null {
  // TOC entries frequently carry a fragment (Text/ch1.xhtml#start) while
  // spine sections expose a bare path (Text/ch1.xhtml), so strict equality
  // never matches. Compare with fragments stripped, then fall back to a
  // basename match for the case where TOC/spine use different relative
  // roots (OEBPS/Text/ch1.xhtml vs Text/ch1.xhtml).
  const target = stripFragment(href);
  const exact = findInToc(items, (item) => stripFragment(item.href) === target);
  if (exact) return exact;

  const targetBasename = basename(target);
  return findInToc(
    items,
    (item) => basename(stripFragment(item.href)) === targetBasename,
  );
}

function findInToc(
  items: NavItem[],
  match: (item: NavItem) => boolean,
): string | null {
  for (const item of items) {
    if (match(item)) return item.label;
    if (item.subitems?.length) {
      const childMatch = findInToc(item.subitems, match);
      if (childMatch) return childMatch;
    }
  }
  return null;
}

function stripFragment(href: string): string {
  const hashIdx = href.indexOf('#');
  return hashIdx === -1 ? href : href.slice(0, hashIdx);
}

function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}
