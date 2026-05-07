import { invoke } from '@tauri-apps/api/core';

export interface DownloadEpubResult {
  storedPath: string;
  fileType: 'epub';
}

interface RawDownloadResult {
  stored_path: string;
  file_type: string;
}

export async function downloadGutenbergEpub(
  bookId: number,
): Promise<DownloadEpubResult> {
  const result = await invoke<RawDownloadResult>('download_gutenberg_epub', {
    bookId,
  });
  return {
    storedPath: result.stored_path,
    fileType: 'epub',
  };
}
