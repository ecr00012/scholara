import { invoke } from '@tauri-apps/api/core';
import type { FileType } from '../db/types';

interface CopyResult {
  stored_path: string;
  file_type: FileType;
}

export async function copyUploadedFile(
  sourcePath: string,
): Promise<{ storedPath: string; fileType: FileType }> {
  const result = await invoke<CopyResult>('copy_uploaded_file', {
    sourcePath,
  });
  return { storedPath: result.stored_path, fileType: result.file_type };
}

export async function appDataDirPath(): Promise<string> {
  return invoke<string>('app_data_dir_path');
}

export async function revealInFileManager(path: string): Promise<void> {
  await invoke('reveal_in_file_manager', { path });
}

export async function readBookBytes(path: string): Promise<ArrayBuffer> {
  const bytes = await invoke<number[]>('read_book_bytes', { path });
  // Tauri serializes Vec<u8> as a JS number[]. Convert to a tight ArrayBuffer.
  const view = new Uint8Array(bytes);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

export async function saveCoverBytes(
  bookId: number,
  bytes: ArrayBuffer,
  ext: 'jpg' | 'jpeg' | 'png' | 'webp',
): Promise<string> {
  // The Tauri IPC layer accepts a number[] for Vec<u8>. Convert here.
  const arr = Array.from(new Uint8Array(bytes));
  return invoke<string>('save_cover_bytes', { bookId, bytes: arr, ext });
}

export async function deleteBookFiles(
  bookId: number,
  filePath: string,
): Promise<void> {
  await invoke('delete_book_files', { bookId, filePath });
}
