import { invoke } from '@tauri-apps/api/core';

export interface SecretDiagnostic {
  service: string;
  account: string;
  diagnostic_account: string;
  existing_entry: boolean;
  status: string;
  error: string | null;
}

export async function getSecret(name: string): Promise<string | null> {
  return invoke<string | null>('get_secret', { name });
}

export async function setSecret(name: string, value: string): Promise<void> {
  await invoke('set_secret', { name, value });
}

export async function diagnoseSecret(
  name: string,
): Promise<SecretDiagnostic> {
  return invoke<SecretDiagnostic>('diagnose_secret', { name });
}
