// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  searchEpubSections,
  type EpubSearchSection,
} from '../../src/lib/epubReaderIndex';

const sections: EpubSearchSection[] = [
  {
    id: '1',
    label: 'Chapter One',
    href: 'chapter-1.xhtml',
    text: 'The quick brown fox studies marginalia carefully.',
    position: {
      type: 'epub',
      locator: 'chapter-1.xhtml',
      fraction: 0.1,
      label: 'Chapter One',
    },
  },
  {
    id: '2',
    label: 'Chapter Two',
    href: 'chapter-2.xhtml',
    text: 'A reader searches the book for a remembered word.',
    position: {
      type: 'epub',
      locator: 'chapter-2.xhtml',
      fraction: 0.2,
      label: 'Chapter Two',
    },
  },
];

describe('searchEpubSections', () => {
  it('returns capped matching section snippets', () => {
    expect(searchEpubSections(sections, 'reader', 5)).toEqual([
      {
        id: '2:2',
        label: 'Chapter Two',
        snippet: 'A reader searches the book for a remembered word.',
        position: sections[1].position,
      },
    ]);
  });

  it('returns no results for blank input', () => {
    expect(searchEpubSections(sections, '   ')).toEqual([]);
  });
});
