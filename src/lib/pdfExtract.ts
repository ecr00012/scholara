import * as pdfjs from 'pdfjs-dist';
import { initPdfWorker } from './pdfWorker';
import { saveCoverBytes } from '../ipc/files';

export interface PdfMetadataResult {
  author: string | null;
  cover_image_path: string | null;
}

export async function extractPdfMetadata(
  bytes: ArrayBuffer,
  bookId: number,
): Promise<PdfMetadataResult> {
  initPdfWorker();
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;

  const info = ((await pdf.getMetadata()).info ?? {}) as { Author?: string };
  const author = (info.Author ?? '').trim() || null;

  let coverPath: string | null = null;
  try {
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const targetWidth = 600;
    const scale = targetWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png'),
      );
      if (blob) {
        coverPath = await saveCoverBytes(bookId, await blob.arrayBuffer(), 'png');
      }
    }
  } catch {
    // Encrypted/corrupt PDFs — leave cover null.
  }

  return { author, cover_image_path: coverPath };
}
