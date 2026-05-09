import * as pdfjs from 'pdfjs-dist';
import ePub from 'epubjs';
import { initPdfWorker } from '../lib/pdfWorker';
import type { RawSegment } from './chunker';

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
  await book.ready;
  const spine = (
    book.spine as unknown as {
      items: Array<{ href: string; load: (req: unknown) => Promise<Document> }>;
    }
  ).items;
  const segments: RawSegment[] = [];
  for (const item of spine) {
    try {
      const doc = await item.load(book.load.bind(book));
      const text = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) segments.push({ positionMarker: item.href, text });
    } catch (err) {
      console.warn(`[extractEpubSegments] failed to load ${item.href}:`, err);
    }
  }
  return segments;
}
