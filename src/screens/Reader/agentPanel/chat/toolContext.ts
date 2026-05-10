import type { Book } from '../../../../db/types';
import type { Position } from '../../../../lib/positionShape';
import { getDb } from '../../../../db/client';
import { loadChunksForBook } from '../../../../db/bookChunks';
import {
  extractPdfSegments,
  extractEpubSegments,
  resolveEpubSectionHref,
} from '../../../../rag/extractText';
import { readBookBytes } from '../../../../ipc/files';
import type { ToolContext } from '../../../../agent/tools/registry';
import type { ChunkOrdinalIndex } from '../../../../agent/spoilerGuard';
import ePub from 'epubjs';

const PAGE_RADIUS = 1; // current ± 1 page

export interface ToolContextBundle {
  toolContext: ToolContext;
  currentPageText: string;
}

export async function buildToolContext(
  book: Book,
  position: Position | null,
  spoilerEnabled: boolean,
): Promise<ToolContextBundle> {
  const db = await getDb();
  const chunks = await loadChunksForBook(db, book.id, null);
  if (chunks.length === 0) {
    console.warn(
      `[buildToolContext] no indexed chunks found for book ${book.id}; search_book will return no passages until indexing is repaired.`,
    );
  }

  // Build the ordinal index used by spoiler guard.
  const index: ChunkOrdinalIndex = {};
  if (book.file_type === 'pdf') {
    index.pdf = chunks.map((c) => ({ ordinal: c.ordinal, page: parseInt(c.position_marker, 10) || 0 }));
  } else {
    // For EPUB, the position_marker is the spine href; map to a fraction by
    // ordinal-uniform spacing as a fallback. This is acceptable because the
    // chunk's ordinal is what spoiler guard ultimately uses for SQL filtering;
    // the fraction comparison only needs to be monotonic.
    const total = Math.max(chunks.length, 1);
    index.epub = chunks.map((c, i) => ({
      ordinal: c.ordinal,
      href: c.position_marker,
      fraction: i / total,
    }));
  }

  const currentPageText = await extractCurrentPageText(book, position);
  if (position && currentPageText.trim().length === 0) {
    console.warn(
      `[buildToolContext] no current page text resolved for book ${book.id} at ${position.type}:${position.locator}`,
    );
  }

  return {
    currentPageText,
    toolContext: {
      bookId: book.id,
      // Without a known position, capping is meaningless and would zero out
      // the searchable space — so disable it until a position is hydrated.
      spoilerCap: { enabled: spoilerEnabled && position !== null, position, index },
    },
  };
}

async function extractCurrentPageText(book: Book, position: Position | null): Promise<string> {
  if (!position) return '';
  try {
    const bytes = await readBookBytes(book.file_path);
    if (book.file_type === 'pdf' && position.type === 'pdf') {
      const segments = await extractPdfSegments(bytes);
      const idx = segments.findIndex((s) => parseInt(s.positionMarker, 10) === position.locator);
      if (idx === -1) return '';
      const lo = Math.max(0, idx - PAGE_RADIUS);
      const hi = Math.min(segments.length - 1, idx + PAGE_RADIUS);
      return segments.slice(lo, hi + 1).map((s) => s.text).join('\n\n');
    }
    if (book.file_type === 'epub' && position.type === 'epub') {
      const segments = await extractEpubSegments(bytes);
      const epubBook = ePub(bytes);
      let href: string | null = null;
      try {
        await epubBook.ready;
        href = resolveEpubSectionHref(epubBook, position.locator);
      } finally {
        epubBook.destroy();
      }
      const idx = href
        ? segments.findIndex(
            (s) =>
              stripFragment(s.positionMarker) === href ||
              href.endsWith(stripFragment(s.positionMarker)) ||
              stripFragment(s.positionMarker).endsWith(href),
          )
        : -1;
      if (idx === -1) return segments[0]?.text.slice(0, 6000) ?? '';
      const lo = Math.max(0, idx - PAGE_RADIUS);
      const hi = Math.min(segments.length - 1, idx + PAGE_RADIUS);
      return segments.slice(lo, hi + 1).map((s) => s.text).join('\n\n');
    }
  } catch (err) {
    console.warn('[buildToolContext] currentPageText extraction failed:', err);
  }
  return '';
}

function stripFragment(href: string): string {
  const hashIdx = href.indexOf('#');
  return hashIdx === -1 ? href : href.slice(0, hashIdx);
}
