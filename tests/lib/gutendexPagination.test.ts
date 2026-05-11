import { describe, it, expect } from 'vitest';
import type { GutenbergBook } from '../../src/lib/gutenbergApi';
import {
  cursorToPageSlice,
  GUTENDEX_PAGE_SIZE,
  needsSecondPage,
  slicePages,
} from '../../src/lib/gutendexPagination';

function makeBook(id: number): GutenbergBook {
  return {
    id,
    title: `Book ${id}`,
    authors: [{ name: `Author ${id}` }],
    subjects: [],
    bookshelves: [],
    download_count: 0,
    cover_image: null,
    issued: null,
    reading_ease_score: null,
  };
}

const page1 = Array.from({ length: GUTENDEX_PAGE_SIZE }, (_, index) => makeBook(index + 1));
const page2 = Array.from({ length: GUTENDEX_PAGE_SIZE }, (_, index) => makeBook(index + 33));

describe('lib/gutendexPagination', () => {
  it('maps cursor 0 to page 1, slice 0', () => {
    expect(cursorToPageSlice(0)).toEqual({ page: 1, slice: 0 });
  });

  it('maps cursor 28 to page 1, slice 28', () => {
    expect(cursorToPageSlice(28)).toEqual({ page: 1, slice: 28 });
  });

  it('maps cursor 32 to page 2, slice 0', () => {
    expect(cursorToPageSlice(32)).toEqual({ page: 2, slice: 0 });
  });

  it('maps cursor 396 to page 13, slice 12', () => {
    expect(cursorToPageSlice(396)).toEqual({ page: 13, slice: 12 });
  });

  it('does not request a second page for production cursor strides', () => {
    for (let cursor = 0; cursor < 400; cursor += 4) {
      const { slice } = cursorToPageSlice(cursor);
      expect(needsSecondPage(slice)).toBe(false);
    }
  });

  it('requests a second page when slice + 4 crosses 32', () => {
    expect(needsSecondPage(29)).toBe(true);
    expect(needsSecondPage(30)).toBe(true);
    expect(needsSecondPage(31)).toBe(true);
  });

  it('slices a 4-book window from one page when it fits', () => {
    const window = slicePages(8, page1);
    expect(window.map((book) => book.id)).toEqual([9, 10, 11, 12]);
  });

  it('concatenates across pages when the window straddles', () => {
    const window = slicePages(30, page1, page2);
    expect(window.map((book) => book.id)).toEqual([31, 32, 33, 34]);
  });

  it('returns fewer books if both pages are short', () => {
    const shortFirst = page1.slice(0, 16);
    const window = slicePages(14, shortFirst);
    expect(window.map((book) => book.id)).toEqual([15, 16]);
  });
});
