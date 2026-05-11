import * as pdfjs from 'pdfjs-dist';
import ePub from 'epubjs';
import { initPdfWorker } from '../lib/pdfWorker';
import type { RawSegment } from './chunker';

interface EpubSpineItemLike {
  href?: string;
  index?: number;
  linear?: string;
}

interface EpubSectionLike {
  href: string;
  load: (req: unknown) => Promise<EpubLoadedContent>;
}

interface EpubSpineLike {
  items?: EpubSpineItemLike[];
  spineItems?: EpubSpineItemLike[];
  each?: (callback: (item: EpubSpineItemLike) => void) => void;
  get?: (target: string | number) => EpubSectionLike | null;
}

type EpubLoadedContent = Document | XMLDocument | Element | string;

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
    const spineItems = getEpubSpineItems(book).filter(
      (item) => item.href && item.linear !== 'no',
    );
    let loadedCount = 0;
    let emptyCount = 0;
    let failedCount = 0;

    for (const item of spineItems) {
      if (!item.href || item.linear === 'no') continue;
      const section = getEpubSection(book, item);
      try {
        const doc = section && typeof section.load === 'function'
          ? await section.load(book.load.bind(book))
          : await book.load(item.href);
        loadedCount += 1;
        const text = extractDocumentText(doc as EpubLoadedContent);
        if (text) {
          segments.push({ positionMarker: item.href, text });
        } else {
          emptyCount += 1;
        }
      } catch (err) {
        failedCount += 1;
        console.warn(`[extractEpubSegments] failed to load ${item.href}:`, err);
      }
    }
    if (spineItems.length > 0 && segments.length === 0) {
      console.warn(
        `[extractEpubSegments] no text extracted: spineItems=${spineItems.length}, loaded=${loadedCount}, empty=${emptyCount}, failed=${failedCount}`,
      );
    }
    return segments;
  } finally {
    book.destroy();
  }
}

export function getEpubSpineItems(book: unknown): EpubSpineItemLike[] {
  const spine = (book as { spine?: EpubSpineLike }).spine;
  if (!spine) return [];
  if (Array.isArray(spine.items)) return spine.items.filter(hasHref);
  if (Array.isArray(spine.spineItems)) return spine.spineItems.filter(hasHref);
  if (typeof spine.each !== 'function') return [];

  const items: EpubSpineItemLike[] = [];
  spine.each((item) => {
    if (item.href) items.push(item);
  });
  return items;
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
  return item.href
    ? spine.get(item.href) ?? (typeof item.index === 'number' ? spine.get(item.index) : null)
    : null;
}

function stripFragment(href: string): string {
  const hashIdx = href.indexOf('#');
  return hashIdx === -1 ? href : href.slice(0, hashIdx);
}

export function extractDocumentText(doc: EpubLoadedContent): string {
  let raw: string | null | undefined;
  if (typeof doc === 'string') {
    raw = new DOMParser().parseFromString(doc, 'text/html').body.textContent;
  } else if ('documentElement' in doc) {
    raw = doc.documentElement?.textContent ?? doc.body?.textContent;
  } else {
    raw = doc.textContent;
  }

  return (raw ?? '').replace(/\s+/g, ' ').trim();
}

function hasHref(item: EpubSpineItemLike): item is EpubSpineItemLike & { href: string } {
  return typeof item.href === 'string' && item.href.length > 0;
}
