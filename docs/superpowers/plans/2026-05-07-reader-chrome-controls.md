# Reader Chrome Controls Implementation Plan

**Goal:** Add EPUB-only Reader Chrome controls for chapter navigation, notes/highlights chapter scope, text preferences, and book search with stable button placement.

**Architecture:** Reader Chrome owns the visible controls and lightweight popovers/modals. EPUB reader code builds navigation/search data and applies text preferences; PDF readers keep the existing behavior and do not expose the new controls. Shared types and store actions carry navigation items, search results, and preferences without coupling chrome to epub.js internals.

**Tech Stack:** Tauri + TypeScript + React, Zustand store, epub.js, shadcn/base-ui Dialog, Tailwind CSS, lucide-react icons, Vitest, Playwright.

---

## 1. File Structure

Create:

- `src/screens/Reader/readerSupport.ts`
  - Shared `ReaderNavItem`, `ReaderSearchResult`, `ReaderPreferences`, constants for `scholara:go-to-source`, and small helpers such as `dispatchReaderNavigation`.

- `src/screens/Reader/ChapterIndexPopover.tsx`
  - EPUB-only contents popover. Renders `Cover` and chapter items from store-provided nav items. Dispatches navigation on click.

- `src/screens/Reader/TextPreferencesDialog.tsx`
  - EPUB-only `Aa` modal. Updates `readerPreferences` in store.

- `src/screens/Reader/ReaderSearchPopover.tsx`
  - EPUB-only glass-style search box. Reads query/results/status from store and dispatches result navigation.

- `src/lib/epubReaderIndex.ts`
  - Pure-ish helpers for creating navigation items and searchable EPUB sections from epub.js objects. This file keeps epub.js type casting out of `EpubReader.tsx`.

Modify:

- `src/store.ts`
  - Add Reader Chrome support state: nav items, search query/results/status, preferences, and setters.

- `src/screens/Reader/ReaderChrome.tsx`
  - Replace `justify-between` with explicit three-zone layout. Add EPUB-only controls. Use `formatPositionLabel`.

- `src/screens/Reader/EpubReader.tsx`
  - Build nav/search data after `epubBook.ready`. Apply text preferences through epub.js themes/hooks. Reuse `GO_TO_SOURCE_EVENT`.

- `src/screens/Reader/PdfReader.tsx`
  - Clear reader support data for PDFs on mount so stale EPUB nav/search data cannot appear.

- `src/screens/Reader/agentPanel/AgentPanel.tsx`
  - Own the active notes scope. Show `☰ All Notes` / `☰ Chapter Label` scope control only for EPUB Notes/Highlights.

- `src/screens/Reader/agentPanel/NotesTab.tsx`
  - Accept selected scope and filter notes.

- `src/screens/Reader/agentPanel/HighlightsTab.tsx`
  - Accept selected scope and combine it with highlight filtering.

- `src/lib/positionShape.ts`
  - Add EPUB section comparison helpers for notes/highlights scoping.

- `tests/lib/positionShape.test.ts`
  - Unit coverage for EPUB scope matching.

- `tests/playwright/epub-reader.spec.ts`
  - Chrome placement, chapter index, text preferences, and search smoke coverage.

- `tests/playwright/notes-mode.spec.ts`
  - Notes/Highlights scope label and filtering coverage.

- `tests/playwright/pdf-reader.spec.ts`
  - Assert EPUB-only controls do not appear for PDFs.

Do not modify database schema or Tauri IPC for this feature.

---

## 2. Subagent Workflow

This feature requires subagent-driven development per `AGENT.md`.

Dispatch workers in this order:

1. Worker A: shared store/types and chrome shell.
2. Worker B: EPUB navigation/search/index data.
3. Worker C: Agent panel notes/highlights scope.
4. Worker D: EPUB text preferences.
5. Worker E: tests and polish.

Each worker must begin by reporting:

- Current behavior/root cause.
- Concise implementation plan.
- Files likely affected.

The orchestrator reviews that report before authorizing edits. Workers are not alone in the codebase and must not revert edits made by other workers.

Commit after each completed worker task.

---

## 3. Task A - Shared Reader Support State And Chrome Shell

**Owner:** Worker A.

**Write scope:**

- `src/screens/Reader/readerSupport.ts`
- `src/store.ts`
- `src/screens/Reader/ReaderChrome.tsx`
- `src/screens/Reader/ChapterIndexPopover.tsx`
- `src/screens/Reader/TextPreferencesDialog.tsx`
- `src/screens/Reader/ReaderSearchPopover.tsx`

### A.1 Add Shared Reader Support Types

Create `src/screens/Reader/readerSupport.ts`:

```ts
import type { Position } from '../../lib/positionShape';

export const GO_TO_SOURCE_EVENT = 'scholara:go-to-source';

export type ReaderNavItemKind = 'cover' | 'chapter';

export interface ReaderNavItem {
  id: string;
  label: string;
  position: Position;
  kind: ReaderNavItemKind;
  level?: number;
  progress?: number;
}

export interface ReaderSearchResult {
  id: string;
  label: string;
  snippet: string;
  position: Position;
}

export interface ReaderPreferences {
  fontScale: number;
  fontFamily: 'original' | 'arial' | 'georgia' | 'iowan';
}

export type ReaderSearchStatus = 'idle' | 'indexing' | 'ready' | 'empty';

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontScale: 100,
  fontFamily: 'original',
};

export function dispatchReaderNavigation(position: Position): void {
  window.dispatchEvent(new CustomEvent<Position>(GO_TO_SOURCE_EVENT, { detail: position }));
}
```

### A.2 Extend Store

Modify `src/store.ts`.

Add imports:

```ts
import type {
  ReaderNavItem,
  ReaderPreferences,
  ReaderSearchResult,
  ReaderSearchStatus,
} from './screens/Reader/readerSupport';
import { DEFAULT_READER_PREFERENCES } from './screens/Reader/readerSupport';
```

Add fields/actions to `AppState`:

```ts
  readerNavItems: ReaderNavItem[];
  readerSearchQuery: string;
  readerSearchResults: ReaderSearchResult[];
  readerSearchStatus: ReaderSearchStatus;
  readerPreferences: ReaderPreferences;

  setReaderNavItems: (items: ReaderNavItem[]) => void;
  setReaderSearchQuery: (query: string) => void;
  setReaderSearchResults: (
    results: ReaderSearchResult[],
    status?: ReaderSearchStatus,
  ) => void;
  setReaderSearchStatus: (status: ReaderSearchStatus) => void;
  setReaderPreferences: (preferences: ReaderPreferences) => void;
  clearReaderSupport: () => void;
```

Add initial state:

```ts
  readerNavItems: [],
  readerSearchQuery: '',
  readerSearchResults: [],
  readerSearchStatus: 'idle',
  readerPreferences: DEFAULT_READER_PREFERENCES,
```

Add implementation:

```ts
  setReaderNavItems: (items) => set({ readerNavItems: items }),
  setReaderSearchQuery: (query) => set({ readerSearchQuery: query }),
  setReaderSearchResults: (results, status = 'ready') =>
    set({ readerSearchResults: results, readerSearchStatus: status }),
  setReaderSearchStatus: (status) => set({ readerSearchStatus: status }),
  setReaderPreferences: (preferences) => set({ readerPreferences: preferences }),
  clearReaderSupport: () =>
    set({
      readerNavItems: [],
      readerSearchQuery: '',
      readerSearchResults: [],
      readerSearchStatus: 'idle',
    }),
```

Call `clearReaderSupport()` inside `openBook` and `closeBook` state resets:

```ts
      readerNavItems: [],
      readerSearchQuery: '',
      readerSearchResults: [],
      readerSearchStatus: 'idle',
```

Keep `readerPreferences` global and do not clear it on book close.

### A.3 Add Chapter Index Popover

Create `src/screens/Reader/ChapterIndexPopover.tsx`:

```tsx
import { Check, Menu } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import { dispatchReaderNavigation } from './readerSupport';

interface Props {
  disabled: boolean;
}

export function ChapterIndexPopover({ disabled }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const items = useAppStore((state) => state.readerNavItems);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={disabled ? 'Chapter index is available for EPUB books' : 'Open contents'}
        title={disabled ? 'Chapter index is available for EPUB books' : 'Open contents'}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex size-8 items-center justify-center rounded-md text-ink-muted transition hover:bg-stone-100 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Menu className="h-4 w-4" />
      </button>
      {open && !disabled ? (
        <div
          ref={panelRef}
          className="absolute left-0 top-10 z-40 w-72 overflow-hidden rounded-lg border border-stone-200 bg-cream shadow-xl"
        >
          <div className="border-b border-stone-200 px-3 py-2 text-sm font-medium text-ink">
            Contents
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            {items.length === 0 ? (
              <p className="px-3 py-3 text-sm text-ink-muted">Contents loading...</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink transition hover:bg-white"
                  style={{ paddingLeft: `${12 + (item.level ?? 0) * 12}px` }}
                  onClick={() => {
                    dispatchReaderNavigation(item.position);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.progress !== undefined ? (
                    <span className="text-xs text-ink-muted">{Math.round(item.progress * 100)}%</span>
                  ) : null}
                  {item.kind === 'cover' ? <Check className="h-3.5 w-3.5 text-accent-orange" /> : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

### A.4 Add Text Preferences Dialog

Create `src/screens/Reader/TextPreferencesDialog.tsx`:

```tsx
import { Type } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAppStore } from '../../store';
import type { ReaderPreferences } from './readerSupport';

const FONT_OPTIONS: Array<{ value: ReaderPreferences['fontFamily']; label: string }> = [
  { value: 'original', label: 'Original' },
  { value: 'arial', label: 'Arial' },
  { value: 'georgia', label: 'Georgia' },
  { value: 'iowan', label: 'Iowan' },
];

interface Props {
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TextPreferencesDialog({ disabled, open, onOpenChange }: Props) {
  const preferences = useAppStore((state) => state.readerPreferences);
  const setReaderPreferences = useAppStore((state) => state.setReaderPreferences);

  const update = (patch: Partial<ReaderPreferences>) => {
    setReaderPreferences({ ...preferences, ...patch });
  };

  return (
    <>
      <button
        type="button"
        aria-label={disabled ? 'Text preferences are available for EPUB books' : 'Reading text preferences'}
        title={disabled ? 'Text preferences are available for EPUB books' : 'Reading text preferences'}
        disabled={disabled}
        onClick={() => onOpenChange(true)}
        className="flex size-8 items-center justify-center rounded-md text-ink-muted transition hover:bg-stone-100 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Type className="h-4 w-4" />
      </button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-80 rounded-lg bg-cream p-4">
          <DialogHeader>
            <DialogTitle className="font-serif text-lg text-ink">Reading Text</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-sm font-medium text-ink">Size</p>
              <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-white/70 px-3 py-2">
                <button
                  type="button"
                  aria-label="Decrease text size"
                  className="rounded px-2 py-1 text-sm text-ink-muted hover:bg-stone-100 hover:text-ink"
                  onClick={() => update({ fontScale: Math.max(85, preferences.fontScale - 5) })}
                >
                  A-
                </button>
                <span className="text-sm text-ink">{preferences.fontScale}%</span>
                <button
                  type="button"
                  aria-label="Increase text size"
                  className="rounded px-2 py-1 text-sm text-ink-muted hover:bg-stone-100 hover:text-ink"
                  onClick={() => update({ fontScale: Math.min(130, preferences.fontScale + 5) })}
                >
                  A+
                </button>
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-ink">Font</p>
              <div className="grid grid-cols-2 gap-2">
                {FONT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={preferences.fontFamily === option.value}
                    onClick={() => update({ fontFamily: option.value })}
                    className={`rounded-lg border px-3 py-2 text-sm transition ${
                      preferences.fontFamily === option.value
                        ? 'border-accent-orange bg-accent-orange/10 text-accent-orange'
                        : 'border-stone-200 bg-white/70 text-ink-muted hover:text-ink'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

### A.5 Add Search Popover

Create `src/screens/Reader/ReaderSearchPopover.tsx`:

```tsx
import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import { dispatchReaderNavigation } from './readerSupport';

interface Props {
  disabled: boolean;
}

export function ReaderSearchPopover({ disabled }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const query = useAppStore((state) => state.readerSearchQuery);
  const results = useAppStore((state) => state.readerSearchResults);
  const status = useAppStore((state) => state.readerSearchStatus);
  const setQuery = useAppStore((state) => state.setReaderSearchQuery);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={disabled ? 'Book search is available for EPUB books' : 'Search this book'}
        title={disabled ? 'Book search is available for EPUB books' : 'Search this book'}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex size-8 items-center justify-center rounded-md text-ink-muted transition hover:bg-stone-100 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Search className="h-4 w-4" />
      </button>
      {open && !disabled ? (
        <div
          ref={panelRef}
          className="absolute right-0 top-10 z-40 w-96 rounded-2xl border border-white/40 bg-white/55 p-3 shadow-xl backdrop-blur-md"
        >
          <div className="flex h-11 items-center rounded-full border border-white/40 bg-white/50 px-4">
            <Search className="mr-2 h-4 w-4 text-ink-muted" />
            <input
              ref={inputRef}
              value={query}
              placeholder="Search this book..."
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOpen(false);
                }
              }}
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
            />
          </div>
          {query.trim() ? (
            <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-white/40 bg-cream/80">
              {status === 'indexing' ? (
                <p className="px-3 py-3 text-sm text-ink-muted">Indexing...</p>
              ) : results.length === 0 ? (
                <p className="px-3 py-3 text-sm text-ink-muted">No matches.</p>
              ) : (
                results.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    className="block w-full border-b border-stone-200 px-3 py-2 text-left last:border-b-0 hover:bg-white/70"
                    onClick={() => {
                      dispatchReaderNavigation(result.position);
                      setOpen(false);
                    }}
                  >
                    <span className="block text-xs font-medium text-ink-muted">{result.label}</span>
                    <span className="line-clamp-2 text-sm leading-5 text-ink">{result.snippet}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

### A.6 Update ReaderChrome

Modify `src/screens/Reader/ReaderChrome.tsx`:

- Import `Menu` no longer directly; use new components.
- Add `useState` for text preferences dialog.
- Use `formatPositionLabel(book.current_position, { epubLocations: book.epub_locations })`.
- Hide/disable EPUB-only controls for PDFs by passing `disabled={book.file_type !== 'epub'}`.
- Replace the return layout with:

```tsx
  const [textPrefsOpen, setTextPrefsOpen] = useState(false);
  const label = readableLabel(book);
  const epubControlsDisabled = book.file_type !== 'epub';

  return (
    <div className="grid h-14 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-stone-200 bg-cream/80 px-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={closeBook}
          className="shrink-0 font-serif text-sm text-ink-muted transition hover:text-ink"
        >
          ← Library
        </button>
        <ChapterIndexPopover disabled={epubControlsDisabled} />
        {label ? (
          <span className="min-w-0 truncate text-xs text-ink-muted">{label}</span>
        ) : null}
      </div>

      <div className="flex justify-center">
        <ModeToggle
          value={book.display_mode}
          onChange={(mode) => {
            void setBookDisplayMode(book.id, mode);
          }}
        />
      </div>

      <div className="flex min-w-0 items-center justify-end gap-1">
        <TextPreferencesDialog
          disabled={epubControlsDisabled}
          open={textPrefsOpen}
          onOpenChange={setTextPrefsOpen}
        />
        <ReaderSearchPopover disabled={epubControlsDisabled} />
        <button
          type="button"
          aria-label="Take a note (n)"
          title="Take a note (n)"
          onClick={() => setNotesModeActive(!notesModeActive)}
          className="flex size-8 items-center justify-center rounded-md transition hover:bg-stone-100"
        >
          <Feather
            className="h-5 w-5"
            style={
              notesModeActive
                ? { color: ORANGE, fill: ORANGE }
                : { color: ORANGE, fill: 'transparent' }
            }
          />
        </button>
      </div>
    </div>
  );
```

Update `readableLabel`:

```ts
function readableLabel(book: Book): string {
  if (!book.current_position) return '';
  return formatPositionLabel(book.current_position, {
    epubLocations: book.epub_locations,
  });
}
```

Add imports:

```ts
import { useEffect, useState } from 'react';
import { formatPositionLabel } from '../../lib/positionShape';
import { ChapterIndexPopover } from './ChapterIndexPopover';
import { ReaderSearchPopover } from './ReaderSearchPopover';
import { TextPreferencesDialog } from './TextPreferencesDialog';
```

### A.7 Verify Task A

Run:

```bash
npm test -- --run tests/lib/positionShape.test.ts
```

Expected:

```text
PASS  tests/lib/positionShape.test.ts
```

Run:

```bash
npm run lint
```

Expected: no TypeScript or ESLint errors.

Commit:

```bash
git add src/screens/Reader/readerSupport.ts src/store.ts src/screens/Reader/ReaderChrome.tsx src/screens/Reader/ChapterIndexPopover.tsx src/screens/Reader/TextPreferencesDialog.tsx src/screens/Reader/ReaderSearchPopover.tsx
git commit -m "Add reader chrome control shell"
```

---

## 4. Task B - EPUB Navigation And Search Data

**Owner:** Worker B.

**Write scope:**

- `src/lib/epubReaderIndex.ts`
- `src/screens/Reader/EpubReader.tsx`
- `src/screens/Reader/PdfReader.tsx`
- `tests/lib/epubReaderIndex.test.ts`

### B.1 Add EPUB Index Helpers

Create `src/lib/epubReaderIndex.ts`:

```ts
import type { Book as EpubBook, NavItem } from 'epubjs';
import type { Position } from './positionShape';
import type { ReaderNavItem, ReaderSearchResult } from '../screens/Reader/readerSupport';

interface SpineItemLike {
  href?: string;
  index?: number;
  idref?: string;
  linear?: string;
}

interface SpineLike {
  spineItems?: SpineItemLike[];
  each?: (callback: (item: SpineItemLike) => void) => void;
  get?: (target: string) => SpineItemLike | undefined;
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
          : findNavLabel(epubBook.navigation.toc, href) ?? readableSpineLabel(item, index);
      const position = makeHrefPosition(epubBook, href, label, index);
      return {
        id: `${index}:${href || item.idref || label}`,
        label,
        kind: index === 0 ? 'cover' as const : 'chapter' as const,
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
    const text = await loadSectionText(epubBook, href);
    if (!text.trim()) continue;
    sections.push({
      id: navItem?.id ?? `${index}:${href}`,
      label: navItem?.label ?? readableSpineLabel(spineItem, index),
      href,
      text,
      position: navItem?.position ?? makeHrefPosition(epubBook, href, readableSpineLabel(spineItem, index), index),
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
  const locator = href || undefined;
  let fraction = 0;
  try {
    const spineLength = Math.max(getSpineItems(epubBook).length, 1);
    fraction = index / spineLength;
  } catch {
    fraction = 0;
  }
  return {
    type: 'epub',
    locator: locator ?? '',
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

function findInToc(items: NavItem[], match: (item: NavItem) => boolean): string | null {
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
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}
```

Important implementation note: `rendition.display()` accepts hrefs as well as CFIs. The `Position.locator` for nav/search may be an EPUB href. Existing `GO_TO_SOURCE_EVENT` code already passes `position.locator` into `rendition.display()`, so this is compatible.

### B.2 Wire EPUB Reader Data

Modify `src/screens/Reader/EpubReader.tsx`.

Add imports:

```ts
import { useMemo } from 'react';
import {
  buildEpubNavItems,
  buildEpubSearchSections,
  searchEpubSections,
  type EpubSearchSection,
} from '../../lib/epubReaderIndex';
import { GO_TO_SOURCE_EVENT } from './readerSupport';
```

Replace the local constant:

```ts
const GO_TO_SOURCE_EVENT = 'scholara:go-to-source';
```

with the imported constant.

Add refs:

```ts
  const searchSectionsRef = useRef<EpubSearchSection[]>([]);
  const searchDebounceRef = useRef<number | null>(null);
```

Read store actions/state:

```ts
  const readerSearchQuery = useAppStore((state) => state.readerSearchQuery);
  const readerPreferences = useAppStore((state) => state.readerPreferences);
  const setReaderNavItems = useAppStore((state) => state.setReaderNavItems);
  const setReaderSearchResults = useAppStore((state) => state.setReaderSearchResults);
  const setReaderSearchStatus = useAppStore((state) => state.setReaderSearchStatus);
  const clearReaderSupport = useAppStore((state) => state.clearReaderSupport);
```

Inside the `await epubBook.ready` block, after locations load/generate:

```ts
      const navItems = buildEpubNavItems(epubBook);
      setReaderNavItems(navItems);
      setReaderSearchStatus('indexing');
      searchSectionsRef.current = await buildEpubSearchSections(epubBook, navItems);
      setReaderSearchStatus(searchSectionsRef.current.length > 0 ? 'ready' : 'empty');
```

In cleanup:

```ts
      clearReaderSupport();
      if (searchDebounceRef.current !== null) {
        window.clearTimeout(searchDebounceRef.current);
      }
```

Add effect below the main render setup effect:

```ts
  useEffect(() => {
    if (searchDebounceRef.current !== null) {
      window.clearTimeout(searchDebounceRef.current);
    }

    const query = readerSearchQuery.trim();
    if (!query) {
      setReaderSearchResults([], searchSectionsRef.current.length > 0 ? 'ready' : 'idle');
      return;
    }

    searchDebounceRef.current = window.setTimeout(() => {
      const results = searchEpubSections(searchSectionsRef.current, query);
      setReaderSearchResults(results, searchSectionsRef.current.length > 0 ? 'ready' : 'empty');
    }, 180);

    return () => {
      if (searchDebounceRef.current !== null) {
        window.clearTimeout(searchDebounceRef.current);
      }
    };
  }, [readerSearchQuery, setReaderSearchResults]);
```

Add `setReaderNavItems`, `setReaderSearchStatus`, `clearReaderSupport` to the dependency list of the main setup effect.

### B.3 Clear Support For PDFs

Modify `src/screens/Reader/PdfReader.tsx`.

Add:

```ts
  const clearReaderSupport = useAppStore((state) => state.clearReaderSupport);

  useEffect(() => {
    clearReaderSupport();
  }, [clearReaderSupport]);
```

Do not add PDF nav/search/text preference behavior.

### B.4 Add Helper Tests

Create `tests/lib/epubReaderIndex.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { searchEpubSections, type EpubSearchSection } from '../../src/lib/epubReaderIndex';

const sections: EpubSearchSection[] = [
  {
    id: '1',
    label: 'Chapter One',
    href: 'chapter-1.xhtml',
    text: 'The quick brown fox studies marginalia carefully.',
    position: { type: 'epub', locator: 'chapter-1.xhtml', fraction: 0.1, label: 'Chapter One' },
  },
  {
    id: '2',
    label: 'Chapter Two',
    href: 'chapter-2.xhtml',
    text: 'A reader searches the book for a remembered word.',
    position: { type: 'epub', locator: 'chapter-2.xhtml', fraction: 0.2, label: 'Chapter Two' },
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
```

### B.5 Verify Task B

Run:

```bash
npm test -- --run tests/lib/epubReaderIndex.test.ts
npm run lint
```

Expected: tests pass and lint has no errors.

Commit:

```bash
git add src/lib/epubReaderIndex.ts src/screens/Reader/EpubReader.tsx src/screens/Reader/PdfReader.tsx tests/lib/epubReaderIndex.test.ts
git commit -m "Add EPUB reader navigation and search data"
```

---

## 5. Task C - Notes And Highlights Chapter Scope

**Owner:** Worker C.

**Write scope:**

- `src/lib/positionShape.ts`
- `src/screens/Reader/agentPanel/AgentPanel.tsx`
- `src/screens/Reader/agentPanel/NotesTab.tsx`
- `src/screens/Reader/agentPanel/HighlightsTab.tsx`
- `tests/lib/positionShape.test.ts`

### C.1 Add EPUB Scope Helpers

Modify `src/lib/positionShape.ts`.

Add exports:

```ts
export function sameEpubSectionFromJson(
  noteJson: string,
  scopePosition: Position,
): boolean {
  if (scopePosition.type !== 'epub') return false;
  const notePosition = getSourcePositionFromJson(noteJson);
  if (!notePosition || notePosition.type !== 'epub') return false;

  const noteSection = epubSectionKey(notePosition.locator);
  const scopeSection = epubSectionKey(scopePosition.locator);
  if (noteSection && scopeSection) return noteSection === scopeSection;

  return normalizePositionLabel(notePosition.label) === normalizePositionLabel(scopePosition.label);
}

export function epubSectionKey(locator: string): string | null {
  if (!locator) return null;
  if (!locator.startsWith('epubcfi(')) {
    return stripFragment(locator);
  }

  const bangIndex = locator.indexOf('!');
  if (bangIndex === -1) return null;
  return locator.slice(0, bangIndex);
}

export function normalizePositionLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function stripFragment(href: string): string {
  const hashIdx = href.indexOf('#');
  return hashIdx === -1 ? href : href.slice(0, hashIdx);
}
```

### C.2 Update NotesTab

Modify `src/screens/Reader/agentPanel/NotesTab.tsx`.

Add imports:

```ts
import { useMemo } from 'react';
import type { ReaderNavItem } from '../readerSupport';
import { sameEpubSectionFromJson } from '../../../lib/positionShape';
```

Update props:

```ts
interface Props {
  book: Book;
  scope: ReaderNavItem | null;
}

interface NoteListProps {
  book: Book;
  emptyMessage: string;
  notes: NoteRow[];
}
```

Update component:

```tsx
export function NotesTab({ book, scope }: Props) {
  const notes = useAppStore((state) => state.currentBookNotes);
  const scopedNotes = useMemo(
    () => filterNotesByScope(notes, scope),
    [notes, scope],
  );

  return <NotesList book={book} emptyMessage="No notes yet." notes={scopedNotes} />;
}

export function filterNotesByScope(notes: NoteRow[], scope: ReaderNavItem | null): NoteRow[] {
  if (!scope) return notes;
  return notes.filter((note) => sameEpubSectionFromJson(note.page_or_position, scope.position));
}
```

Keep `NotesList` unchanged except formatting if lint requires it.

### C.3 Update HighlightsTab

Modify `src/screens/Reader/agentPanel/HighlightsTab.tsx`:

```tsx
import { useMemo } from 'react';
import type { Book } from '../../../db/types';
import { useAppStore } from '../../../store';
import type { ReaderNavItem } from '../readerSupport';
import { NotesList, filterNotesByScope } from './NotesTab';

interface Props {
  book: Book;
  scope: ReaderNavItem | null;
}

export function HighlightsTab({ book, scope }: Props) {
  const currentBookNotes = useAppStore((state) => state.currentBookNotes);
  const notes = useMemo(
    () =>
      filterNotesByScope(
        currentBookNotes.filter((note) => note.quote_text !== null),
        scope,
      ),
    [currentBookNotes, scope],
  );

  return <NotesList book={book} emptyMessage="No highlights yet." notes={notes} />;
}
```

### C.4 Update AgentPanel Scope UI

Modify `src/screens/Reader/agentPanel/AgentPanel.tsx`.

Add imports:

```ts
import { Menu } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../../store';
import type { ReaderNavItem } from '../readerSupport';
```

Replace the existing `useState` import.

Inside `AgentPanel`:

```tsx
  const [tab, setTab] = useState('chat');
  const [scopeOpen, setScopeOpen] = useState(false);
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);
  const scopeButtonRef = useRef<HTMLButtonElement | null>(null);
  const scopePanelRef = useRef<HTMLDivElement | null>(null);
  const navItems = useAppStore((state) => state.readerNavItems);
  const showScope = book.file_type === 'epub' && (tab === 'notes' || tab === 'highlights');
  const selectedScope = useMemo(
    () => navItems.find((item) => item.id === selectedScopeId) ?? null,
    [navItems, selectedScopeId],
  );
  const scopeLabel = selectedScope?.label ?? 'All Notes';

  useEffect(() => {
    if (!showScope) {
      setScopeOpen(false);
    }
  }, [showScope]);

  useEffect(() => {
    if (!scopeOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (scopeButtonRef.current?.contains(target) || scopePanelRef.current?.contains(target)) return;
      setScopeOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [scopeOpen]);
```

Change the header wrapper:

```tsx
      <div className="flex h-14 items-center border-b border-stone-200 px-2">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="chat">AI Chat</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="highlights">Highlights</TabsTrigger>
          <TabsTrigger value="dictionary">Dictionary</TabsTrigger>
        </TabsList>
      </div>
```

Change tab renders:

```tsx
      <TabsContent value="notes" className="flex-1 overflow-hidden">
        <ScopedPanelContent showScope={showScope} scopeLabel={scopeLabel}>
          <NotesTab book={book} scope={showScope ? selectedScope : null} />
        </ScopedPanelContent>
      </TabsContent>
      <TabsContent value="highlights" className="flex-1 overflow-hidden">
        <ScopedPanelContent showScope={showScope} scopeLabel={scopeLabel}>
          <HighlightsTab book={book} scope={showScope ? selectedScope : null} />
        </ScopedPanelContent>
      </TabsContent>
```

Add the scope row and menu below the tab header, left-aligned with the list:

```tsx
function ScopedPanelContent({
  showScope,
  scopeLabel,
  children,
}: {
  showScope: boolean;
  scopeLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {showScope ? (
        <div className="relative border-b border-stone-100 px-4 py-2">
          <button
            ref={scopeButtonRef}
            type="button"
            aria-label="Choose notes scope"
            onClick={() => setScopeOpen((value) => !value)}
            className="flex max-w-full items-center gap-1 rounded-md px-1 py-1 text-left text-sm text-ink-muted transition hover:bg-white hover:text-ink"
          >
            <Menu className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{scopeLabel}</span>
          </button>
          {scopeOpen ? (
            <div
              ref={scopePanelRef}
              className="absolute left-4 top-11 z-30 w-60 overflow-hidden rounded-lg border border-stone-200 bg-cream shadow-xl"
            >
              <ScopeButton
                active={selectedScopeId === null}
                label="All Notes"
                onClick={() => {
                  setSelectedScopeId(null);
                  setScopeOpen(false);
                }}
              />
              {navItems.map((item) => (
                <ScopeButton
                  key={item.id}
                  active={selectedScopeId === item.id}
                  label={item.label}
                  onClick={() => {
                    setSelectedScopeId(item.id);
                    setScopeOpen(false);
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </div>
  );
}
```

Important: because `ScopedPanelContent` uses `scopeButtonRef`, `scopePanelRef`, `scopeOpen`, `setScopeOpen`, `selectedScopeId`, `setSelectedScopeId`, and `navItems`, define it inside `AgentPanel` before the `return`, not as a top-level helper.

Add top-level helper component at bottom:

```tsx
function ScopeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition ${
        active ? 'bg-white text-ink' : 'text-ink-muted hover:bg-white/70 hover:text-ink'
      }`}
      onClick={onClick}
    >
      <span className="min-w-0 truncate">{label}</span>
      {active ? <span className="text-accent-orange">✓</span> : null}
    </button>
  );
}
```

### C.5 Add Position Tests

Append to `tests/lib/positionShape.test.ts`:

```ts
import {
  epubSectionKey,
  sameEpubSectionFromJson,
} from '../../src/lib/positionShape';
```

Add tests:

```ts
  it('extracts EPUB section keys from CFI and href locators', () => {
    expect(epubSectionKey('epubcfi(/6/4!/4/2/2)')).toBe('epubcfi(/6/4');
    expect(epubSectionKey('Text/chapter-1.xhtml#start')).toBe('Text/chapter-1.xhtml');
  });

  it('matches EPUB notes to the same section', () => {
    const scope: Position = {
      type: 'epub',
      locator: 'Text/chapter-1.xhtml',
      fraction: 0.2,
      label: 'Chapter One',
    };
    const note: Position = {
      type: 'epub',
      locator: 'Text/chapter-1.xhtml#para',
      fraction: 0.21,
      label: 'Chapter One',
    };
    expect(sameEpubSectionFromJson(serializePosition(note), scope)).toBe(true);
  });

  it('matches EPUB quote ranges from their source section', () => {
    const scope: Position = {
      type: 'epub',
      locator: 'epubcfi(/6/4!/4/2/2)',
      fraction: 0.3,
      label: 'Chapter Two',
    };
    const range: EpubQuoteRange = {
      start: {
        type: 'epub',
        locator: 'epubcfi(/6/4!/4/8/2)',
        fraction: 0.31,
        label: 'Chapter Two',
      },
      end: {
        type: 'epub',
        locator: 'epubcfi(/6/4!/4/10/2)',
        fraction: 0.32,
        label: 'Chapter Two',
      },
    };
    expect(sameEpubSectionFromJson(serializeQuoteRange(range), scope)).toBe(true);
  });

  it('does not match malformed note JSON to a chapter scope', () => {
    const scope: Position = {
      type: 'epub',
      locator: 'Text/chapter-1.xhtml',
      fraction: 0.2,
      label: 'Chapter One',
    };
    expect(sameEpubSectionFromJson('{not-json', scope)).toBe(false);
  });
```

### C.6 Verify Task C

Run:

```bash
npm test -- --run tests/lib/positionShape.test.ts
npm run lint
```

Expected: tests pass and lint has no errors.

Commit:

```bash
git add src/lib/positionShape.ts src/screens/Reader/agentPanel/AgentPanel.tsx src/screens/Reader/agentPanel/NotesTab.tsx src/screens/Reader/agentPanel/HighlightsTab.tsx tests/lib/positionShape.test.ts
git commit -m "Add EPUB notes chapter scope"
```

---

## 6. Task D - EPUB Text Preferences Application

**Owner:** Worker D.

**Write scope:**

- `src/screens/Reader/EpubReader.tsx`
- `src/screens/Reader/TextPreferencesDialog.tsx`
- `tests/playwright/epub-reader.spec.ts`

### D.1 Apply Preferences In EpubReader

Modify `src/screens/Reader/EpubReader.tsx`.

Add helper:

```ts
function applyReaderPreferences(rendition: Rendition, preferences: ReaderPreferences): void {
  const fontFamily = preferences.fontFamily === 'original'
    ? undefined
    : readerFontFamily(preferences.fontFamily);

  rendition.themes.fontSize(`${preferences.fontScale}%`);
  if (fontFamily) {
    rendition.themes.font(fontFamily);
  } else {
    rendition.themes.font('');
  }
}

function readerFontFamily(font: ReaderPreferences['fontFamily']): string {
  if (font === 'arial') return 'Arial, sans-serif';
  if (font === 'georgia') return 'Georgia, serif';
  if (font === 'iowan') return '"Iowan Old Style", "Palatino Linotype", Georgia, serif';
  return '';
}
```

Add import:

```ts
import type { ReaderPreferences } from './readerSupport';
```

After creating `rendition`, call:

```ts
    applyReaderPreferences(rendition, readerPreferences);
```

Add effect:

```ts
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    applyReaderPreferences(rendition, readerPreferences);
  }, [readerPreferences]);
```

If `rendition.themes.font('')` does not restore original in testing, use this version instead:

```ts
  if (fontFamily) {
    rendition.themes.override('font-family', fontFamily);
  } else {
    rendition.themes.override('font-family', 'inherit');
  }
```

Do not edit `PdfReader.tsx`.

### D.2 Add Test Hooks For Preference Verification

If Playwright cannot inspect iframe body styles reliably, add a window-level hook only in test mode inside `EpubReader.tsx`:

```ts
    if (import.meta.env.MODE === 'test') {
      (window as Window & { __SCHOLARA_READER_PREFS__?: ReaderPreferences }).__SCHOLARA_READER_PREFS__ =
        readerPreferences;
    }
```

Update it inside the preferences effect too.

### D.3 Verify Task D

Run:

```bash
npm run lint
npx playwright test tests/playwright/epub-reader.spec.ts
```

Expected: lint passes and EPUB Playwright tests pass.

Commit:

```bash
git add src/screens/Reader/EpubReader.tsx src/screens/Reader/TextPreferencesDialog.tsx tests/playwright/epub-reader.spec.ts
git commit -m "Apply EPUB text preferences"
```

---

## 7. Task E - Playwright Coverage And Integration Polish

**Owner:** Worker E.

**Write scope:**

- `tests/playwright/epub-reader.spec.ts`
- `tests/playwright/notes-mode.spec.ts`
- `tests/playwright/pdf-reader.spec.ts`
- Small polish fixes in files touched by earlier tasks if tests reveal a regression.

### E.1 Add EPUB Chrome Tests

Append to `tests/playwright/epub-reader.spec.ts`:

```ts
test('EPUB reader chrome exposes contents, text preferences, and search controls', async ({ page }) => {
  await page.evaluate(async () => {
    await (window as Window & {
      __appTestHooks: {
        seedBook(input: {
          title: string;
          file_path: string;
          file_type: 'epub';
        }): Promise<unknown>;
      };
    }).__appTestHooks.seedBook({
      title: 'Chrome EPUB',
      file_path: '/mock/sample.epub',
      file_type: 'epub',
    });
  });

  await page.getByRole('button', { name: 'Open Chrome EPUB' }).click();
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Open contents' }).click();
  await expect(page.getByText('Contents')).toBeVisible();
  await expect(page.getByRole('button', { name: /Cover/ })).toBeVisible();

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Reading text preferences' }).click();
  await expect(page.getByRole('heading', { name: 'Reading Text' })).toBeVisible();
  await page.getByRole('button', { name: 'Georgia' }).click();
  await page.getByRole('button', { name: 'Increase text size' }).click();
  const prefs = await page.evaluate(() =>
    (window as Window & {
      __SCHOLARA_READER_PREFS__?: { fontFamily: string; fontScale: number };
    }).__SCHOLARA_READER_PREFS__,
  );
  expect(prefs).toMatchObject({ fontFamily: 'georgia', fontScale: 105 });

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Search this book' }).click();
  await page.getByPlaceholder('Search this book...').fill('lorem');
  await expect(page.locator('button').filter({ hasText: /Chapter|Cover|Lorem/i }).first()).toBeVisible({
    timeout: 10_000,
  });
});
```

### E.2 Add Notes Scope Test

Append to `tests/playwright/notes-mode.spec.ts`:

```ts
test('EPUB notes scope control starts at All Notes and omits Filter wording', async ({ page }) => {
  await page.evaluate(async () => {
    await (window as Window & {
      __appTestHooks: {
        seedBook(input: {
          title: string;
          file_path: string;
          file_type: 'epub';
        }): Promise<{ id: number }>;
      };
    }).__appTestHooks.seedBook({
      title: 'Scoped Notes EPUB',
      file_path: '/mock/sample.epub',
      file_type: 'epub',
    });
  });

  await page.getByRole('button', { name: 'Open Scoped Notes EPUB' }).click();
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole('tab', { name: 'Notes' }).click();
  await expect(page.getByRole('button', { name: 'Choose notes scope' })).toContainText('All Notes');
  await expect(page.getByText('Filter')).toHaveCount(0);
});
```

### E.3 Add PDF Deferral Test

Append to `tests/playwright/pdf-reader.spec.ts`:

```ts
test('PDF reader does not expose EPUB-only reader chrome controls', async ({ page }) => {
  await page.evaluate(async () => {
    await (window as Window & {
      __appTestHooks: {
        seedBook(input: {
          title: string;
          file_path: string;
          file_type: 'pdf';
        }): Promise<unknown>;
      };
    }).__appTestHooks.seedBook({
      title: 'PDF Book',
      file_path: '/mock/sample.pdf',
      file_type: 'pdf',
    });
  });

  await page.getByRole('button', { name: 'Open PDF Book' }).click();
  await expect(page.getByText(/Loading PDF|Could not load PDF|Page/)).toBeVisible({ timeout: 10_000 });

  await expect(page.getByRole('button', { name: 'Open contents' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reading text preferences' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Search this book' })).toHaveCount(0);
});
```

If Task A chose disabled controls rather than hidden controls for PDFs, assert the disabled names instead:

```ts
  await expect(page.getByRole('button', { name: 'Chapter index is available for EPUB books' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Text preferences are available for EPUB books' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Book search is available for EPUB books' })).toBeDisabled();
```

Use one assertion style, not both.

### E.4 Full Verification

Run:

```bash
npm test -- --run tests/lib/positionShape.test.ts tests/lib/epubReaderIndex.test.ts
npm run lint
npx playwright test tests/playwright/epub-reader.spec.ts tests/playwright/notes-mode.spec.ts tests/playwright/pdf-reader.spec.ts
```

Expected:

```text
2 test files passed in Vitest
lint exits 0
all selected Playwright specs pass
```

Commit:

```bash
git add tests/playwright/epub-reader.spec.ts tests/playwright/notes-mode.spec.ts tests/playwright/pdf-reader.spec.ts
git commit -m "Cover reader chrome controls"
```

---

## 8. Final Orchestrator Review

After workers finish:

1. Run `git status --short`.
2. Confirm no unrelated `agent/...` deletions or `.agent/` files were staged.
3. Run the full verification command from Task E.4.
4. Manually inspect Reader Chrome in EPUB Agent Display and Full Reader Display:
   - Left: `← Library`, contents icon, current label.
   - Center: display toggle.
   - Right: `Aa`, search, quill.
   - Notes tab: `☰ All Notes`, no visible word `Filter`.
   - PDF: EPUB-only controls hidden or disabled.
5. Commit any final integration fix with:

```bash
git add <changed-files>
git commit -m "Polish reader chrome controls"
```

---

## 9. Self-Review

Spec coverage:

- Stable Reader Chrome placement is covered by Task A and E.1.
- EPUB chapter index with Cover is covered by Task B and E.1.
- Notes/Highlights `☰ All Notes` scope without the word `Filter` is covered by Task C and E.2.
- EPUB text preferences are covered by Task D and E.1.
- EPUB search is covered by Task B and E.1.
- PDF deferral is covered by Task A, B, C, D, and E.3.

Placeholder scan:

- The plan contains no placeholder tokens or unspecified validation steps.
- The only conditional instruction is the PDF hidden-vs-disabled assertion in Task E.3 because the approved spec allows either. The worker must choose the branch that matches Task A and keep only one assertion style.

Type consistency:

- `ReaderNavItem`, `ReaderSearchResult`, `ReaderPreferences`, and `ReaderSearchStatus` are defined once in `readerSupport.ts` and referenced consistently.
- Store action names are defined in Task A and reused by Tasks B-D.
- `GO_TO_SOURCE_EVENT` is centralized in `readerSupport.ts`.
