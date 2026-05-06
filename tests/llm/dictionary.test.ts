// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  DefinitionNotFoundError,
  formatSensesForStorage,
  lookupWord,
  OfflineDictionaryError,
} from '../../src/dictionary/lookup';

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;
const realOnLine = Object.getOwnPropertyDescriptor(globalThis.navigator ?? {}, 'onLine');

beforeEach(() => {
  invokeMock.mockReset();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  if (globalThis.navigator) {
    Object.defineProperty(globalThis.navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realOnLine && globalThis.navigator) {
    Object.defineProperty(globalThis.navigator, 'onLine', realOnLine);
  }
});

describe('lookupWord', () => {
  it('returns a wordnet result on hit and skips Wiktionary', async () => {
    invokeMock.mockResolvedValueOnce([
      { pos: 'noun', gloss: 'a happy accident' },
    ]);

    const result = await lookupWord('serendipity');
    expect(result.source).toBe('wordnet');
    expect(result.senses).toHaveLength(1);
    expect(invokeMock).toHaveBeenCalledWith('lookup_wordnet', { word: 'serendipity' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to Wiktionary when WordNet returns null', async () => {
    invokeMock.mockResolvedValueOnce(null);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        en: [
          {
            partOfSpeech: 'Noun',
            definitions: [
              { definition: 'A made-up word.' },
              { definition: 'Another <i>sense</i>.' },
            ],
          },
        ],
      }),
    });

    const result = await lookupWord('flibberty');
    expect(result.source).toBe('wiktionary');
    expect(result.senses[0]).toEqual({ pos: 'noun', gloss: 'A made-up word.' });
    expect(result.senses[1].gloss).toBe('Another sense.');
  });

  it('throws DefinitionNotFoundError when both sources miss', async () => {
    invokeMock.mockResolvedValueOnce(null);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });

    await expect(lookupWord('zzzzznotaword')).rejects.toBeInstanceOf(
      DefinitionNotFoundError,
    );
  });

  it('throws OfflineDictionaryError when offline and WordNet misses', async () => {
    invokeMock.mockResolvedValueOnce(null);
    Object.defineProperty(globalThis.navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });

    await expect(lookupWord('anything')).rejects.toBeInstanceOf(OfflineDictionaryError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws OfflineDictionaryError when fetch itself fails (network)', async () => {
    invokeMock.mockResolvedValueOnce(null);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(lookupWord('anything')).rejects.toBeInstanceOf(OfflineDictionaryError);
  });
});

describe('formatSensesForStorage', () => {
  it('joins multiple senses with part-of-speech tags', () => {
    const out = formatSensesForStorage([
      { pos: 'noun', gloss: 'a thing' },
      { pos: 'verb', gloss: 'to do' },
    ]);
    expect(out).toBe('(noun) a thing (verb) to do');
  });
});
