import type { NoteRow } from '../../../db/types';
import { isQuoteRange, type PdfQuoteRange } from '../../../lib/positionShape';
import {
  pdfRectToViewportRect,
  type ViewRect,
  type ViewportLike,
} from '../../../lib/pdfRectTransform';
import {
  ANNOTATION_UNDERLINE_PX,
  ORANGE,
  SUBSCRIPT_INLINE_STYLE,
} from '../../../lib/theme';

export function applyPdfAnnotations(
  pageNumber: number,
  pageContainer: HTMLElement,
  pageViewport: ViewportLike & { width: number; height: number },
  notes: NoteRow[],
): void {
  pageContainer.querySelectorAll('.scholara-annotation').forEach((node) => {
    node.remove();
  });

  let positionNoteCount = 0;
  let lastQuoteRectOnThisPage: ViewRect | null = null;
  let lastQuoteEndsOnThisPage = false;

  for (const note of notes) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(note.page_or_position);
    } catch {
      continue;
    }

    if (note.quote_text && isPdfQuoteRange(parsed)) {
      const onThisPage = parsed.pages.find((page) => page.page === pageNumber);
      if (!onThisPage) continue;

      const lastPage = parsed.pages[parsed.pages.length - 1];
      const quoteEndsOnThisPage = lastPage?.page === pageNumber;

      for (const rect of onThisPage.rects) {
        const viewRect = pdfRectToViewportRect(rect, pageViewport);
        const underline = document.createElement('div');
        underline.className = 'scholara-annotation scholara-quote-underline';
        underline.dataset.noteId = String(note.id);
        underline.style.cssText = [
          'position: absolute',
          `left: ${viewRect.x}px`,
          `top: ${viewRect.y + viewRect.h - ANNOTATION_UNDERLINE_PX}px`,
          `width: ${viewRect.w}px`,
          `height: ${ANNOTATION_UNDERLINE_PX}px`,
          `background: ${ORANGE}`,
          'pointer-events: auto',
          'cursor: pointer',
        ].join(';');
        pageContainer.appendChild(underline);

        if (quoteEndsOnThisPage) {
          lastQuoteRectOnThisPage = viewRect;
          lastQuoteEndsOnThisPage = true;
        }
      }

      continue;
    }

    if (
      !note.quote_text &&
      parsed &&
      typeof parsed === 'object' &&
      'type' in parsed &&
      'locator' in parsed &&
      parsed.type === 'pdf' &&
      parsed.locator === pageNumber
    ) {
      positionNoteCount += 1;
    }
  }

  if (lastQuoteRectOnThisPage && lastQuoteEndsOnThisPage) {
    const quoteSup = document.createElement('span');
    quoteSup.className = 'scholara-annotation';
    Object.assign(quoteSup.style, {
      position: 'absolute',
      left: `${lastQuoteRectOnThisPage.x + lastQuoteRectOnThisPage.w + 2}px`,
      top: `${lastQuoteRectOnThisPage.y - 2}px`,
      ...SUBSCRIPT_INLINE_STYLE,
    });
    quoteSup.textContent = '1';
    pageContainer.appendChild(quoteSup);
  }

  if (positionNoteCount > 0) {
    const positionSup = document.createElement('span');
    positionSup.className = 'scholara-annotation';
    Object.assign(positionSup.style, {
      position: 'absolute',
      right: '8px',
      top: '8px',
      ...SUBSCRIPT_INLINE_STYLE,
    });
    positionSup.textContent = String(positionNoteCount);
    pageContainer.appendChild(positionSup);
  }
}

function isPdfQuoteRange(parsed: unknown): parsed is PdfQuoteRange {
  return isQuoteRange(parsed) && parsed.start.type === 'pdf' && 'pages' in parsed;
}
