import type { Book as EpubBook, NavItem } from 'epubjs';
import type { Position } from './positionShape';
import type {
  ReaderNavItem,
  ReaderSearchResult,
} from '../screens/Reader/readerSupport';

interface SpineItemLike {
  href?: string;
  index?: number;
  idref?: string;
  linear?: string;
}

interface SpineLike {
  spineItems?: SpineItemLike[];
  each?: (callback: (item: SpineItemLike) => void) => void;
}

export interface EpubSearchSection {
  id: string;
  label: string;
  href: string;
  text: string;
  position: Position;
}

export function buildEpubNavItems(epubBook: EpubBook): ReaderNavItem[] {
  const spineItems = getSpineItems(epubBook);
  const navItems = spineItems
    .filter((item) => item.linear !== 'no')
    .map((item, index) => {
      const href = item.href ?? '';
      const label =
        index === 0
          ? 'Cover'
          : findNavLabel(epubBook.navigation.toc, href) ??
            readableSpineLabel(item, index);
      const position = makeHrefPosition(epubBook, href, label, index);

      return {
        id: `${index}:${href || item.idref || label}`,
        label,
        kind: index === 0 ? ('cover' as const) : ('chapter' as const),
        progress: position.fraction,
        position,
      };
    });

  if (navItems.length === 0) {
    return [
      {
        id: 'cover:start',
        label: 'Cover',
        kind: 'cover',
        progress: 0,
        position: { type: 'epub', locator: '', fraction: 0, label: 'Cover' },
      },
    ];
  }

  return navItems;
}

export async function buildEpubSearchSections(
  epubBook: EpubBook,
  navItems: ReaderNavItem[],
): Promise<EpubSearchSection[]> {
  const spineItems = getSpineItems(epubBook).filter((item) => item.linear !== 'no');
  const sections: EpubSearchSection[] = [];

  for (let index = 0; index < spineItems.length; index += 1) {
    const spineItem = spineItems[index];
    const href = spineItem.href;
    if (!href) continue;

    const navItem = navItems[index];
    const fallbackLabel = readableSpineLabel(spineItem, index);
    let text = '';
    try {
      text = await loadSectionText(epubBook, href);
    } catch {
      continue;
    }

    if (!text.trim()) continue;

    sections.push({
      id: navItem?.id ?? `${index}:${href}`,
      label: navItem?.label ?? fallbackLabel,
      href,
      text,
      position:
        navItem?.position ?? makeHrefPosition(epubBook, href, fallbackLabel, index),
    });
  }

  return sections;
}

export function searchEpubSections(
  sections: EpubSearchSection[],
  rawQuery: string,
  limit = 12,
): ReaderSearchResult[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return [];

  const results: ReaderSearchResult[] = [];
  for (const section of sections) {
    const haystack = section.text.toLocaleLowerCase();
    const index = haystack.indexOf(query);
    if (index === -1) continue;

    results.push({
      id: `${section.id}:${index}`,
      label: section.label,
      snippet: makeSnippet(section.text, index, rawQuery.trim().length),
      position: section.position,
    });

    if (results.length >= limit) break;
  }

  return results;
}

function getSpineItems(epubBook: EpubBook): SpineItemLike[] {
  const spine = epubBook.spine as unknown as SpineLike;
  if (Array.isArray(spine.spineItems)) return spine.spineItems;

  const items: SpineItemLike[] = [];
  if (typeof spine.each === 'function') {
    spine.each((item) => items.push(item));
  }

  return items;
}

function makeHrefPosition(
  epubBook: EpubBook,
  href: string,
  label: string,
  index: number,
): Extract<Position, { type: 'epub' }> {
  let fraction = 0;

  try {
    const spineLength = Math.max(getSpineItems(epubBook).length, 1);
    fraction = index / spineLength;
  } catch {
    fraction = 0;
  }

  return {
    type: 'epub',
    locator: href,
    fraction,
    label,
  };
}

async function loadSectionText(epubBook: EpubBook, href: string): Promise<string> {
  const loaded = await epubBook.load(href);
  const doc = loaded as Document | XMLDocument | string;

  if (typeof doc === 'string') {
    return new DOMParser().parseFromString(doc, 'text/html').body.textContent ?? '';
  }

  return doc.documentElement?.textContent ?? '';
}

function readableSpineLabel(item: SpineItemLike, index: number): string {
  const raw = item.idref || item.href || '';
  const base = raw.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
  const cleaned = base.replace(/[-_]+/g, ' ').trim();

  if (cleaned) {
    return cleaned.replace(/\b\w/g, (char) => char.toLocaleUpperCase());
  }

  return `Chapter ${index + 1}`;
}

function findNavLabel(items: NavItem[], href: string): string | null {
  const target = stripFragment(href);
  const exact = findInToc(items, (item) => stripFragment(item.href) === target);
  if (exact) return exact;

  const targetBasename = basename(target);
  return findInToc(
    items,
    (item) => basename(stripFragment(item.href)) === targetBasename,
  );
}

function findInToc(
  items: NavItem[],
  match: (item: NavItem) => boolean,
): string | null {
  for (const item of items) {
    if (match(item)) return item.label;
    if (item.subitems?.length) {
      const child = findInToc(item.subitems, match);
      if (child) return child;
    }
  }

  return null;
}

function stripFragment(href: string): string {
  const hashIdx = href.indexOf('#');
  return hashIdx === -1 ? href : href.slice(0, hashIdx);
}

function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

function makeSnippet(text: string, index: number, queryLength: number): string {
  const start = Math.max(index - 48, 0);
  const end = Math.min(index + queryLength + 80, text.length);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  const normalized = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${prefix}${normalized}${suffix}`;
}
