import { invoke } from '@tauri-apps/api/core';

export type DefinitionSource = 'wordnet' | 'wiktionary';

export interface DefinitionSense {
  pos: string;
  gloss: string;
}

export interface DefinitionResult {
  word: string;
  source: DefinitionSource;
  senses: DefinitionSense[];
}

export class OfflineDictionaryError extends Error {
  constructor(message = 'Connect to the internet to define unknown words.') {
    super(message);
    this.name = 'OfflineDictionaryError';
  }
}

export class DefinitionNotFoundError extends Error {
  constructor(word: string) {
    super(`No definition found for "${word}".`);
    this.name = 'DefinitionNotFoundError';
  }
}

const WIKTIONARY_URL = 'https://en.wiktionary.org/api/rest_v1/page/definition/';

async function lookupWordnet(word: string): Promise<DefinitionSense[] | null> {
  try {
    const senses = await invoke<DefinitionSense[] | null>('lookup_wordnet', { word });
    if (!senses || senses.length === 0) return null;
    return senses;
  } catch (error) {
    console.warn('WordNet lookup failed:', error);
    return null;
  }
}

interface WiktionaryDef {
  definition: string;
  examples?: string[];
}

interface WiktionaryEntry {
  partOfSpeech: string;
  definitions: WiktionaryDef[];
}

function stripHtml(html: string): string {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

async function lookupWiktionary(word: string): Promise<DefinitionSense[] | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new OfflineDictionaryError();
  }

  let response: Response;
  try {
    response = await fetch(WIKTIONARY_URL + encodeURIComponent(word), {
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new OfflineDictionaryError();
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Wiktionary error ${response.status}`);
  }

  const json = (await response.json()) as Record<string, WiktionaryEntry[] | undefined>;
  const englishEntries = json.en;
  if (!englishEntries || englishEntries.length === 0) return null;

  const senses: DefinitionSense[] = [];
  for (const entry of englishEntries) {
    for (const def of entry.definitions.slice(0, 3)) {
      const gloss = stripHtml(def.definition);
      if (!gloss) continue;
      senses.push({ pos: entry.partOfSpeech.toLowerCase(), gloss });
    }
  }
  return senses.length > 0 ? senses : null;
}

export async function lookupWord(word: string): Promise<DefinitionResult> {
  const trimmed = word.trim();
  if (!trimmed) throw new DefinitionNotFoundError(word);

  const wordnet = await lookupWordnet(trimmed);
  if (wordnet) return { word: trimmed, source: 'wordnet', senses: wordnet };

  const wiktionary = await lookupWiktionary(trimmed);
  if (wiktionary) return { word: trimmed, source: 'wiktionary', senses: wiktionary };

  throw new DefinitionNotFoundError(trimmed);
}

export function formatSensesForStorage(senses: DefinitionSense[]): string {
  return senses
    .map((s) => {
      const tag = s.pos ? `(${s.pos}) ` : '';
      return `${tag}${s.gloss}`;
    })
    .join(' ');
}

export function parseStoredDefinition(definition: string): DefinitionSense[] {
  const text = definition.trim();
  if (!text) return [];

  const pattern = /\(([^)]+)\)\s*([^()]+?)(?=\s+\([^)]+\)\s*|$)/g;
  const senses: DefinitionSense[] = [];

  for (const match of text.matchAll(pattern)) {
    const pos = match[1]?.trim() ?? '';
    const gloss = match[2]?.trim() ?? '';
    if (!gloss) continue;
    senses.push({ pos, gloss });
  }

  if (senses.length > 0) return senses;
  return [{ pos: '', gloss: text }];
}
