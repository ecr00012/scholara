import { invoke } from '@tauri-apps/api/core';

export async function getApiKey(): Promise<string | null> {
  return invoke<string | null>('get_api_key');
}

export async function setApiKey(key: string): Promise<void> {
  await invoke('set_api_key', { key });
}
