import type { Rendition } from 'epubjs';
import type { NoteRow } from '../../../db/types';
import { ANNOTATION_UNDERLINE_PX, ORANGE } from '../../../lib/theme';
import { isQuoteRange } from '../../../lib/positionShape';

export function applyEpubAnnotations(
  rendition: Rendition,
  notes: NoteRow[],
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

    const cfi = `${parsed.start.locator},${parsed.end.locator}`;
    cfis.push(cfi);

    rendition.annotations.add(
      'underline',
      cfi,
      { noteId: note.id },
      undefined,
      'scholara-quote-underline',
      {
        'text-decoration-color': ORANGE,
        'text-decoration-thickness': `${ANNOTATION_UNDERLINE_PX}px`,
      },
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
