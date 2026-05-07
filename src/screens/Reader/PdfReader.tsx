import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { Book, NoteRow } from '../../db/types';
import type { PdfQuoteRange, Position } from '../../lib/positionShape';
import { viewportRectToPdfRect } from '../../lib/pdfRectTransform';
import { initPdfWorker } from '../../lib/pdfWorker';
import { useAppStore } from '../../store';
import { applyPdfAnnotations } from './annotations/PdfAnnotations';

const RENDER_SCALE = 1.5;
const ROOT_MARGIN = '500px 0px';
const POSITION_SAVE_DEBOUNCE_MS = 500;
const OPEN_NOTE_EVENT = 'scholara:open-note';
const GO_TO_SOURCE_EVENT = 'scholara:go-to-source';

interface Props {
  book: Book;
  bytes: ArrayBuffer;
}

interface PageMetric {
  width: number;
  height: number;
}

interface SelectionDetail {
  kind: 'word' | 'range';
  text: string;
  range: PdfQuoteRange;
  rect?: { x: number; y: number };
}

export function PdfReader({ book, bytes }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const renderedPagesRef = useRef<Set<number>>(new Set());
  const notesRef = useRef<NoteRow[]>([]);
  const restoreDoneRef = useRef(false);

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageMetrics, setPageMetrics] = useState<PageMetric[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const notes = useAppStore((state) => state.currentBookNotes);
  const setBookCurrentPosition = useAppStore(
    (state) => state.setBookCurrentPosition,
  );
  const clearReaderSupport = useAppStore((state) => state.clearReaderSupport);

  notesRef.current = notes;

  useEffect(() => {
    clearReaderSupport();
  }, [clearReaderSupport]);

  useEffect(() => {
    initPdfWorker();
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    renderedPagesRef.current = new Set();
    restoreDoneRef.current = false;
    pageRefs.current = [];
    setPdf(null);
    setPageMetrics([]);
    setLoadError(null);

    void (async () => {
      try {
        const data = bytes.slice(0);
        loadingTask = pdfjs.getDocument({ data });
        const doc = await loadingTask.promise;
        if (cancelled) {
          await doc.destroy();
          return;
        }

        const metrics: PageMetric[] = [];
        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
          const page = await doc.getPage(pageNumber);
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          metrics.push({ width: viewport.width, height: viewport.height });
        }

        if (cancelled) {
          await doc.destroy();
          return;
        }

        setPdf(doc);
        setPageMetrics(metrics);
      } catch (error) {
        if (!cancelled) {
          setLoadError((error as Error).message || 'Could not load PDF.');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (loadingTask) {
        void loadingTask.destroy();
      }
    };
  }, [bytes]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !pdf || pageMetrics.length === 0 || restoreDoneRef.current) {
      return;
    }

    restoreDoneRef.current = true;

    if (!book.current_position) return;

    try {
      const position = JSON.parse(book.current_position) as Position;
      if (position.type !== 'pdf') return;

      scrollToPdfPosition(root, pageRefs.current, pageMetrics, pdf.numPages, position);
    } catch {
      // Ignore malformed saved positions and fall back to the start of the book.
    }
  }, [book.current_position, pageMetrics, pdf]);

  useEffect(() => {
    const handleGoToSource = (event: Event) => {
      const position = (event as CustomEvent<Position>).detail;
      const root = containerRef.current;
      if (!root || !pdf || pageMetrics.length === 0 || position.type !== 'pdf') {
        return;
      }

      scrollToPdfPosition(root, pageRefs.current, pageMetrics, pdf.numPages, position);
      void setBookCurrentPosition(book.id, position);
    };

    window.addEventListener(GO_TO_SOURCE_EVENT, handleGoToSource);
    return () => window.removeEventListener(GO_TO_SOURCE_EVENT, handleGoToSource);
  }, [book.id, pageMetrics, pdf, setBookCurrentPosition]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !pdf || pageMetrics.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNumber = Number(entry.target.getAttribute('data-page'));
          if (!entry.isIntersecting || renderedPagesRef.current.has(pageNumber)) {
            continue;
          }

          const container = pageRefs.current[pageNumber - 1];
          if (!container) continue;

          renderedPagesRef.current.add(pageNumber);
          void renderPage(pdf, pageNumber, container, notesRef.current);
        }
      },
      { root, rootMargin: ROOT_MARGIN },
    );

    pageRefs.current.forEach((pageEl) => {
      if (pageEl) observer.observe(pageEl);
    });

    return () => observer.disconnect();
  }, [pageMetrics, pdf]);

  useEffect(() => {
    if (!pdf) return;

    pageRefs.current.forEach((container, index) => {
      if (!container || !renderedPagesRef.current.has(index + 1)) return;
      void applyAnnotationsForPage(pdf, index + 1, container, notes);
    });
  }, [notes, pdf]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !pdf) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const persistPosition = () => {
      const scrollTop = root.scrollTop;
      let pageNumber = 1;
      let localFraction = 0;
      let foundPage = false;

      pageRefs.current.forEach((pageEl, index) => {
        if (!pageEl || foundPage) return;

        const pageTop = pageEl.offsetTop;
        const pageHeight = pageEl.offsetHeight;
        const pageBottom = pageTop + pageHeight;

        if (scrollTop >= pageTop && scrollTop < pageBottom) {
          pageNumber = index + 1;
          localFraction =
            pageHeight > 0 ? clamp((scrollTop - pageTop) / pageHeight, 0, 1) : 0;
          foundPage = true;
        }
      });

      if (!foundPage) {
        let nearestDistance = Number.POSITIVE_INFINITY;

        pageRefs.current.forEach((pageEl, index) => {
          if (!pageEl) return;
          const distance = Math.abs(pageEl.offsetTop - scrollTop);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            pageNumber = index + 1;
          }
        });
      }

      const fraction = clamp(((pageNumber - 1) + localFraction) / pdf.numPages, 0, 1);
      const position: Position = {
        type: 'pdf',
        locator: pageNumber,
        fraction,
        label: `Page ${pageNumber}`,
      };

      void setBookCurrentPosition(book.id, position);
    };

    const handleScroll = () => {
      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(persistPosition, POSITION_SAVE_DEBOUNCE_MS);
    };

    root.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      root.removeEventListener('scroll', handleScroll);
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [book.id, pdf, setBookCurrentPosition]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input,textarea,[contenteditable="true"]')) return;

      const root = containerRef.current;
      if (!root) return;

      if (event.key === ' ' && !event.shiftKey) {
        event.preventDefault();
        root.scrollBy({ top: root.clientHeight * 0.9, behavior: 'smooth' });
      }

      if (event.key === ' ' && event.shiftKey) {
        event.preventDefault();
        root.scrollBy({ top: -root.clientHeight * 0.9, behavior: 'smooth' });
      }

      if (event.key === 'Home') {
        event.preventDefault();
        pageRefs.current[0]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }

      if (event.key === 'End') {
        event.preventDefault();
        pageRefs.current[pageRefs.current.length - 1]?.scrollIntoView({
          block: 'start',
          behavior: 'smooth',
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !pdf) return;

    const handleMouseUp = () => {
      void captureSelection(pdf, pageRefs.current);
    };

    const handleContextMenu = (event: MouseEvent) => {
      const text = window.getSelection()?.toString().trim() ?? '';
      if (!text) return;
      event.preventDefault();
      void captureSelection(pdf, pageRefs.current);
    };

    root.addEventListener('mouseup', handleMouseUp);
    root.addEventListener('contextmenu', handleContextMenu);
    return () => {
      root.removeEventListener('mouseup', handleMouseUp);
      root.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [pdf]);

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-muted">
        Could not load PDF: {loadError}
      </div>
    );
  }

  if (!pdf || pageMetrics.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-muted">
        Loading PDF…
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-y-auto"
    >
      <div className="mx-auto flex w-fit flex-col gap-4 py-6">
        {pageMetrics.map((metric, index) => (
          <div
            key={index + 1}
            data-page={index + 1}
            ref={(element) => {
              pageRefs.current[index] = element;
            }}
            className="relative overflow-hidden bg-white shadow"
            style={{
              width: `${metric.width}px`,
              height: `${metric.height}px`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

async function renderPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  container: HTMLElement,
  notes: NoteRow[],
) {
  const page: PDFPageProxy = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: RENDER_SCALE });

  container.style.width = `${viewport.width}px`;
  container.style.height = `${viewport.height}px`;
  container.replaceChildren();

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.className = 'absolute inset-0';

  const context = canvas.getContext('2d');
  if (!context) return;

  await page.render({ canvasContext: context, viewport }).promise;
  container.appendChild(canvas);

  const textLayer = document.createElement('div');
  textLayer.className = 'absolute inset-0 textLayer';
  textLayer.style.cssText = 'color: transparent; user-select: text; line-height: 1;';
  container.appendChild(textLayer);

  const textContent = await page.getTextContent();
  // pdf.js v4 replaced the standalone `renderTextLayer()` function with a
  // `TextLayer` class. We support both shapes so the text layer is actually
  // populated; otherwise selection rects from the textLayer come up empty
  // and quote highlighting silently no-ops.
  const pdfjsAny = pdfjs as unknown as {
    renderTextLayer?: (args: {
      textContentSource: Awaited<ReturnType<PDFPageProxy['getTextContent']>>;
      container: HTMLElement;
      viewport: ReturnType<PDFPageProxy['getViewport']>;
      textDivs: HTMLElement[];
    }) => { promise: Promise<void> };
    TextLayer?: new (args: {
      textContentSource: Awaited<ReturnType<PDFPageProxy['getTextContent']>>;
      container: HTMLElement;
      viewport: ReturnType<PDFPageProxy['getViewport']>;
    }) => { render(): Promise<void> };
  };

  if (typeof pdfjsAny.TextLayer === 'function') {
    const layer = new pdfjsAny.TextLayer({
      textContentSource: textContent,
      container: textLayer,
      viewport,
    });
    await layer.render();
  } else if (pdfjsAny.renderTextLayer) {
    await pdfjsAny.renderTextLayer({
      textContentSource: textContent,
      container: textLayer,
      viewport,
      textDivs: [],
    }).promise;
  }

  await applyAnnotationsForPage(pdf, pageNumber, container, notes);
}

async function applyAnnotationsForPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  container: HTMLElement,
  notes: NoteRow[],
) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  applyPdfAnnotations(pageNumber, container, viewport, notes, (noteId) => {
    window.dispatchEvent(
      new CustomEvent<number>(OPEN_NOTE_EVENT, { detail: noteId }),
    );
  });
}

async function captureSelection(
  pdf: PDFDocumentProxy,
  pageElements: Array<HTMLDivElement | null>,
) {
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? '';
  if (!selection || selection.rangeCount === 0 || !text) return;

  const range = selection.getRangeAt(0);
  const selectionBounds = range.getBoundingClientRect();
  const rects = Array.from(range.getClientRects());
  const perPage = new Map<number, Array<{ x: number; y: number; w: number; h: number }>>();

  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;

    // Pick the page that overlaps this client rect the most, rather than
    // requiring strict containment. Multi-line selections from the pdf.js
    // text layer occasionally produce rects whose edges sit a fraction of
    // a pixel outside the page box, which would otherwise drop them.
    let bestIndex = -1;
    let bestOverlap = 0;
    let bestPageRect: DOMRect | null = null;

    for (let index = 0; index < pageElements.length; index += 1) {
      const pageEl = pageElements[index];
      if (!pageEl) continue;

      const pageRect = pageEl.getBoundingClientRect();
      const overlapX = Math.max(
        0,
        Math.min(rect.right, pageRect.right) - Math.max(rect.left, pageRect.left),
      );
      const overlapY = Math.max(
        0,
        Math.min(rect.bottom, pageRect.bottom) - Math.max(rect.top, pageRect.top),
      );
      const overlap = overlapX * overlapY;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIndex = index;
        bestPageRect = pageRect;
      }
    }

    if (bestIndex < 0 || !bestPageRect) continue;

    const pageNumber = bestIndex + 1;
    const localRect = {
      x: rect.left - bestPageRect.left,
      y: rect.top - bestPageRect.top,
      w: rect.width,
      h: rect.height,
    };
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const pdfRect = viewportRectToPdfRect(localRect, viewport);
    const currentRects = perPage.get(pageNumber) ?? [];
    currentRects.push(pdfRect);
    perPage.set(pageNumber, currentRects);
  }

  if (perPage.size === 0) return;

  const pageNumbers = Array.from(perPage.keys()).sort((a, b) => a - b);
  const startPage = pageNumbers[0];
  const endPage = pageNumbers[pageNumbers.length - 1];

  const quoteRange: PdfQuoteRange = {
    start: {
      type: 'pdf',
      locator: startPage,
      fraction: startPage / pdf.numPages,
      label: `Page ${startPage}`,
    },
    end: {
      type: 'pdf',
      locator: endPage,
      fraction: endPage / pdf.numPages,
      label: `Page ${endPage}`,
    },
    pages: pageNumbers.map((pageNumber) => ({
      page: pageNumber,
      rects: perPage.get(pageNumber) ?? [],
    })),
  };

  window.dispatchEvent(
    new CustomEvent<SelectionDetail>('scholara:selection', {
      detail: {
        kind: text.split(/\s+/).length === 1 ? 'word' : 'range',
        text,
        range: quoteRange,
        rect:
          selectionBounds.width > 0 || selectionBounds.height > 0
            ? {
                x: Math.min(
                  Math.max(selectionBounds.left + selectionBounds.width / 2, 16),
                  window.innerWidth - 16,
                ),
                y: Math.min(
                  Math.max(selectionBounds.bottom + 10, 16),
                  window.innerHeight - 64,
                ),
              }
            : undefined,
      },
    }),
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function scrollToPdfPosition(
  root: HTMLElement,
  pageElements: Array<HTMLDivElement | null>,
  pageMetrics: PageMetric[],
  pageCount: number,
  position: Extract<Position, { type: 'pdf' }>,
): void {
  const pageIndex = clamp(position.locator - 1, 0, pageMetrics.length - 1);
  const pageEl = pageElements[pageIndex];
  const pageMetric = pageMetrics[pageIndex];
  if (!pageEl || !pageMetric) return;

  const absolutePageFraction = clamp(position.fraction, 0, 1) * pageCount;
  const localPageFraction = clamp(absolutePageFraction - pageIndex, 0, 1);
  const pageOffset = pageEl.offsetTop;
  const intraPageOffset = pageMetric.height * localPageFraction;
  const maxScrollTop = Math.max(root.scrollHeight - root.clientHeight, 0);
  const targetScrollTop = clamp(pageOffset + intraPageOffset, 0, maxScrollTop);

  root.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
}
