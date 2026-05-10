import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ePub, {
  EpubCFI,
  type Book as EpubBook,
  type Contents,
  type Rendition,
} from 'epubjs';
import { Button } from '@/components/ui/button';
import type { Book } from '../../db/types';
import {
  buildEpubNavItems,
  buildEpubSearchSections,
  flattenEpubToc,
  searchEpubSections,
  type EpubSearchSection,
} from '../../lib/epubReaderIndex';
import type { EpubQuoteRange, Position } from '../../lib/positionShape';
import { useAppStore } from '../../store';
import { applyEpubAnnotations } from './annotations/EpubAnnotations';
import { GO_TO_SOURCE_EVENT, type ReaderPreferences } from './readerSupport';

const OPEN_NOTE_EVENT = 'scholara:open-note';

// Resize still uses a blur mask to hide epub.js iframe reflow flicker.
// Page turns use a quieter text-only fade.
const RESIZE_PHASE_MS = 200;
const PAGE_PHASE_MS = 200;
const RESIZE_DEBOUNCE_MS = 150;

type PageDirection = 'next' | 'prev';

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

interface TocAnchorEntry {
  href: string;
  label: string;
  level: number;
  fileBase: string;
  fragment: string;
}

interface SectionAnchor {
  cfi: string;
  label: string;
}

type EpubSection = {
  href?: string;
  cfiBase?: string;
  index?: number;
};

export function EpubReader({ book, bytes }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const blurOverlayRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const pageChangeRef = useRef<((direction: PageDirection) => void) | null>(null);
  const searchSectionsRef = useRef<EpubSearchSection[]>([]);
  const searchDebounceRef = useRef<number | null>(null);
  const tocAnchorsRef = useRef<TocAnchorEntry[]>([]);
  const sectionAnchorsRef = useRef<Map<string, SectionAnchor[]>>(new Map());

  const notes = useAppStore((state) => state.currentBookNotes);
  const readerSearchQuery = useAppStore((state) => state.readerSearchQuery);
  const readerPreferences = useAppStore((state) => state.readerPreferences);
  const setBookCurrentPosition = useAppStore(
    (state) => state.setBookCurrentPosition,
  );
  const setBookEpubLocations = useAppStore((state) => state.setBookEpubLocations);
  const setReaderNavItems = useAppStore((state) => state.setReaderNavItems);
  const setReaderSearchResults = useAppStore(
    (state) => state.setReaderSearchResults,
  );
  const setReaderSearchStatus = useAppStore(
    (state) => state.setReaderSearchStatus,
  );
  const clearReaderSupport = useAppStore((state) => state.clearReaderSupport);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const epubBook = ePub(bytes) as EpubBook;
    const initialReaderPreferences = useAppStore.getState().readerPreferences;
    const rendition = epubBook.renderTo(container, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      manager: 'default',
      allowScriptedContent: true,
    });
    renditionRef.current = rendition;
    applyReaderPreferences(rendition, initialReaderPreferences);
    exposeReaderPreferencesForTests(initialReaderPreferences);

    const initialLocator = readInitialLocator(book.current_position);
    let relocateDebounce: number | null = null;
    let resizeDebounce: number | null = null;
    let phaseTimer: number | null = null;
    let sequenceActive = false;
    let cancelled = false;
    const wiredContents = new WeakSet<Contents>();
    const activeContents = new Set<Contents>();
    const detachContentListeners: Array<() => void> = [];
    const renderedSections: Array<{ contents: Contents; section: EpubSection }> = [];

    const handleRelocated = (location: { start?: { cfi?: string } }) => {
      const cfi = location.start?.cfi;
      if (!cfi) return;

      if (relocateDebounce !== null) {
        window.clearTimeout(relocateDebounce);
      }

      relocateDebounce = window.setTimeout(() => {
        const position = makePosition(
          epubBook,
          cfi,
          sectionAnchorsRef.current,
          tocAnchorsRef.current,
        );
        void setBookCurrentPosition(book.id, position);
      }, 500);
    };

    const handleSelected = (cfiRange: string, contents: Contents) => {
      dispatchEpubSelection(
        epubBook,
        contents,
        sectionAnchorsRef.current,
        tocAnchorsRef.current,
        cfiRange,
      );
    };

    const indexSectionAnchors = (
      contents: Contents,
      section: EpubSection,
    ): void => {
      if (!section.href || !section.cfiBase) return;
      const fileBase = basename(section.href);
      const matching = tocAnchorsRef.current.filter(
        (entry) => entry.fileBase === fileBase,
      );
      if (matching.length === 0) return;

      const indexed: SectionAnchor[] = [];
      for (const entry of matching) {
        try {
          if (!entry.fragment) {
            const node = contents.document.body;
            if (!node) continue;
            const cfi = new EpubCFI(node, section.cfiBase).toString();
            indexed.push({ cfi, label: entry.label });
            continue;
          }
          const el =
            contents.document.getElementById(entry.fragment) ??
            contents.document.querySelector(`[name="${CSS.escape(entry.fragment)}"]`);
          if (!el) continue;
          const cfi = new EpubCFI(el as Node, section.cfiBase).toString();
          indexed.push({ cfi, label: entry.label });
        } catch {
          // Skip anchors we can't resolve.
        }
      }

      if (indexed.length === 0) return;
      const helper = new EpubCFI();
      indexed.sort((a, b) => helper.compare(a.cfi, b.cfi));
      sectionAnchorsRef.current.set(section.href, indexed);
    };

    const wireContents = (contents?: Contents) => {
      if (!contents || wiredContents.has(contents)) return;
      wiredContents.add(contents);
      activeContents.add(contents);

      const dispatchFromSelection = () => {
        window.setTimeout(() => {
          dispatchEpubSelection(
            epubBook,
            contents,
            sectionAnchorsRef.current,
            tocAnchorsRef.current,
          );
        }, 0);
      };

      const handleContextMenu = (event: MouseEvent) => {
        const text = contents.window.getSelection()?.toString().trim() ?? '';
        if (!text) return;
        event.preventDefault();
        dispatchEpubSelection(
          epubBook,
          contents,
          sectionAnchorsRef.current,
          tocAnchorsRef.current,
        );
      };

      // Iframe events do not propagate to the parent window, so the
      // toolbar's document-level click-off listener never sees clicks made
      // inside the EPUB viewport. Forward them as a dismiss event.
      const dispatchDismiss = () => {
        window.dispatchEvent(new CustomEvent('scholara:dismiss-toolbar'));
      };
      const handleContentKeyDown = (event: KeyboardEvent) => {
        const triggerPageChange = pageChangeRef.current;
        if (triggerPageChange) {
          handlePageTurnKeyDown(event, triggerPageChange);
        }
      };

      contents.document.addEventListener('mousedown', dispatchDismiss);
      contents.document.addEventListener('mouseup', dispatchFromSelection);
      contents.document.addEventListener('keyup', dispatchFromSelection);
      contents.document.addEventListener('keydown', handleContentKeyDown);
      contents.document.addEventListener('contextmenu', handleContextMenu);

      detachContentListeners.push(() => {
        contents.document.removeEventListener('mousedown', dispatchDismiss);
        contents.document.removeEventListener('mouseup', dispatchFromSelection);
        contents.document.removeEventListener('keyup', dispatchFromSelection);
        contents.document.removeEventListener('keydown', handleContentKeyDown);
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

    const handleGoToSource = (event: Event) => {
      const position = (event as CustomEvent<Position>).detail;
      if (position.type !== 'epub') return;
      void rendition.display(position.locator);
      void setBookCurrentPosition(book.id, position);
    };

    window.addEventListener(GO_TO_SOURCE_EVENT, handleGoToSource);

    const handleRendered = (
      section: EpubSection | undefined,
      view: { contents?: Contents },
    ) => {
      wireContents(view.contents);
      if (section && view.contents) {
        renderedSections.push({ contents: view.contents, section });
        if (tocAnchorsRef.current.length > 0) {
          indexSectionAnchors(view.contents, section);
        }
      }
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

    const runResizeFadeSequence = (action: () => void, phaseMs: number) => {
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

    const runPageFadeSequence = (action: () => void, phaseMs: number) => {
      if (phaseTimer !== null) {
        window.clearTimeout(phaseTimer);
      }
      sequenceActive = true;
      setTransitionDuration(phaseMs);
      setLayerOpacity(0, 0);
      phaseTimer = window.setTimeout(() => {
        action();
        setLayerOpacity(1, 0);
        phaseTimer = window.setTimeout(() => {
          phaseTimer = null;
          sequenceActive = false;
        }, phaseMs);
      }, phaseMs);
    };

    const settleResize = () => {
      resizeDebounce = null;
      runResizeFadeSequence(() => renditionInternals.resize(), RESIZE_PHASE_MS);
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

    const triggerPageChange = (direction: PageDirection) => {
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
      runPageFadeSequence(advance, PAGE_PHASE_MS);
    };
    pageChangeRef.current = triggerPageChange;

    const swapResizeListener = () => {
      const stageResize = renditionInternals.manager?.stage?.resizeFunc;
      if (stageResize) {
        window.removeEventListener('resize', stageResize);
      }
      window.addEventListener('resize', handleWindowResize);
    };
    rendition.once('attached', swapResizeListener);

    void (async () => {
      await epubBook.ready;
      if (cancelled) return;

      void rendition.display(initialLocator);

      if (book.epub_locations) {
        epubBook.locations.load(book.epub_locations);
      } else {
        await epubBook.locations.generate(1024);
        if (cancelled) return;
        const locations = epubBook.locations.save();
        await setBookEpubLocations(book.id, locations);
        if (cancelled) return;
      }

      tocAnchorsRef.current = flattenEpubToc(epubBook.navigation.toc).map(
        (entry) => ({
          ...entry,
          fileBase: basename(stripFragment(entry.href)),
          fragment: getFragment(entry.href),
        }),
      );

      // Drain sections that rendered before the TOC was ready (the very
      // first `rendered` event typically fires before `epubBook.ready`).
      for (const { contents, section } of renderedSections) {
        indexSectionAnchors(contents, section);
      }

      const navItems = buildEpubNavItems(epubBook);
      if (cancelled) return;
      setReaderNavItems(navItems);
      setReaderSearchStatus('indexing');
      searchSectionsRef.current = await buildEpubSearchSections(epubBook, navItems);
      if (cancelled) return;

      const currentQuery = useAppStore.getState().readerSearchQuery.trim();
      if (currentQuery) {
        setReaderSearchResults(
          searchEpubSections(searchSectionsRef.current, currentQuery),
          searchSectionsRef.current.length > 0 ? 'ready' : 'empty',
        );
        return;
      }

      setReaderSearchStatus(
        searchSectionsRef.current.length > 0 ? 'ready' : 'empty',
      );
    })();

    const onKeyDown = (event: KeyboardEvent) => {
      handlePageTurnKeyDown(event, triggerPageChange);
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      cancelled = true;
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
      window.removeEventListener(GO_TO_SOURCE_EVENT, handleGoToSource);
      rendition.off('relocated', handleRelocated);
      rendition.off('selected', handleSelected);
      rendition.off('rendered', handleRendered);
      detachContentListeners.forEach((detach) => detach());
      clearReaderSupport();
      searchSectionsRef.current = [];
      if (searchDebounceRef.current !== null) {
        window.clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
      rendition.destroy();
      epubBook.destroy();
      renditionRef.current = null;
      pageChangeRef.current = null;
    };
  }, [
    book.epub_locations,
    book.id,
    bytes,
    clearReaderSupport,
    setBookCurrentPosition,
    setBookEpubLocations,
    setReaderNavItems,
    setReaderSearchResults,
    setReaderSearchStatus,
  ]);

  useEffect(() => {
    if (searchDebounceRef.current !== null) {
      window.clearTimeout(searchDebounceRef.current);
    }

    const query = readerSearchQuery.trim();
    if (!query) {
      setReaderSearchResults(
        [],
        searchSectionsRef.current.length > 0 ? 'ready' : 'idle',
      );
      return;
    }

    searchDebounceRef.current = window.setTimeout(() => {
      const results = searchEpubSections(searchSectionsRef.current, query);
      setReaderSearchResults(
        results,
        searchSectionsRef.current.length > 0 ? 'ready' : 'empty',
      );
    }, 180);

    return () => {
      if (searchDebounceRef.current !== null) {
        window.clearTimeout(searchDebounceRef.current);
      }
    };
  }, [readerSearchQuery, setReaderSearchResults]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (rendition) {
      applyReaderPreferences(rendition, readerPreferences);
    }
    exposeReaderPreferencesForTests(readerPreferences);
  }, [readerPreferences]);

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
        className="absolute inset-0 transition-opacity ease-out"
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
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        aria-label="Previous EPUB page"
        title="Previous EPUB page"
        onClick={() => pageChangeRef.current?.('prev')}
        className="absolute left-2 top-1/2 z-10 size-11 -translate-y-1/2 rounded-full border border-amber-100/60 bg-cream/45 text-ink-muted/70 opacity-70 shadow-md backdrop-blur-sm transition hover:bg-white/85 hover:text-ink hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-accent-gold/40 sm:left-4"
      >
        <ChevronLeft className="h-7 w-7" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        aria-label="Next EPUB page"
        title="Next EPUB page"
        onClick={() => pageChangeRef.current?.('next')}
        className="absolute right-2 top-1/2 z-10 size-11 -translate-y-1/2 rounded-full border border-amber-100/60 bg-cream/45 text-ink-muted/70 opacity-70 shadow-md backdrop-blur-sm transition hover:bg-white/85 hover:text-ink hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-accent-gold/40 sm:right-4"
      >
        <ChevronRight className="h-7 w-7" />
      </Button>
    </div>
  );
}

function handlePageTurnKeyDown(
  event: KeyboardEvent,
  triggerPageChange: (direction: PageDirection) => void,
): void {
  if (isEditableTarget(event.target)) return;

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    triggerPageChange('next');
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    triggerPageChange('prev');
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as { matches?: (selector: string) => boolean } | null;
  return (
    typeof element?.matches === 'function' &&
    element.matches('input,textarea,[contenteditable="true"]')
  );
}

function applyReaderPreferences(
  rendition: Rendition,
  preferences: ReaderPreferences,
): void {
  const fontFamily =
    preferences.fontFamily === 'original'
      ? undefined
      : readerFontFamily(preferences.fontFamily);

  rendition.themes.fontSize(`${preferences.fontScale}%`);
  if (fontFamily) {
    rendition.themes.font(fontFamily);
  } else {
    rendition.themes.font('');
  }
}

function readerFontFamily(font: ReaderPreferences['fontFamily']): string {
  if (font === 'arial') return 'Arial, sans-serif';
  if (font === 'georgia') return 'Georgia, serif';
  if (font === 'iowan') {
    return '"Iowan Old Style", "Palatino Linotype", Georgia, serif';
  }
  return '';
}

function exposeReaderPreferencesForTests(
  preferences: ReaderPreferences,
): void {
  if (!import.meta.env.VITE_E2E && import.meta.env.MODE !== 'test') return;

  (
    window as Window & {
      __SCHOLARA_READER_PREFS__?: ReaderPreferences;
    }
  ).__SCHOLARA_READER_PREFS__ = preferences;
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
  sectionAnchors: Map<string, SectionAnchor[]>,
  tocAnchors: TocAnchorEntry[],
): EpubQuoteRange | null {
  try {
    const startCfi = new EpubCFI(cfiRange);
    startCfi.collapse(true);

    const endCfi = new EpubCFI(cfiRange);
    endCfi.collapse(false);

    return {
      start: makePosition(epubBook, startCfi.toString(), sectionAnchors, tocAnchors),
      end: makePosition(epubBook, endCfi.toString(), sectionAnchors, tocAnchors),
      cfiRange,
    };
  } catch {
    return null;
  }
}

function dispatchEpubSelection(
  epubBook: EpubBook,
  contents: Contents,
  sectionAnchors: Map<string, SectionAnchor[]>,
  tocAnchors: TocAnchorEntry[],
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
  if (!resolvedCfiRange) return;

  const range = makeQuoteRange(epubBook, resolvedCfiRange, sectionAnchors, tocAnchors);
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

function makePosition(
  epubBook: EpubBook,
  cfi: string,
  sectionAnchors: Map<string, SectionAnchor[]>,
  tocAnchors: TocAnchorEntry[],
): Extract<Position, { type: 'epub' }> {
  const fraction = epubBook.locations.percentageFromCfi(cfi);

  return {
    type: 'epub',
    locator: cfi,
    fraction: Number.isFinite(fraction) ? fraction : 0,
    label: getChapterLabel(epubBook, cfi, sectionAnchors, tocAnchors),
  };
}

function getChapterLabel(
  epubBook: EpubBook,
  cfi: string,
  sectionAnchors: Map<string, SectionAnchor[]>,
  tocAnchors: TocAnchorEntry[],
): string {
  try {
    const section = epubBook.spine.get(cfi);
    if (!section) return 'Chapter';

    // Preferred path: anchors for this section have been indexed at render
    // time. Pick the latest TOC anchor whose CFI does not exceed `cfi`,
    // giving anchor-precise chapter labels even when many TOC chapters
    // live inside the same spine file (e.g. Project Gutenberg EPUBs).
    const anchors = section.href ? sectionAnchors.get(section.href) : null;
    if (anchors && anchors.length > 0) {
      const helper = new EpubCFI();
      let best: SectionAnchor | null = null;
      for (const anchor of anchors) {
        if (helper.compare(anchor.cfi, cfi) <= 0) best = anchor;
        else break;
      }
      if (best) return best.label;
      return anchors[0].label;
    }

    // Fallback: section not yet indexed (e.g. note taken before render).
    // Use the first TOC entry pointing at this file.
    if (section.href) {
      const fileBase = basename(section.href);
      const first = tocAnchors.find((entry) => entry.fileBase === fileBase);
      if (first) return first.label;
    }

    // Last resort — spine index. We deliberately avoid `idref`, which is
    // an OPF manifest slug (often literally "id_…") that leaks build-time
    // identifiers into the reader header.
    const index = (section as { index?: number }).index;
    return typeof index === 'number' ? `Chapter ${index + 1}` : 'Chapter';
  } catch {
    return 'Chapter';
  }
}

function stripFragment(href: string): string {
  const hashIdx = href.indexOf('#');
  return hashIdx === -1 ? href : href.slice(0, hashIdx);
}

function getFragment(href: string): string {
  const hashIdx = href.indexOf('#');
  return hashIdx === -1 ? '' : href.slice(hashIdx + 1);
}

function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}
