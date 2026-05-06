import type { Rendition } from 'epubjs';
import type { NoteRow } from '../../../db/types';
import { isQuoteRange, type EpubQuoteRange } from '../../../lib/positionShape';

export function applyEpubAnnotations(
  rendition: Rendition,
  notes: NoteRow[],
  onOpenNote?: (noteId: number) => void,
): { detach(): void } {
  const cfis: string[] = [];

  for (const note of notes) {
    if (!note.quote_text) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(note.page_or_position);
    } catch {
      continue;
    }

    if (!isQuoteRange(parsed) || parsed.start.type !== 'epub') {
      continue;
    }

    const epubRange = parsed as EpubQuoteRange;

    // Prefer the canonical range CFI emitted by `contents.cfiFromRange(...)`.
    // Older notes (saved before `cfiRange` was added) only have collapsed
    // start/end CFIs — fall back to a best-effort comma join so they at least
    // surface in the rendition's annotation store, even if epub.js may not
    // resolve them to a real DOM range.
    const cfi =
      epubRange.cfiRange ??
      `${epubRange.start.locator},${epubRange.end.locator}`;
    cfis.push(cfi);

    // Styling lives in the app's parent-document stylesheet (src/index.css).
    // marks-pane mounts its SVG layer over the iframe in the parent DOM, so
    // iframe CSS can't reach these nodes. Without those rules, epub.js's
    // default stroke:black on the parent <g> inherits to the per-rect <rect>
    // and renders as a box around the selection.
    rendition.annotations.add(
      'underline',
      cfi,
      { noteId: note.id },
      () => onOpenNote?.(note.id),
      'scholara-quote-underline',
      {},
    );
  }

  return {
    detach: () => {
      for (const cfi of cfis) {
        try {
          rendition.annotations.remove(cfi, 'underline');
        } catch {
          // epub.js can throw if a view was already torn down; safe to ignore.
        }
      }
    },
  };
}
