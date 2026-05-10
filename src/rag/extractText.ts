import * as pdfjs from 'pdfjs-dist';
import ePub from 'epubjs';
import { initPdfWorker } from '../lib/pdfWorker';
import type { RawSegment } from './chunker';

interface EpubSpineItemLike {
  href: string;
  index?: number;
}

interface EpubSectionLike {
  href: string;
  load: (req: unknown) => Promise<Document>;
}

interface EpubSpineLike {
  items?: EpubSpineItemLike[];
  spineItems?: EpubSpineItemLike[];
  get?: (target: string | number) => EpubSectionLike | null;
}

export async function extractPdfSegments(bytes: ArrayBuffer): Promise<RawSegment[]> {
  initPdfWorker();
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const segments: RawSegment[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ('str' in it ? (it as { str: string }).str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) segments.push({ positionMarker: String(pageNum), text });
  }
  return segments;
}

export async function extractEpubSegments(bytes: ArrayBuffer): Promise<RawSegment[]> {
  const book = ePub(bytes);
  try {
    await book.ready;
    const segments: RawSegment[] = [];
    for (const item of getEpubSpineItems(book)) {
      const section = getEpubSection(book, item);
      if (!section || typeof section.load !== 'function') {
        console.warn(`[extractEpubSegments] no loadable section for ${item.href}`);
        continue;
      }
      try {
        const doc = await section.load(book.load.bind(book));
        const text = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text) segments.push({ positionMarker: item.href, text });
      } catch (err) {
        console.warn(`[extractEpubSegments] failed to load ${item.href}:`, err);
      }
    }
    return segments;
  } finally {
    book.destroy();
  }
}

export function getEpubSpineItems(book: unknown): EpubSpineItemLike[] {
  const spine = (book as { spine?: EpubSpineLike }).spine;
  if (!spine) return [];
  if (Array.isArray(spine.items)) return spine.items;
  if (Array.isArray(spine.spineItems)) return spine.spineItems;
  return [];
}

export function resolveEpubSectionHref(
  book: unknown,
  locator: string,
): string | null {
  if (!locator) return null;
  if (!locator.startsWith('epubcfi(')) return stripFragment(locator);

  const spine = (book as { spine?: EpubSpineLike }).spine;
  const section = spine?.get?.(locator);
  return section?.href ? stripFragment(section.href) : null;
}

function getEpubSection(
  book: unknown,
  item: EpubSpineItemLike,
): EpubSectionLike | null {
  const spine = (book as { spine?: EpubSpineLike }).spine;
  if (typeof spine?.get !== 'function') return null;
  return spine.get(item.href) ?? (typeof item.index === 'number' ? spine.get(item.index) : null);
}

function stripFragment(href: string): string {
  const hashIdx = href.indexOf('#');
  return hashIdx === -1 ? href : href.slice(0, hashIdx);
}
