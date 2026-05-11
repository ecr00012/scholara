# Gutendex Switch Implementation Plan

**Goal:** Replace the Project Gutenberg panel's RapidAPI dependency with direct, unauthenticated calls to Gutendex (`https://gutendex.com/books`), eliminating the API-key plumbing and walking the top-400 most-downloaded list reliably.

**Architecture:** Move the catalog HTTP call into a new Rust Tauri command `fetch_gutendex_page(page)` that returns a raw Gutendex page. A pure TS helper translates the existing `cursor_offset` (0–399, step 4) into `(page, slice)` at the request boundary and slices 4 books out of one or two pages. The renderer's panel state machine collapses from six states to four (`loading | offline | api-error | ready`) since there is no key to be missing or rejected. The `gutenberg_panel_state` table and its cursor semantics are preserved; the EPUB download command is untouched.

**Tech Stack:** Tauri (Rust + `reqwest`), TypeScript, React, Zustand, Vitest, Playwright.

**Originating design:** `docs/superpowers/specs/2026-05-06-gutenberg-panel-design.md` (the Phase-4a spec). This plan is a successor that supersedes the RapidAPI decision in that spec (rows #6/#9/#10/#12 of the locked-decisions table become moot).

---

## File-by-file impact

| Path | Action | Responsibility |
|---|---|---|
| `src-tauri/src/commands/gutendex.rs` | **new** | `fetch_gutendex_page(page) -> Result<GutendexPage, String>` HTTP call to `https://gutendex.com/books?sort=popular&page={page}` |
| `src-tauri/src/commands/mod.rs` | edit | register `gutendex` module |
| `src-tauri/src/lib.rs` | edit | register `fetch_gutendex_page` in `invoke_handler!` |
| `src-tauri/src/commands/secrets.rs` | edit | drop the `"gutenberg" => Ok("gutenberg_api_key")` arm from `account_for` |
| `src/ipc/gutendex.ts` | **new** | thin TS wrapper around `invoke('fetch_gutendex_page', { page })` |
| `src/lib/gutendexPagination.ts` | **new** | pure helper: `cursorToPageSlice(cursor)` + `slicePages(cursor, page1, page2?)` |
| `src/lib/gutenbergApi.ts` | rewrite | becomes orchestrator: `fetchBooks(cursor)` calls one or two pages via IPC and slices; drop `verifyKey`, drop RapidAPI host/headers; narrow `GutenbergBook` type |
| `src/screens/Library/Gutenberg/types.ts` | edit | drop `missing-key` and `invalid-key` from `PanelState` |
| `src/screens/Library/Gutenberg/index.tsx` | edit | drop API-key gates and `ApiKeyForm` rendering; simplify state machine |
| `src/screens/Library/Gutenberg/ApiKeyForm.tsx` | **delete** | no longer needed |
| `src/screens/Library/Gutenberg/DetailModal.tsx` | edit | `MetaRow` renders `—` for null values so "Released" and "Reading ease" stay visible |
| `src/screens/Settings/index.tsx` | edit | remove the Gutenberg `ApiKeyForm` instance and its surrounding `<hr/>` |
| `src/store.ts` | edit | drop `gutenbergApiKey`, `gutenbergApiKeyError`, `loadGutenbergApiKey`, `saveGutenbergApiKey` |
| `src/App.tsx` | edit | drop `loadGutenbergApiKey` boot call |
| `src/testHooks.ts` | edit | `GutenbergBook` import shape change only — fields drop, no logic change |
| `tests/lib/gutenbergApi.test.ts` | rewrite | mock `@tauri-apps/api/core` `invoke`, assert page math + concat |
| `tests/lib/gutendexPagination.test.ts` | **new** | pure-function tests for cursor → (page, slice) + straddle |
| `tests/db/gutenbergPanel.test.ts` | edit | update `FAKE_BOOK` fixture to new shape |
| `tests/playwright/gutenberg-panel.spec.ts` | edit | route `https://gutendex.com/**` instead of RapidAPI host; delete the four key-related tests |

CLAUDE.md is **not** modified — the "All keychain-backed secrets go through `getSecret(name)` / `setSecret(name)`" constraint still holds (OpenRouter still uses it).

---

## Task 1 — Add the Rust IPC command `fetch_gutendex_page`

**Why first:** every TS-side change depends on this command existing.

**File: `src-tauri/src/commands/gutendex.rs` (new)**

```rust
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct GutendexResponse {
    results: Vec<GutendexRawBook>,
}

#[derive(Deserialize)]
struct GutendexRawAuthor {
    name: String,
}

#[derive(Deserialize)]
struct GutendexRawBook {
    id: i64,
    title: String,
    #[serde(default)]
    authors: Vec<GutendexRawAuthor>,
    #[serde(default)]
    subjects: Vec<String>,
    #[serde(default)]
    bookshelves: Vec<String>,
    #[serde(default)]
    download_count: i64,
    #[serde(default)]
    formats: std::collections::HashMap<String, String>,
}

#[derive(Serialize)]
pub struct GutenbergAuthor {
    pub name: String,
}

#[derive(Serialize)]
pub struct GutenbergBook {
    pub id: i64,
    pub title: String,
    pub authors: Vec<GutenbergAuthor>,
    pub subjects: Vec<String>,
    pub bookshelves: Vec<String>,
    pub download_count: i64,
    pub cover_image: Option<String>,
    pub issued: Option<String>,
    pub reading_ease_score: Option<String>,
}

#[derive(Serialize)]
pub struct GutendexPage {
    pub books: Vec<GutenbergBook>,
}

fn cover_from_formats(
    id: i64,
    formats: &std::collections::HashMap<String, String>,
) -> Option<String> {
    if let Some(url) = formats.get("image/jpeg") {
        return Some(url.clone());
    }
    // Synthesize the canonical PG cover URL as a fallback. The <img> onError
    // in DetailModal/BookTile will route to GeneratedCover if this 404s.
    Some(format!(
        "https://www.gutenberg.org/cache/epub/{id}/pg{id}.cover.medium.jpg"
    ))
}

#[tauri::command]
pub async fn fetch_gutendex_page(page: u32) -> Result<GutendexPage, String> {
    if page == 0 {
        return Err("client: page must be >= 1".into());
    }

    let client = reqwest::Client::builder()
        .user_agent("Scholara/0.1 (+https://gutenberg.org)")
        .build()
        .map_err(|e| format!("network: {e}"))?;

    let url = format!("https://gutendex.com/books?sort=popular&page={page}");
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("network: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("server: HTTP {}", status.as_u16()));
    }

    let parsed: GutendexResponse = resp
        .json()
        .await
        .map_err(|e| format!("decode: {e}"))?;

    let books = parsed
        .results
        .into_iter()
        .map(|b| GutenbergBook {
            id: b.id,
            title: b.title,
            authors: b
                .authors
                .into_iter()
                .map(|a| GutenbergAuthor { name: a.name })
                .collect(),
            subjects: b.subjects,
            bookshelves: b.bookshelves,
            download_count: b.download_count,
            cover_image: cover_from_formats(b.id, &b.formats),
            issued: None,
            reading_ease_score: None,
        })
        .collect();

    Ok(GutendexPage { books })
}
```

**File: `src-tauri/src/commands/mod.rs` (edit)** — append `pub mod gutendex;` alongside the existing `pub mod gutenberg;`.

**File: `src-tauri/src/lib.rs` (edit)**

Add the import at the top of the imports block:

```rust
use commands::gutendex::fetch_gutendex_page;
```

Add `fetch_gutendex_page,` to the `tauri::generate_handler![ ... ]` list (right after `download_gutenberg_epub,`).

**Verify locally:**

```
npm run tauri dev
# In the running app's DevTools console:
await window.__TAURI__.core.invoke('fetch_gutendex_page', { page: 1 })
# Expected: { books: [ { id: 84, title: 'Frankenstein; ...', ... }, ... ] }  (32 books)
```

**Commit:** `feat(gutenberg): add fetch_gutendex_page Rust command`

---

## Task 2 — Pagination helper + TS IPC wrapper

**Why:** isolates the cursor math from HTTP so it can be unit-tested directly.

**File: `src/ipc/gutendex.ts` (new)**

```ts
import { invoke } from '@tauri-apps/api/core';
import type { GutenbergBook } from '../lib/gutenbergApi';

interface RawGutendexPage {
  books: GutenbergBook[];
}

export async function fetchGutendexPage(page: number): Promise<GutenbergBook[]> {
  const result = await invoke<RawGutendexPage>('fetch_gutendex_page', { page });
  return result.books;
}
```

**File: `src/lib/gutendexPagination.ts` (new)**

```ts
import type { GutenbergBook } from './gutenbergApi';

export const GUTENDEX_PAGE_SIZE = 32;
export const PANEL_WINDOW = 4;

/**
 * Translate a 0–399 cursor (step 4, see gutenberg_panel_state.cursor_offset)
 * into the 1-indexed page number Gutendex expects and the slice offset within
 * that page where our 4-book window starts.
 */
export function cursorToPageSlice(cursor: number): {
  page: number;
  slice: number;
} {
  const page = Math.floor(cursor / GUTENDEX_PAGE_SIZE) + 1;
  const slice = cursor % GUTENDEX_PAGE_SIZE;
  return { page, slice };
}

/**
 * Slice PANEL_WINDOW (4) books out of one or two consecutive pages, starting
 * at `slice` within `firstPage`. If the window crosses the page boundary,
 * pull the spillover from `secondPage`. Defensive: in current production the
 * cursor only takes values 0,4,...,396 so slice ∈ {0,4,...,28} and the window
 * never straddles — but we support the general case so any future cursor
 * stride works.
 */
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

/** Does the window starting at `slice` cross the page boundary? */
export function needsSecondPage(slice: number): boolean {
  return slice + PANEL_WINDOW > GUTENDEX_PAGE_SIZE;
}
```

**File: `tests/lib/gutendexPagination.test.ts` (new)**

```ts
import { describe, it, expect } from 'vitest';
import {
  cursorToPageSlice,
  needsSecondPage,
  slicePages,
  GUTENDEX_PAGE_SIZE,
} from '../../src/lib/gutendexPagination';
import type { GutenbergBook } from '../../src/lib/gutenbergApi';

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

const page1 = Array.from({ length: GUTENDEX_PAGE_SIZE }, (_, i) => makeBook(i + 1));
const page2 = Array.from({ length: GUTENDEX_PAGE_SIZE }, (_, i) => makeBook(i + 33));

describe('lib/gutendexPagination', () => {
  it('cursor 0 → page 1, slice 0', () => {
    expect(cursorToPageSlice(0)).toEqual({ page: 1, slice: 0 });
  });

  it('cursor 28 → page 1, slice 28 (last in-page window)', () => {
    expect(cursorToPageSlice(28)).toEqual({ page: 1, slice: 28 });
  });

  it('cursor 32 → page 2, slice 0', () => {
    expect(cursorToPageSlice(32)).toEqual({ page: 2, slice: 0 });
  });

  it('cursor 396 → page 13, slice 12 (last window before wrap)', () => {
    expect(cursorToPageSlice(396)).toEqual({ page: 13, slice: 12 });
  });

  it('needsSecondPage is false for production cursor strides (multiples of 4)', () => {
    for (let c = 0; c < 400; c += 4) {
      const { slice } = cursorToPageSlice(c);
      expect(needsSecondPage(slice)).toBe(false);
    }
  });

  it('needsSecondPage is true when slice + 4 > 32', () => {
    expect(needsSecondPage(29)).toBe(true);
    expect(needsSecondPage(30)).toBe(true);
    expect(needsSecondPage(31)).toBe(true);
  });

  it('slicePages returns the 4-book window inside one page when it fits', () => {
    const window = slicePages(8, page1);
    expect(window.map((b) => b.id)).toEqual([9, 10, 11, 12]);
  });

  it('slicePages concatenates across pages when the window straddles', () => {
    const window = slicePages(30, page1, page2);
    expect(window.map((b) => b.id)).toEqual([31, 32, 33, 34]);
  });

  it('slicePages returns fewer books if both pages are short', () => {
    const shortFirst = page1.slice(0, 16);
    const window = slicePages(14, shortFirst);
    expect(window.map((b) => b.id)).toEqual([15, 16]);
  });
});
```

**Verify locally:**

```
npm test -- gutendexPagination
# Expected: 8 passing.
```

**Commit:** `feat(gutenberg): add gutendex pagination helper + IPC wrapper`

---

## Task 3 — Rewrite `src/lib/gutenbergApi.ts` to orchestrate Gutendex

**Why:** this is the seam every caller (`Gutenberg/index.tsx`, tests, `testHooks.ts`) goes through. Change the shape here and propagate.

**File: `src/lib/gutenbergApi.ts` (rewrite)**

```ts
import { fetchGutendexPage } from '../ipc/gutendex';
import {
  cursorToPageSlice,
  needsSecondPage,
  slicePages,
} from './gutendexPagination';

export interface GutenbergAuthor {
  name: string;
}

export interface GutenbergBook {
  id: number;
  title: string;
  authors: GutenbergAuthor[];
  subjects: string[];
  bookshelves: string[];
  download_count: number;
  cover_image: string | null;
  /** Gutendex does not surface a release date; always null. Modal renders "—". */
  issued: string | null;
  /** Gutendex does not surface a reading-ease score; always null. Modal renders "—". */
  reading_ease_score: string | null;
}

export type FetchResult =
  | { kind: 'ok'; books: GutenbergBook[] }
  | { kind: 'api-error' }
  | { kind: 'offline' };

function isOffline(): boolean {
  const nav =
    typeof globalThis.navigator === 'undefined'
      ? undefined
      : globalThis.navigator;
  return typeof nav?.onLine === 'boolean' && nav.onLine === false;
}

/**
 * Fetch the 4-book window starting at `cursor` (the value of
 * gutenberg_panel_state.cursor_offset). Issues one or two Gutendex page
 * requests, slices, and returns 4 books. Network/HTTP failures classify as
 * 'offline' (navigator.onLine === false OR invoke threw a network-shaped
 * error) or 'api-error' (everything else).
 */
export async function fetchBooks(cursor: number): Promise<FetchResult> {
  if (isOffline()) return { kind: 'offline' };

  const { page, slice } = cursorToPageSlice(cursor);

  try {
    const firstPage = await fetchGutendexPage(page);
    const secondPage = needsSecondPage(slice)
      ? await fetchGutendexPage(page + 1)
      : undefined;
    const books = slicePages(slice, firstPage, secondPage);
    return { kind: 'ok', books };
  } catch (err) {
    if (isOffline()) return { kind: 'offline' };
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('network:')) return { kind: 'offline' };
    return { kind: 'api-error' };
  }
}
```

Notes:

- `verifyKey` is **deleted** — there is no key to verify.
- `FetchResult` loses the `invalid-key` variant.
- `RAPIDAPI_HOST`, header construction, and the raw `fetch` call are gone.
- Error classification matches the Rust command's prefixes (`network:`, `server:`, `decode:`, `client:`). Only `network:` → `offline`; everything else → `api-error`.

**File: `tests/lib/gutenbergApi.test.ts` (rewrite)**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { fetchBooks, type GutenbergBook } from '../../src/lib/gutenbergApi';
import { GUTENDEX_PAGE_SIZE } from '../../src/lib/gutendexPagination';

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

const PAGE_1 = Array.from({ length: GUTENDEX_PAGE_SIZE }, (_, i) =>
  makeBook(i + 1),
);
const PAGE_2 = Array.from({ length: GUTENDEX_PAGE_SIZE }, (_, i) =>
  makeBook(i + 33),
);

function defineNavigatorOnline(onLine: boolean) {
  const existing = globalThis.navigator;
  if (existing) {
    Object.defineProperty(existing, 'onLine', {
      configurable: true,
      get: () => onLine,
    });
    return;
  }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine },
  });
}

describe('lib/gutenbergApi.fetchBooks', () => {
  let originalNavigator: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    defineNavigatorOnline(true);
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator;
    }
  });

  it('returns offline before issuing a call when navigator is offline', async () => {
    defineNavigatorOnline(false);
    const result = await fetchBooks(0);
    expect(result.kind).toBe('offline');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('issues one page call for in-page windows and returns 4 books', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ books: PAGE_1 });
    const result = await fetchBooks(8);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('fetch_gutendex_page', { page: 1 });
    expect(result.books.map((b) => b.id)).toEqual([9, 10, 11, 12]);
  });

  it('crosses to the next page when the window straddles', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ books: PAGE_1 })
      .mockResolvedValueOnce({ books: PAGE_2 });
    const result = await fetchBooks(30);
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(1, 'fetch_gutendex_page', { page: 1 });
    expect(invoke).toHaveBeenNthCalledWith(2, 'fetch_gutendex_page', { page: 2 });
    expect(result.books.map((b) => b.id)).toEqual([31, 32, 33, 34]);
  });

  it('maps cursor 396 → page 13', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ books: PAGE_1 });
    await fetchBooks(396);
    expect(invoke).toHaveBeenCalledWith('fetch_gutendex_page', { page: 13 });
  });

  it("classifies the Rust 'network:' error prefix as offline", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('network: dns failure'));
    const result = await fetchBooks(0);
    expect(result.kind).toBe('offline');
  });

  it("classifies the Rust 'server:' error prefix as api-error", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('server: HTTP 503'));
    const result = await fetchBooks(0);
    expect(result.kind).toBe('api-error');
  });

  it("classifies 'decode:' errors as api-error", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('decode: bad json'));
    const result = await fetchBooks(0);
    expect(result.kind).toBe('api-error');
  });
});
```

**File: `tests/db/gutenbergPanel.test.ts` (edit)** — replace the fixture so it satisfies the narrowed `GutenbergBook` type:

```ts
const FAKE_BOOK: GutenbergBook = {
  id: 1,
  title: 'Pride and Prejudice',
  authors: [{ name: 'Austen, Jane' }],
  subjects: ['Romance'],
  bookshelves: [],
  download_count: 1,
  cover_image: null,
  issued: null,
  reading_ease_score: null,
};
```

(The rest of the file is unchanged — the DB layer doesn't care about payload internals.)

**File: `src/testHooks.ts` (edit)** — no logic change, but the existing `import type { GutenbergBook } from './lib/gutenbergApi';` and the `seedGutenbergCache` signature now reference the narrowed shape. Test fixtures passed into this hook in Playwright will need the new shape (handled in Task 8).

**Verify locally:**

```
npm test -- gutenbergApi gutenbergPanel gutendexPagination
# Expected: all green.
npx tsc --noEmit
# Expected: clean. Errors here will be in DetailModal / Gutenberg/index.tsx / store.ts —
# they get fixed in Tasks 4–6. Acceptable to leave those for the next task.
```

**Commit:** `feat(gutenberg): replace rapidapi fetchBooks with gutendex orchestration`

---

## Task 4 — Simplify panel state machine and delete `ApiKeyForm.tsx`

**Why:** with no key, the `missing-key` and `invalid-key` branches are dead.

**File: `src/screens/Library/Gutenberg/types.ts` (edit, full replacement)**

```ts
import type { GutenbergBook } from '../../../lib/gutenbergApi';

export type PanelState =
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'api-error' }
  | { kind: 'ready'; books: GutenbergBook[] };

export type { GutenbergBook };
```

**File: `src/screens/Library/Gutenberg/index.tsx` (edit, full replacement)**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDb } from '../../../db/client';
import {
  advanceCursor,
  getCachedFetch,
  setCachedFetch,
} from '../../../db/gutenbergPanel';
import { fetchBooks, type GutenbergBook } from '../../../lib/gutenbergApi';
import {
  FRESHNESS_TTL_MS,
  isFresh,
} from '../../../lib/gutenbergCacheFreshness';
import { ApiErrorState } from './ApiErrorState';
import { BookGrid2x2 } from './BookGrid2x2';
import { DetailModal } from './DetailModal';
import { LoadingSkeleton } from './LoadingSkeleton';
import { OfflineState } from './OfflineState';
import { PanelHeading } from './PanelHeading';
import type { PanelState } from './types';

export function GutenbergPanel() {
  const [state, setState] = useState<PanelState>({ kind: 'loading' });
  const [selected, setSelected] = useState<GutenbergBook | null>(null);
  const evaluatingRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const evaluateRef = useRef<() => Promise<void>>(async () => {});

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current === null) return;
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = null;
  }, []);

  const scheduleRefresh = useCallback(
    (lastFetchedAt: number | null, now: number) => {
      clearRefreshTimer();
      if (lastFetchedAt === null) return;
      const refreshIn = Math.max(0, lastFetchedAt + FRESHNESS_TTL_MS - now);
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        void evaluateRef.current();
      }, refreshIn);
    },
    [clearRefreshTimer],
  );

  const evaluate = useCallback(async () => {
    if (evaluatingRef.current) return;
    evaluatingRef.current = true;
    try {
      const db = await getDb();
      const cache = await getCachedFetch(db);
      const hasCachedPayload = Boolean(cache.payload && cache.payload.length > 0);

      if (hasCachedPayload && isFresh(cache.lastFetchedAt, Date.now())) {
        scheduleRefresh(cache.lastFetchedAt, Date.now());
        setState({ kind: 'ready', books: cache.payload! });
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        clearRefreshTimer();
        setState(
          hasCachedPayload
            ? { kind: 'ready', books: cache.payload! }
            : { kind: 'offline' },
        );
        return;
      }

      setState({ kind: 'loading' });
      const result = await fetchBooks(cache.cursor);
      if (result.kind === 'ok') {
        const fetchedAt = Date.now();
        const next = {
          cursor: advanceCursor(cache.cursor),
          lastFetchedAt: fetchedAt,
          payload: result.books,
        };
        await setCachedFetch(db, next);
        scheduleRefresh(next.lastFetchedAt, fetchedAt);
        setState({ kind: 'ready', books: result.books });
        return;
      }
      if (hasCachedPayload) {
        clearRefreshTimer();
        setState({ kind: 'ready', books: cache.payload! });
        return;
      }
      clearRefreshTimer();
      setState({
        kind: result.kind === 'offline' ? 'offline' : 'api-error',
      });
    } finally {
      evaluatingRef.current = false;
    }
  }, [clearRefreshTimer, scheduleRefresh]);

  useEffect(() => {
    evaluateRef.current = evaluate;
  }, [evaluate]);

  useEffect(() => {
    void evaluate();
  }, [evaluate]);

  useEffect(() => clearRefreshTimer, [clearRefreshTimer]);

  useEffect(() => {
    const onOnline = () => {
      setState((prev) =>
        prev.kind === 'offline' ? { kind: 'loading' } : prev,
      );
      void evaluate();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [evaluate]);

  const handleRetry = useCallback(() => {
    void evaluate();
  }, [evaluate]);

  return (
    <div className="flex flex-[2] flex-col gap-3 rounded-md border border-stone-200 bg-cream p-4">
      <PanelHeading />
      {state.kind === 'loading' && <LoadingSkeleton />}
      {state.kind === 'offline' && <OfflineState />}
      {state.kind === 'api-error' && <ApiErrorState onRetry={handleRetry} />}
      {state.kind === 'ready' && (
        <BookGrid2x2 books={state.books} onSelect={setSelected} />
      )}
      <DetailModal book={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
```

**File: `src/screens/Library/Gutenberg/ApiKeyForm.tsx` (delete)**

```
rm src/screens/Library/Gutenberg/ApiKeyForm.tsx
```

**Verify locally:**

```
npx tsc --noEmit
# Expected: errors remain only in store.ts / Settings/index.tsx / App.tsx
# (Gutenberg panel itself now compiles.)
npm run lint -- src/screens/Library/Gutenberg
```

**Commit:** `refactor(gutenberg): remove api-key panel states and ApiKeyForm`

---

## Task 5 — Render `—` in `DetailModal` for missing fields

**Why:** the spec promised "Released" and "Reading ease" rows in the detail modal. Gutendex doesn't supply those values; show `—` so the user knows the metadata is intentionally absent rather than the row being silently hidden.

**File: `src/screens/Library/Gutenberg/DetailModal.tsx` (edit)**

Change `MetaRow` from:

```tsx
function MetaRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="w-24 shrink-0 text-ink-muted">{label}</span>
      <span className="text-ink/40">·</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}
```

to:

```tsx
function MetaRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="w-24 shrink-0 text-ink-muted">{label}</span>
      <span className="text-ink/40">·</span>
      <span className="text-ink">{value ?? '—'}</span>
    </div>
  );
}
```

Leave the four `<MetaRow>` call sites untouched — `formatIssued(book.issued)` already returns null when `issued` is null, and `book.reading_ease_score` is already typed `string | null`. With Gutendex, both are always null, both rows render `—`.

**Verify locally:**

```
npm run tauri dev
# Click any tile → modal opens → "Released  ·  —" and "Reading ease  ·  —" visible.
# "Downloads" and "Publisher" still show real values.
```

**Commit:** `feat(gutenberg): render — for unavailable metadata fields`

---

## Task 6 — Strip `gutenbergApiKey` from store, App boot, and Settings

**Why:** with no key in play, the store slice is dead state and the Settings form is misleading.

**File: `src/store.ts` (edit)**

Remove from the `AppState` interface (lines 28–29 + 57–58):

```ts
gutenbergApiKey: string | null;
gutenbergApiKeyError: string | null;
// ...
loadGutenbergApiKey: () => Promise<void>;
saveGutenbergApiKey: (key: string) => Promise<void>;
```

Remove from the initial state (lines 104–105):

```ts
gutenbergApiKey: null,
gutenbergApiKeyError: null,
```

Remove the two action implementations (lines 165–192): `loadGutenbergApiKey: async () => { ... }` and `saveGutenbergApiKey: async (key) => { ... }`.

**File: `src/App.tsx` (edit, full replacement)**

```tsx
import { useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { useAppStore } from './store';
import { LibraryScreen } from './screens/Library';
import { SettingsScreen } from './screens/Settings';
import { ReaderScreen } from './screens/Reader';

export default function App() {
  const view = useAppStore((s) => s.view);
  const loadBooks = useAppStore((s) => s.loadBooks);
  const loadOpenrouterApiKey = useAppStore((s) => s.loadOpenrouterApiKey);
  const runMetadataExtractionPass = useAppStore(
    (s) => s.runMetadataExtractionPass,
  );

  useEffect(() => {
    void (async () => {
      await Promise.all([loadOpenrouterApiKey(), loadBooks()]);
      void runMetadataExtractionPass();
    })();
  }, [loadOpenrouterApiKey, loadBooks, runMetadataExtractionPass]);

  return (
    <>
      {view === 'library' && <LibraryScreen />}
      {view === 'settings' && <SettingsScreen />}
      {view === 'reader' && <ReaderScreen />}
      <Toaster richColors closeButton position="bottom-right" />
    </>
  );
}
```

**File: `src/screens/Settings/index.tsx` (edit)**

Delete lines 36–45 (the second `<hr/>` plus the `ApiKeyForm` block for Gutenberg). The result around the OpenRouter form should be:

```tsx
<ApiKeyForm
  storeKey="openrouterApiKey"
  saveAction="saveOpenrouterApiKey"
  heading="OpenRouter API Key"
  description="Used by the AI study mentor. Stored in your OS keychain; never written to disk by Scholara. The free default model works without billing."
  placeholder="sk-or-v1-..."
  helpHref="https://openrouter.ai/keys"
  helpLabel="Get a key at openrouter.ai/keys →"
/>
<hr className="border-stone-200" />
<ModelPicker />
```

**Verify locally:**

```
npx tsc --noEmit
# Expected: no errors anywhere except possibly Settings ApiKeyForm `storeKey` union —
# if the component's prop type currently lists 'gutenbergApiKey' / 'saveGutenbergApiKey'
# as allowed string literals, narrow them to only the openrouter variants. Check
# src/screens/Settings/ApiKeyForm.tsx and tighten the Props union if needed.
npm run lint
```

If `src/screens/Settings/ApiKeyForm.tsx` has a `storeKey: 'openrouterApiKey' | 'gutenbergApiKey'` union (or similar for `saveAction`), narrow each to the openrouter literal only. The component already uses these as type-safe keys into `AppState`; removing the gutenberg slice from `AppState` will surface this as a TS error and the fix is mechanical — delete the dead arm.

**Commit:** `refactor(gutenberg): drop gutenbergApiKey from store, App boot, Settings`

---

## Task 7 — Remove `gutenberg` from Rust secrets `account_for`

**Why:** nothing on the renderer side calls `getSecret('gutenberg')` anymore; the arm is dead, and keeping it implies the keychain entry is still meaningful.

**File: `src-tauri/src/commands/secrets.rs` (edit)**

Change lines 7–13 from:

```rust
fn account_for(name: &str) -> Result<&'static str, String> {
    match name {
        "openrouter" => Ok("openrouter_api_key"),
        "gutenberg" => Ok("gutenberg_api_key"),
        _ => Err(format!("Unknown secret name={name}")),
    }
}
```

to:

```rust
fn account_for(name: &str) -> Result<&'static str, String> {
    match name {
        "openrouter" => Ok("openrouter_api_key"),
        _ => Err(format!("Unknown secret name={name}")),
    }
}
```

**Stale-keychain note:** any existing `scholara` / `gutenberg_api_key` entries in the user's OS keychain become unreachable from Scholara. This mirrors the precedent CLAUDE.md already documents for `anthropic_api_key` from the pre-OpenRouter era. No cleanup ship — leaving orphaned entries is intentional.

**Verify locally:**

```
cargo check --manifest-path src-tauri/Cargo.toml
# Expected: clean compile.
npm run tauri dev
# Expected: app boots without trying to read a gutenberg secret. No console warning.
```

**Commit:** `refactor(secrets): drop gutenberg keychain account`

---

## Task 8 — Update Playwright e2e

**Why:** the existing spec routes RapidAPI URLs that the renderer no longer calls, preloads a `gutenberg` keychain entry the app no longer reads, and exercises four key-form scenarios that no longer exist.

**File: `tests/playwright/gutenberg-panel.spec.ts` (edit)**

**Replace the fixture shape.** Update `FAKE_BOOKS_RESPONSE`, `NEXT_FAKE_BOOKS_RESPONSE`, and `CACHED_BOOKS` so each book object matches the new `GutenbergBook` shape exactly (no `alternative_title`, no `media_type`, authors have only `name`, `issued` and `reading_ease_score` set to `null`):

```ts
const FAKE_BOOKS_RESPONSE = {
  books: [
    {
      id: 1342,
      title: 'Pride and Prejudice',
      authors: [{ name: 'Austen, Jane' }],
      subjects: ['Romance', 'England -- Fiction'],
      bookshelves: ['Best Books Ever Listings'],
      download_count: 62904,
      cover_image: 'https://example.invalid/cover-1342.jpg',
      issued: null,
      reading_ease_score: null,
    },
    {
      id: 11,
      title: "Alice's Adventures in Wonderland",
      authors: [{ name: 'Carroll, Lewis' }],
      subjects: ['Fantasy'],
      bookshelves: [],
      download_count: 30000,
      cover_image: 'https://example.invalid/cover-11.jpg',
      issued: null,
      reading_ease_score: null,
    },
    {
      id: 84,
      title: 'Frankenstein',
      authors: [{ name: 'Shelley, Mary' }],
      subjects: ['Horror'],
      bookshelves: [],
      download_count: 25000,
      cover_image: 'https://example.invalid/cover-84.jpg',
      issued: null,
      reading_ease_score: null,
    },
    {
      id: 74,
      title: 'The Adventures of Tom Sawyer',
      authors: [{ name: 'Twain, Mark' }],
      subjects: ['Adventure'],
      bookshelves: [],
      download_count: 20000,
      cover_image: 'https://example.invalid/cover-74.jpg',
      issued: null,
      reading_ease_score: null,
    },
  ],
};
```

`NEXT_FAKE_BOOKS_RESPONSE` and `CACHED_BOOKS` follow the same shape transformation.

**Mock the IPC, not the HTTP.** Gutendex traffic now goes through `invoke('fetch_gutendex_page', ...)`. Playwright can't intercept Tauri IPC from outside, so use the existing `__SCHOLARA_INVOKE_OVERRIDES__` pattern (or whatever the project uses for `download_gutenberg_epub` test stubs — search `testHooks.ts` and `vite.config` for the existing pattern). If no IPC mock helper exists yet, add one alongside the existing `__SCHOLARA_DB_MOCK__` / `__SCHOLARA_SECRETS__` hooks in `src/testHooks.ts`:

```ts
// Excerpt to ADD inside installTestHooks() in src/testHooks.ts
interface InvokeOverride {
  fetch_gutendex_page?: (args: { page: number }) => unknown;
}
const overrides = (window as Window & { __SCHOLARA_INVOKE_OVERRIDES__?: InvokeOverride })
  .__SCHOLARA_INVOKE_OVERRIDES__;
// (Wire this into the existing invoke shim that Playwright already uses for IPC.)
```

If the codebase already routes test IPC through a single shim (likely — `download_gutenberg_epub` is mocked in the "Add-to-library" test), add `fetch_gutendex_page` to the same shim's known-mock list. **Confirm the shim location before editing** — grep `download_gutenberg_epub` in `src/testHooks.ts` and `vite.config.*`.

**Replace `page.route(...)` calls.** Remove every `page.route('https://project-gutenberg-free-books-api1.p.rapidapi.com/**', ...)` block (in `test.beforeEach`, in `routeGutenbergBooks`, and in the "stale cached books when fetch fails" test). Instead, set per-test IPC overrides via `page.addInitScript`:

```ts
async function mockGutendexPage(
  page: Page,
  responseByPage: Record<number, { books: typeof FAKE_BOOKS_RESPONSE.books }>,
  capturedPages: number[],
) {
  await page.addInitScript((mocks) => {
    (window as Window & { __SCHOLARA_INVOKE_OVERRIDES__?: unknown })
      .__SCHOLARA_INVOKE_OVERRIDES__ = {
        fetch_gutendex_page: ({ page }: { page: number }) => {
          (window as Window & { __captured__?: number[] }).__captured__?.push(page);
          return mocks[page] ?? { books: [] };
        },
      };
    (window as Window & { __captured__?: number[] }).__captured__ = [];
  }, responseByPage);

  // Pull captured page numbers back out at assertion time:
  // capturedPages.push(...(await page.evaluate(() => (window as any).__captured__ ?? [])));
}
```

(Adapt to whatever IPC-mock primitive `download_gutenberg_epub` already uses; do **not** invent a parallel mechanism.)

**Delete the following tests** (key-related, no longer applicable):

- `panel shows inline form when no key is saved`
- `panel renders 4 covers after key is saved` — replace with `panel renders 4 covers on first launch` (no key step, just navigate and assert).
- `panel shows a keychain save error when saving the Gutenberg key fails`
- `panel shows a keychain load error when loading the Gutenberg key fails`
- `panel shows a persistence error when the Gutenberg key is missing after save`

Also remove the `preloadSecrets(page, { gutenberg: 'fake-rapidapi-key' })` calls from the remaining tests — no gutenberg secret is read anymore. (Keep `preloadSecrets` for any openrouter usage if present elsewhere; otherwise drop the helper.)

**Update offset assertions.** The "fetches the next 4 books when cached launch data is 24h old" and "panel refreshes automatically when a fresh cached set crosses 24h" tests assert `expect(offsets).toEqual([4])` / `[8]`. After the switch, offsets become *page numbers* (always 1 in production because cursor 4 → page 1, cursor 8 → page 1). Rename `offsets` → `pagesRequested` and assert `[1]`. For the cross-24h test, seed `cursor: 32` instead of `8` so the assertion `pagesRequested = [2]` is meaningful (proves the new fetch actually walked the catalog).

**Verify locally:**

```
npm run build
npx playwright test tests/playwright/gutenberg-panel.spec.ts
# Expected: all remaining tests pass.
```

**Commit:** `test(gutenberg): switch Playwright spec to gutendex IPC mocks`

---

## Task 9 — Verify the full path end-to-end and commit

**Why:** seven commits in, exercise the running app once.

**Steps:**

1. Wipe the local cache so the first fetch path runs:

   ```sql
   -- Open the dev SQLite (path printed by Settings → Data Location)
   UPDATE gutenberg_panel_state SET cursor_offset = 0, last_fetched_at = NULL, payload_json = NULL WHERE id = 1;
   ```

2. `npm run tauri dev`. Library mounts.

3. Watch the network panel (DevTools → Network in the webview, or `RUST_LOG=reqwest=debug` if you want to see Rust): expect **one** request to `https://gutendex.com/books?sort=popular&page=1`. No request to any `rapidapi.com` host.

4. Confirm the panel shows the top-4 PG titles (typically *Frankenstein* / *Romeo and Juliet* / *Pride and Prejudice* / *Moby-Dick*, ordering varies).

5. Inspect `gutenberg_panel_state`:

   ```sql
   SELECT cursor_offset, last_fetched_at FROM gutenberg_panel_state;
   ```

   Expected: `cursor_offset = 4`, `last_fetched_at` = the recent unix-ms.

6. Manually fast-forward the cache: `UPDATE gutenberg_panel_state SET last_fetched_at = 1;` then reload the app. Expect a Gutendex request and a different set of 4 books (ranks 5–8). `cursor_offset` should now be `8`.

7. Open a tile → modal shows the title, author, "Released  ·  —", "Reading ease  ·  —", real download count, subjects, bookshelves.

8. Click "Add to library" → EPUB downloads, modal closes, book appears in the main grid. (This path is unchanged from before; the smoke-test confirms `download_gutenberg_epub` was untouched.)

9. Toggle offline (DevTools → Network → Offline), reload — panel shows the offline state. Toggle back online — auto-recovers (the existing `online` event listener handles this).

10. Settings screen: only the OpenRouter form is present. No Project Gutenberg form.

**If any step fails:** check the Rust command log for HTTP status. Gutendex very occasionally 502s under load; the panel should render the cached payload silently if cache exists, or show `api-error` with a retry button otherwise — both are correct outcomes.

**Commit (combined doc + final tweaks if any):** `docs(gutenberg): record gutendex switch verification`

---

## Self-Review

**Spec coverage** (against `2026-05-06-gutenberg-panel-design.md`):

- §1.2 panel UX (2×2 grid, heading, detail modal, add-to-library, daily rotation, cursor wrap, single-row cache) — unchanged. ✅
- §1.2 generalized secrets IPC — kept for OpenRouter; the gutenberg arm is dropped intentionally (this is the goal). ✅
- §1.2 inline ApiKeyForm — **deliberately removed** (Task 4). Spec §6 error-copy row for missing-key/invalid-key likewise stops applying. ✅
- §2 row #6 (generalize secrets IPC) — still satisfied for OpenRouter. ✅
- §2 row #9 (missing-key UX) — superseded by this plan; no key exists. ✅
- §2 row #10 (error precedence) — collapses to offline / api-error only. Task 4 preserves the "render cached payload silently if a refresh fails" branch. ✅
- §2 row #12 (sort param "known unknown") — resolved by Gutendex's documented `sort=popular`. ✅
- §3.6 daily refresh — unchanged. ✅
- §4.1 migration — reused as-is, no schema change. ✅
- §5.8 DetailModal — `issued` and `reading_ease_score` rows now render `—` per Task 5. ✅
- §7 CLAUDE.md secrets constraint — still holds (OpenRouter uses it). No CLAUDE.md edit. ✅
- §10 known unknowns — pagination param (`page`, 1-indexed, Gutendex-native) and sort param (`sort=popular`) both nailed down. ✅

**Placeholder scan:**

- No "TBD", "fill in", "handle edge cases" appears in any task body.
- All file paths are absolute or repo-relative.
- All code blocks are complete (no `// ...` ellipses in code the engineer should type).
- The one exception is Task 8's IPC-mock primitive: I instruct the engineer to **grep `download_gutenberg_epub` in `src/testHooks.ts` and `vite.config.*` to find the existing shim** rather than inventing a new one, because the project's exact IPC-mock pattern wasn't in scope of the read I did. This is a directed lookup, not a placeholder.

**Type consistency:**

- `GutenbergBook` shape: `authors: GutenbergAuthor[]` with `GutenbergAuthor = { name: string }`. Used identically in Rust serde struct (Task 1), TS type (Task 3), DB test fixture (Task 3), Playwright fixtures (Task 8), pagination tests (Task 2), api tests (Task 3).
- `FetchResult` collapses to three variants (`ok | api-error | offline`). All callers in Task 4's `evaluate()` handle exactly these.
- `PanelState` collapses to four variants. All four are rendered in Task 4's JSX.
- Rust error prefixes (`network:`, `server:`, `decode:`, `client:`) are matched by the TS classifier in Task 3.

**Task ordering / dependencies:**

1. Rust command (Task 1) — independent, foundation.
2. TS helpers + IPC wrapper (Task 2) — depends on 1 existing in Rust handler registration; vitest mocks `invoke` so works even before the command is built.
3. Rewrite `gutenbergApi.ts` (Task 3) — type changes ripple; subsequent tasks fix the resulting TS errors.
4. Panel + delete form (Task 4) — fixes the Gutenberg-screen-side TS errors.
5. DetailModal tweak (Task 5) — small, independent.
6. Store / App / Settings (Task 6) — fixes the remaining TS errors.
7. Rust secrets arm (Task 7) — independent; safe because Task 6 already removed the only caller.
8. Playwright (Task 8) — runs against the integrated app.
9. Manual verification (Task 9) — gate before shipping.

Per the project's "Version Control" rule, each task ends with a commit. Per the project's debugging/feature workflow, this plan was preceded by a root-cause investigation (RapidAPI `offset` likely unhonored) and an approved design (the prior conversation turn). No subagent gate is needed for a refactor of this size unless the executor disagrees.
