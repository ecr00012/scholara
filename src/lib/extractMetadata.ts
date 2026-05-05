import { getDb } from '../db/client';
import * as booksDb from '../db/books';
import { readBookBytes } from '../ipc/files';
import { extractEpubMetadata } from './epubExtract';
import { extractPdfMetadata } from './pdfExtract';
import type { Book } from '../db/types';

interface PassDriver {
  extractionInFlight: Set<number>;
  patchBook(id: number, patch: Partial<Book>): void;
}

export async function runMetadataExtractionPass(driver: PassDriver): Promise<void> {
  const db = await getDb();
  const candidates = await booksDb.listBooksNeedingExtraction(db);

  for (const book of candidates) {
    if (driver.extractionInFlight.has(book.id)) continue;
    driver.extractionInFlight.add(book.id);

    try {
      const bytes = await readBookBytes(book.file_path);
      const result =
        book.file_type === 'epub'
          ? await extractEpubMetadata(bytes, book.id)
          : await extractPdfMetadata(bytes, book.id);

      await booksDb.setExtractedMetadata(db, book.id, result);
      driver.patchBook(book.id, {
        ...result,
        metadata_source: 'extracted',
      });
    } catch (err) {
      console.warn(`Metadata extraction failed for book ${book.id}:`, err);
      // No DB write — book retries next boot.
    } finally {
      driver.extractionInFlight.delete(book.id);
    }
  }
}
