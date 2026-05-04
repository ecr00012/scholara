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
