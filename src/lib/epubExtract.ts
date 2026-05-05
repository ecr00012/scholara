import ePub from 'epubjs';
import { saveCoverBytes } from '../ipc/files';

export interface EpubMetadataResult {
  title?: string;
  author: string | null;
  cover_image_path: string | null;
}

export async function extractEpubMetadata(
  bytes: ArrayBuffer,
  bookId: number,
): Promise<EpubMetadataResult> {
  const book = ePub(bytes);
  await book.ready;

  const meta = book.packaging.metadata as { title?: string; creator?: string };
  const titleRaw = (meta.title ?? '').trim();
  const authorRaw = (meta.creator ?? '').trim();

  let coverPath: string | null = null;
  try {
    const url = await book.coverUrl();
    if (url) {
      const blob = await (await fetch(url)).blob();
      const ext: 'png' | 'webp' | 'jpg' =
          blob.type === 'image/png'  ? 'png'
        : blob.type === 'image/webp' ? 'webp'
        : 'jpg';
      const buf = await blob.arrayBuffer();
      coverPath = await saveCoverBytes(bookId, buf, ext);
    }
  } catch {
    // Missing/broken cover is common — accepted.
  }

  return {
    ...(titleRaw ? { title: titleRaw } : {}),
    author: authorRaw || null,
    cover_image_path: coverPath,
  };
}
