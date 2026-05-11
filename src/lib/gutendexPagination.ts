import type { GutenbergBook } from './gutenbergApi';

export const GUTENDEX_PAGE_SIZE = 32;
export const PANEL_WINDOW = 4;

export function cursorToPageSlice(cursor: number): {
  page: number;
  slice: number;
} {
  const page = Math.floor(cursor / GUTENDEX_PAGE_SIZE) + 1;
  const slice = cursor % GUTENDEX_PAGE_SIZE;
  return { page, slice };
}

export function needsSecondPage(slice: number): boolean {
  return slice + PANEL_WINDOW > GUTENDEX_PAGE_SIZE;
}

export function slicePages(
  slice: number,
  firstPage: GutenbergBook[],
  secondPage?: GutenbergBook[],
): GutenbergBook[] {
  const fromFirst = firstPage.slice(slice, slice + PANEL_WINDOW);
  if (fromFirst.length === PANEL_WINDOW) return fromFirst;

  const remaining = PANEL_WINDOW - fromFirst.length;
  const fromSecond = (secondPage ?? []).slice(0, remaining);
  return [...fromFirst, ...fromSecond];
}
