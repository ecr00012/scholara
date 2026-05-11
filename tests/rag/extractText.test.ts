// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { extractDocumentText, getEpubSpineItems } from '../../src/rag/extractText';

describe('getEpubSpineItems', () => {
  it('falls back to epub.js spine.each when no public item array is present', () => {
    const book = {
      spine: {
        each(callback: (item: { href?: string }) => void) {
          callback({ href: 'chapter-1.xhtml' });
          callback({});
          callback({ href: 'chapter-2.xhtml' });
        },
      },
    };

    expect(getEpubSpineItems(book)).toEqual([
      { href: 'chapter-1.xhtml' },
      { href: 'chapter-2.xhtml' },
    ]);
  });
});

describe('extractDocumentText', () => {
  it('extracts text from an element returned by epub.js section.load', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<!doctype html><html><body><p>Chapter text</p></body></html>');

    expect(extractDocumentText(dom.window.document.documentElement)).toBe(
      'Chapter text',
    );
  });
});
