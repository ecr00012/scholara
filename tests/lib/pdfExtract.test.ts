// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('../../src/ipc/files', () => ({
  saveCoverBytes: vi.fn(async () => '/covers/1.png'),
}));

vi.mock('../../src/lib/pdfWorker', () => ({
  initPdfWorker: vi.fn(),
}));

import { extractPdfMetadata } from '../../src/lib/pdfExtract';

const SAMPLE = readFileSync(path.resolve(__dirname, '../fixtures/sample.pdf'));
const NO_AUTHOR = readFileSync(path.resolve(__dirname, '../fixtures/sample-no-author.pdf'));

describe('extractPdfMetadata', () => {
  it('extracts author when PDF has /Author', async () => {
    const ab = SAMPLE.buffer.slice(SAMPLE.byteOffset, SAMPLE.byteOffset + SAMPLE.byteLength);
    const result = await extractPdfMetadata(ab, 1);
    expect(result.author).toBe('Sample Author');
  });

  it('returns null author when PDF has no /Author', async () => {
    const ab = NO_AUTHOR.buffer.slice(NO_AUTHOR.byteOffset, NO_AUTHOR.byteOffset + NO_AUTHOR.byteLength);
    const result = await extractPdfMetadata(ab, 1);
    expect(result.author).toBeNull();
  });
});
