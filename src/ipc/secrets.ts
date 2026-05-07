import { invoke } from '@tauri-apps/api/core';

export async function getSecret(name: string): Promise<string | null> {
  return invoke<string | null>('get_secret', { name });
}

export async function setSecret(name: string, value: string): Promise<void> {
  await invoke('set_secret', { name, value });
}
