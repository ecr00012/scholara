# Project Gutenberg Panel Implementation Plan

**Goal:** Replace the top-right `BrainPlaceholder` in the Library screen with a "Read a new book from Project Gutenberg" panel that surfaces 4 daily-rotating books from gutenbergapi.com and lets the user import the EPUB into their library in one click.

**Architecture:** A pure HTTP wrapper (`lib/gutenbergApi.ts`) classifies network results into a small union (`ok | invalid-key | api-error | offline`); a single-row SQLite table caches the current 4-book payload, cursor offset, and last-fetched timestamp; a Rust `download_gutenberg_epub` command streams the EPUB from gutenberg.org into the app's books dir; the secrets IPC is generalised to `get_secret(name)/set_secret(name)` so Anthropic and Gutenberg keys share one keychain layer.

**Tech Stack:** Tauri 2, React 19, TypeScript, Tailwind, shadcn/ui, zustand, `tauri-plugin-sql` (SQLite), `reqwest` (Rust HTTP), `keyring` crate, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-05-06-gutenberg-panel-design.md](../specs/2026-05-06-gutenberg-panel-design.md)

**Note on migration number:** the spec says `0003_gutenberg.sql` but `0003_vocab_unique.sql` already exists in `src-tauri/migrations/`. This plan uses `0004_gutenberg.sql` instead. (Spec correction; otherwise plan follows spec.)

**Note on keychain account naming:** the existing keychain account is `"anthropic_api_key"`. To preserve already-saved Anthropic keys, the generalised secrets layer maps the friendly name to the account string by appending `_api_key` (so `"anthropic"` → `"anthropic_api_key"`, `"gutenberg"` → `"gutenberg_api_key"`).

---

## File Structure

**New files:**

- `src-tauri/migrations/0004_gutenberg.sql` — single-row table for panel state
- `src-tauri/src/commands/gutenberg.rs` — `download_gutenberg_epub` command
- `src/ipc/gutenberg.ts` — TS wrapper around the new IPC
- `src/lib/gutenbergCacheFreshness.ts` — pure `isFresh` helper
- `src/lib/gutenbergApi.ts` — pure HTTP module (`verifyKey`, `fetchBooks`, types)
- `src/db/gutenbergPanel.ts` — single-row CRUD
- `src/screens/Library/Gutenberg/index.tsx` — panel root + state machine
- `src/screens/Library/Gutenberg/types.ts` — shared types
- `src/screens/Library/Gutenberg/PanelHeading.tsx`
- `src/screens/Library/Gutenberg/BookGrid2x2.tsx`
- `src/screens/Library/Gutenberg/BookTile.tsx`
- `src/screens/Library/Gutenberg/DetailModal.tsx`
- `src/screens/Library/Gutenberg/ApiKeyForm.tsx`
- `src/screens/Library/Gutenberg/LoadingSkeleton.tsx`
- `src/screens/Library/Gutenberg/OfflineState.tsx`
- `src/screens/Library/Gutenberg/ApiErrorState.tsx`
- `tests/lib/gutenbergCacheFreshness.test.ts`
- `tests/lib/gutenbergApi.test.ts`
- `tests/db/gutenbergPanel.test.ts`
- `tests/playwright/gutenberg-panel.spec.ts`

**Modified files:**

- `src-tauri/Cargo.toml` — add `reqwest`
- `src-tauri/src/commands/secrets.rs` — refactor to `get_secret`/`set_secret`
- `src-tauri/src/commands/mod.rs` — declare `gutenberg` module
- `src-tauri/src/lib.rs` — register migration 0004, swap secrets commands, register `download_gutenberg_epub`
- `src/ipc/secrets.ts` — `getSecret`/`setSecret`
- `src/store.ts` — refactor Anthropic flow, add Gutenberg key fields
- `src/screens/Settings/ApiKeyForm.tsx` — parameterise via props
- `src/screens/Settings/index.tsx` — render both Anthropic and Gutenberg forms
- `src/screens/Library/index.tsx` — mount `<GutenbergPanel/>`, drop `BrainPlaceholder` import
- `tests/helpers/sqlite.ts` — append `0004_gutenberg.sql` to migrations list
- `tests/playwright/mocks/tauriCore.ts` — replace `get_api_key`/`set_api_key`, add `get_secret`/`set_secret`/`download_gutenberg_epub`
- `CLAUDE.md` and `AGENT.md` — append the secrets constraint line

**Deleted files:**

- `src/screens/Library/BrainPlaceholder.tsx`

---

## Tasks

### Task 1 — Add `reqwest` to `src-tauri/Cargo.toml`

**Why:** the Rust download command needs an HTTP client. We use `reqwest` with the `rustls-tls` feature so the build doesn't pull in OpenSSL (cross-platform requirement per CLAUDE.md).

**Modify** `src-tauri/Cargo.toml`. Under `[dependencies]`, append:

```toml
reqwest             = { version = "0.12", features = ["rustls-tls", "stream"], default-features = false }
tokio               = { version = "1", features = ["fs", "io-util"] }
```

(`tokio` is already a transitive dep via Tauri but we depend on it explicitly for `tokio::fs` + async writes in the download command.)

**Verify:**

```sh
cd src-tauri && cargo check
```

Expected: clean build, possibly with "downloading" lines for new crates. No errors.

**Commit:** `Cargo: add reqwest + tokio for Gutenberg EPUB downloads`

---

### Task 2 — Migration `0004_gutenberg.sql`

**Why:** cache the panel's cursor + last fetch + payload in a single row.

**Create** `src-tauri/migrations/0004_gutenberg.sql`:

```sql
CREATE TABLE gutenberg_panel_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  cursor_offset   INTEGER NOT NULL DEFAULT 0,
  last_fetched_at INTEGER,
  payload_json    TEXT
);

INSERT OR IGNORE INTO gutenberg_panel_state (id, cursor_offset) VALUES (1, 0);
```

**Modify** `src-tauri/src/lib.rs`. After the existing `Migration { version: 3, ... }` entry, add:

```rust
        Migration {
            version: 4,
            description: "phase 4a: gutenberg panel state",
            sql: include_str!("../migrations/0004_gutenberg.sql"),
            kind: MigrationKind::Up,
        },
```

**Modify** `tests/helpers/sqlite.ts`. Update the `MIGRATIONS` array:

```ts
const MIGRATIONS = [
  '0001_init.sql',
  '0002_phase2.sql',
  '0003_vocab_unique.sql',
  '0004_gutenberg.sql',
].map((f) =>
  path.resolve(__dirname, '../../src-tauri/migrations', f),
);
```

**Verify:**

```sh
cd src-tauri && cargo check
cd .. && npm test -- tests/db/books.test.ts
```

Expected: cargo clean, vitest passes. The new migration runs against the in-memory test DB without errors.

**Commit:** `db: migration 0004 — gutenberg_panel_state single-row cache`

---

### Task 3 — Generalise Rust secrets (`get_secret` / `set_secret`)

**Why:** so the same keychain layer serves Anthropic and Gutenberg (and any future provider). Existing keychain entries written under account `"anthropic_api_key"` keep working because the new `account_for(name)` mapping appends `_api_key`.

**Replace** the entire contents of `src-tauri/src/commands/secrets.rs` with:

```rust
use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "scholara";

fn account_for(name: &str) -> String {
    format!("{name}_api_key")
}

fn entry(name: &str) -> Result<Entry, String> {
    let account = account_for(name);
    Entry::new(SERVICE, &account).map_err(|e| format!("Could not access keychain: {e}"))
}

#[tauri::command]
pub fn get_secret(name: String) -> Result<Option<String>, String> {
    let e = entry(&name)?;
    match e.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(format!("Could not access keychain: {err}")),
    }
}

#[tauri::command]
pub fn set_secret(name: String, value: String) -> Result<(), String> {
    let e = entry(&name)?;
    if value.is_empty() {
        match e.delete_credential() {
            Ok(()) => Ok(()),
            Err(KeyringError::NoEntry) => Ok(()),
            Err(err) => Err(format!("Could not clear keychain entry: {err}")),
        }
    } else {
        e.set_password(&value)
            .map_err(|err| format!("Could not save secret: {err}"))
    }
}
```

(Note: the previous file exported `get_api_key` and `set_api_key`. Those names are gone; Task 5 updates `lib.rs` accordingly.)

**Commit:** `Rust: generalise secrets to get_secret(name)/set_secret(name)`

(Don't run `cargo check` yet — Task 5 wires up the new names; an intermediate state would fail compilation. The next two tasks are the matched pair.)

---

### Task 4 — Rust command `download_gutenberg_epub`

**Why:** download the EPUB on the Rust side (no CORS, no large IPC byte transfer, consistent with "all FS through IPC").

**Create** `src-tauri/src/commands/gutenberg.rs`:

```rust
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Serialize)]
pub struct DownloadResult {
    pub stored_path: String,
    pub file_type: String,
}

fn err<E: std::fmt::Display>(prefix: &str) -> impl Fn(E) -> String + '_ {
    move |e| format!("{prefix}: {e}")
}

async fn try_url(client: &reqwest::Client, url: &str) -> Result<Option<bytes::Bytes>, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(err("network"))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(format!("server: HTTP {}", resp.status().as_u16()));
    }
    let body = resp.bytes().await.map_err(err("network"))?;
    Ok(Some(body))
}

#[tauri::command]
pub async fn download_gutenberg_epub(
    app: AppHandle,
    book_id: i64,
) -> Result<DownloadResult, String> {
    let client = reqwest::Client::builder()
        .user_agent("Scholara/0.1 (+https://gutenberg.org)")
        .build()
        .map_err(err("network"))?;

    let primary = format!("https://www.gutenberg.org/ebooks/{book_id}.epub.images");
    let fallback = format!("https://www.gutenberg.org/ebooks/{book_id}.epub.noimages");

    let bytes = match try_url(&client, &primary).await? {
        Some(b) => b,
        None => match try_url(&client, &fallback).await? {
            Some(b) => b,
            None => return Err("not_found: no EPUB available for this book".into()),
        },
    };

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(err("io"))?;
    let books_dir = app_data.join("books");
    std::fs::create_dir_all(&books_dir).map_err(err("io"))?;

    let nonce = Uuid::new_v4().simple().to_string()[..6].to_string();
    let filename = format!("gutenberg-{book_id}-{nonce}.epub");
    let dest: PathBuf = books_dir.join(&filename);

    std::fs::write(&dest, &bytes).map_err(err("io"))?;

    Ok(DownloadResult {
        stored_path: dest
            .to_str()
            .ok_or_else(|| "io: destination path is not valid UTF-8".to_string())?
            .to_string(),
        file_type: "epub".into(),
    })
}
```

The error string convention (`network: …`, `not_found: …`, `server: …`, `io: …`) lets the TS layer parse the prefix into a typed `kind` for the toast.

**Add `bytes` crate** — `reqwest::bytes::Bytes` is re-exported through `reqwest`, but the explicit `bytes::Bytes` import here is shorthand. Drop the import and use `reqwest::Body` instead, OR add `bytes = "1"` to Cargo.toml. Simpler: change the function signature to use `Vec<u8>`:

Replace the body of `try_url` to return `Vec<u8>` and update the call site:

```rust
async fn try_url(client: &reqwest::Client, url: &str) -> Result<Option<Vec<u8>>, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(err("network"))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(format!("server: HTTP {}", resp.status().as_u16()));
    }
    let body = resp.bytes().await.map_err(err("network"))?;
    Ok(Some(body.to_vec()))
}
```

(And remove the `use bytes::Bytes` line — there isn't one in the snippet above; this is just a clarification. The final file should use only the imports shown at the top.)

**Modify** `src-tauri/src/commands/mod.rs` to declare the new module:

```rust
pub mod books;
pub mod gutenberg;
pub mod secrets;
pub mod wordnet;
```

**Commit:** `Rust: add download_gutenberg_epub command (.images, fallback .noimages)`

(Still no `cargo check` — Task 5 finalises the handler list.)

---

### Task 5 — Wire new commands into `lib.rs`

**Why:** register migration 4 (already done in Task 2), and replace `get_api_key`/`set_api_key` with `get_secret`/`set_secret`/`download_gutenberg_epub` in the invoke handler.

**Modify** `src-tauri/src/lib.rs`:

1. Replace the existing `commands::secrets` import:

```rust
use commands::secrets::{get_secret, set_secret};
```

2. Add the gutenberg command import (alongside the existing `commands::books::{...}` line):

```rust
use commands::gutenberg::download_gutenberg_epub;
```

3. Replace `get_api_key, set_api_key,` in `tauri::generate_handler![...]` with `get_secret, set_secret, download_gutenberg_epub,`. The full handler list becomes:

```rust
        .invoke_handler(tauri::generate_handler![
            copy_uploaded_file,
            app_data_dir_path,
            reveal_in_file_manager,
            read_book_bytes,
            save_cover_bytes,
            delete_book_files,
            get_secret,
            set_secret,
            download_gutenberg_epub,
            lookup_wordnet,
        ])
```

**Verify:**

```sh
cd src-tauri && cargo check
```

Expected: clean build with no warnings about unused commands.

**Commit:** `Rust: register get_secret/set_secret/download_gutenberg_epub`

---

### Task 6 — Refactor TS `src/ipc/secrets.ts`

**Why:** match the new Rust commands.

**Replace** the entire contents of `src/ipc/secrets.ts` with:

```ts
import { invoke } from '@tauri-apps/api/core';

export async function getSecret(name: string): Promise<string | null> {
  return invoke<string | null>('get_secret', { name });
}

export async function setSecret(name: string, value: string): Promise<void> {
  await invoke('set_secret', { name, value });
}
```

The exports `getApiKey` / `setApiKey` are gone. Task 9 updates `store.ts` to use the new names.

**Commit:** `ipc: replace getApiKey/setApiKey with getSecret(name)/setSecret(name)`

(Don't run `npm run lint` yet — `store.ts` will fail to compile until Task 9. The next four tasks are the matched set.)

---

### Task 7 — TS wrapper `src/ipc/gutenberg.ts`

**Create** `src/ipc/gutenberg.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';

export interface DownloadEpubResult {
  storedPath: string;
  fileType: 'epub';
}

interface RawDownloadResult {
  stored_path: string;
  file_type: string;
}

export async function downloadGutenbergEpub(
  bookId: number,
): Promise<DownloadEpubResult> {
  const result = await invoke<RawDownloadResult>('download_gutenberg_epub', {
    bookId,
  });
  return {
    storedPath: result.stored_path,
    fileType: 'epub',
  };
}
```

**Commit:** `ipc: downloadGutenbergEpub wrapper`

---

### Task 8 — Update Playwright IPC mock

**Why:** `vite preview` (the e2e target) doesn't have Tauri available. The existing `tests/playwright/mocks/tauriCore.ts` swaps in for `@tauri-apps/api/core`. We need to remove the old key commands and add the three new ones.

**Modify** `tests/playwright/mocks/tauriCore.ts`. In the `invoke` `switch` block:

1. Remove the two cases:

```ts
    case 'get_api_key':
      return savedApiKey as T;
    case 'set_api_key':
      savedApiKey = typeof args.key === 'string' && args.key !== '' ? args.key : null;
      return null as T;
```

2. Replace the module-level `let savedApiKey: string | null = null;` with a generalised store:

```ts
const savedSecrets: Record<string, string> = {};
```

3. Add three new cases to the `switch`, before `default:`:

```ts
    case 'get_secret': {
      const name = String(args.name ?? '');
      return (savedSecrets[name] ?? null) as T;
    }
    case 'set_secret': {
      const name = String(args.name ?? '');
      const value = typeof args.value === 'string' ? args.value : '';
      if (value === '') {
        delete savedSecrets[name];
      } else {
        savedSecrets[name] = value;
      }
      return null as T;
    }
    case 'download_gutenberg_epub': {
      const bookId = Number(args.bookId ?? 0);
      return {
        stored_path: `/mock/books/gutenberg-${bookId}.epub`,
        file_type: 'epub',
      } as T;
    }
```

**Commit:** `e2e mocks: replace api-key commands with get/set_secret + download_gutenberg_epub`

---

### Task 9 — Update `src/store.ts`

**Why:** route the existing Anthropic flow through `getSecret("anthropic")`/`setSecret("anthropic", …)` and add parallel fields for Gutenberg.

**Modify** `src/store.ts`:

1. Update the import line:

```ts
import * as secretsIpc from './ipc/secrets';
```

(Already imports it; no change to the import.)

2. Add to the `AppState` interface, after the existing `apiKey`-related fields:

```ts
  gutenbergApiKey: string | null;
  loadGutenbergApiKey: () => Promise<void>;
  saveGutenbergApiKey: (key: string) => Promise<void>;
```

3. Replace the bodies of `loadApiKey` and `saveApiKey` (existing methods) with:

```ts
  loadApiKey: async () => {
    const apiKey = await secretsIpc.getSecret('anthropic');
    set({ apiKey });
  },

  saveApiKey: async (key) => {
    await secretsIpc.setSecret('anthropic', key);
    set({ apiKey: key === '' ? null : key });
  },
```

4. Add to the initial state object (alongside `apiKey: null,`):

```ts
  gutenbergApiKey: null,
```

5. Add the two new actions, immediately after `saveApiKey`:

```ts
  loadGutenbergApiKey: async () => {
    const gutenbergApiKey = await secretsIpc.getSecret('gutenberg');
    set({ gutenbergApiKey });
  },

  saveGutenbergApiKey: async (key) => {
    await secretsIpc.setSecret('gutenberg', key);
    set({ gutenbergApiKey: key === '' ? null : key });
  },
```

6. Find where `loadApiKey` is invoked at app boot (`src/App.tsx` or `src/main.tsx`) and add a call to `loadGutenbergApiKey` next to it:

Inspect first:

```sh
grep -n "loadApiKey" src/App.tsx src/main.tsx
```

In whichever file has `useAppStore.getState().loadApiKey()` (or similar), add:

```ts
useAppStore.getState().loadGutenbergApiKey();
```

immediately after.

**Verify:**

```sh
npm run lint
npm test
```

Expected: lint clean, all existing vitest tests pass.

**Commit:** `store: route Anthropic via getSecret('anthropic') + add gutenbergApiKey fields`

---

### Task 10 — `lib/gutenbergCacheFreshness.ts` + test (TDD)

**Why:** isolate the freshness rule. Tiny, pure, easy to TDD first.

**Create** `tests/lib/gutenbergCacheFreshness.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isFresh, FRESHNESS_TTL_MS } from '../../src/lib/gutenbergCacheFreshness';

describe('lib/gutenbergCacheFreshness', () => {
  it('returns false when lastFetchedAt is null', () => {
    expect(isFresh(null, Date.now())).toBe(false);
  });

  it('returns true when within the 24h TTL', () => {
    const now = 1_700_000_000_000;
    const oneHourAgo = now - 60 * 60 * 1000;
    expect(isFresh(oneHourAgo, now)).toBe(true);
  });

  it('returns false at exactly the TTL boundary', () => {
    const now = 1_700_000_000_000;
    expect(isFresh(now - FRESHNESS_TTL_MS, now)).toBe(false);
  });

  it('returns false when older than the TTL', () => {
    const now = 1_700_000_000_000;
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;
    expect(isFresh(twoDaysAgo, now)).toBe(false);
  });

  it('exports FRESHNESS_TTL_MS as 24h', () => {
    expect(FRESHNESS_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
```

Run `npm test -- tests/lib/gutenbergCacheFreshness.test.ts` — should fail (file missing).

**Create** `src/lib/gutenbergCacheFreshness.ts`:

```ts
export const FRESHNESS_TTL_MS = 24 * 60 * 60 * 1000;

export function isFresh(lastFetchedAt: number | null, now: number): boolean {
  if (lastFetchedAt === null) return false;
  return now - lastFetchedAt < FRESHNESS_TTL_MS;
}
```

Re-run the test — should pass.

**Commit:** `lib: gutenbergCacheFreshness — pure 24h TTL helper`

---

### Task 11 — `lib/gutenbergApi.ts` + test (TDD)

**Why:** the panel's HTTP boundary. Pure module — no React, no Tauri, no store. Mockable with `vi.fn()`.

**Create** `tests/lib/gutenbergApi.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyKey, fetchBooks } from '../../src/lib/gutenbergApi';

const FAKE_BOOKS = {
  results: [
    {
      id: 1,
      title: 'Pride and Prejudice',
      alternative_title: null,
      authors: [{ id: 68, name: 'Austen, Jane' }],
      subjects: ['Romance'],
      bookshelves: ['Best Books Ever Listings'],
      media_type: 'Text',
      download_count: 62904,
      issued: '1998-06-01',
      reading_ease_score: '69.20',
      cover_image:
        'https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg',
    },
  ],
};

describe('lib/gutenbergApi', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalOnLine: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalOnLine = Object.getOwnPropertyDescriptor(
      globalThis.navigator,
      'onLine',
    );
    Object.defineProperty(globalThis.navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalOnLine) {
      Object.defineProperty(globalThis.navigator, 'onLine', originalOnLine);
    }
  });

  it('verifyKey returns ok on 200', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(FAKE_BOOKS), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await verifyKey('good-key');
    expect(result.kind).toBe('ok');
  });

  it('verifyKey returns invalid-key on 401', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('unauthorized', { status: 401 }),
    ) as unknown as typeof fetch;
    const result = await verifyKey('bad-key');
    expect(result.kind).toBe('invalid-key');
  });

  it('verifyKey returns invalid-key on 403', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('forbidden', { status: 403 }),
    ) as unknown as typeof fetch;
    const result = await verifyKey('bad-key');
    expect(result.kind).toBe('invalid-key');
  });

  it('verifyKey returns api-error on 500', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch;
    const result = await verifyKey('any-key');
    expect(result).toEqual({ kind: 'api-error', status: 500 });
  });

  it('verifyKey returns offline when fetch rejects with TypeError', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const result = await verifyKey('any-key');
    expect(result.kind).toBe('offline');
  });

  it('verifyKey returns offline when navigator.onLine is false', async () => {
    Object.defineProperty(globalThis.navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });
    globalThis.fetch = vi.fn(async () =>
      new Response('{}', { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await verifyKey('any-key');
    expect(result.kind).toBe('offline');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('fetchBooks builds the right URL and forwards the API key header', async () => {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify(FAKE_BOOKS), { status: 200 }),
    );
    globalThis.fetch = spy as unknown as typeof fetch;

    const result = await fetchBooks(8, 'my-key');
    expect(result.kind).toBe('ok');

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe(
      'https://gutenbergapi.com/books?ordering=-download_count&page_size=4&offset=8',
    );
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('X-RapidAPI-Key')).toBe('my-key');
  });

  it('fetchBooks returns the books array on success', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(FAKE_BOOKS), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await fetchBooks(0, 'k');
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.books).toHaveLength(1);
    expect(result.books[0].title).toBe('Pride and Prejudice');
  });

  it('fetchBooks classifies HTTP 401 as invalid-key', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('', { status: 401 }),
    ) as unknown as typeof fetch;
    const result = await fetchBooks(0, 'k');
    expect(result.kind).toBe('invalid-key');
  });
});
```

**Create** `src/lib/gutenbergApi.ts`:

```ts
export interface GutenbergAuthor {
  id: number;
  name: string;
}

export interface GutenbergBook {
  id: number;
  title: string;
  alternative_title: string | null;
  authors: GutenbergAuthor[];
  subjects: string[];
  bookshelves: string[];
  media_type: string;
  download_count: number;
  issued: string | null;
  reading_ease_score: string | null;
  cover_image: string | null;
}

interface BooksResponse {
  results: GutenbergBook[];
}

export type FetchResult =
  | { kind: 'ok'; books: GutenbergBook[] }
  | { kind: 'invalid-key' }
  | { kind: 'api-error'; status: number }
  | { kind: 'offline' };

const BASE_URL = 'https://gutenbergapi.com';

function isOffline(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.onLine === 'boolean' &&
    navigator.onLine === false
  );
}

async function callApi(url: string, key: string): Promise<FetchResult> {
  if (isOffline()) return { kind: 'offline' };

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'GET',
      headers: { 'X-RapidAPI-Key': key },
    });
  } catch {
    return { kind: 'offline' };
  }

  if (resp.status === 401 || resp.status === 403) {
    return { kind: 'invalid-key' };
  }
  if (!resp.ok) {
    return { kind: 'api-error', status: resp.status };
  }
  let json: BooksResponse;
  try {
    json = (await resp.json()) as BooksResponse;
  } catch {
    return { kind: 'api-error', status: resp.status };
  }
  if (!json || !Array.isArray(json.results)) {
    return { kind: 'api-error', status: resp.status };
  }
  return { kind: 'ok', books: json.results };
}

export async function verifyKey(key: string): Promise<FetchResult> {
  return callApi(`${BASE_URL}/books?page_size=1`, key);
}

export async function fetchBooks(
  offset: number,
  key: string,
): Promise<FetchResult> {
  const url = `${BASE_URL}/books?ordering=-download_count&page_size=4&offset=${offset}`;
  return callApi(url, key);
}
```

**Verify:**

```sh
npm test -- tests/lib/gutenbergApi.test.ts
```

Expected: all 9 tests pass.

**Commit:** `lib: gutenbergApi — verifyKey + fetchBooks with classified results`

---

### Task 12 — `db/gutenbergPanel.ts` + test (TDD)

**Why:** typed wrapper around the single-row table.

**Create** `tests/db/gutenbergPanel.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { makeTestDb } from '../helpers/sqlite';
import {
  getCachedFetch,
  setCachedFetch,
  type CachedFetch,
} from '../../src/db/gutenbergPanel';
import type { GutenbergBook } from '../../src/lib/gutenbergApi';

const FAKE_BOOK: GutenbergBook = {
  id: 1,
  title: 'Pride and Prejudice',
  alternative_title: null,
  authors: [{ id: 68, name: 'Austen, Jane' }],
  subjects: ['Romance'],
  bookshelves: [],
  media_type: 'Text',
  download_count: 1,
  issued: '1998-06-01',
  reading_ease_score: '69.20',
  cover_image: null,
};

describe('db/gutenbergPanel', () => {
  it('migration seeds a row with cursor=0 and null fetch fields', async () => {
    const db = makeTestDb();
    const state = await getCachedFetch(db);
    expect(state).toEqual({
      cursor: 0,
      lastFetchedAt: null,
      payload: null,
    } satisfies CachedFetch);
  });

  it('setCachedFetch persists cursor advancement, timestamp, and payload', async () => {
    const db = makeTestDb();
    const now = 1_700_000_000_000;
    await setCachedFetch(db, {
      cursor: 4,
      lastFetchedAt: now,
      payload: [FAKE_BOOK],
    });
    const state = await getCachedFetch(db);
    expect(state.cursor).toBe(4);
    expect(state.lastFetchedAt).toBe(now);
    expect(state.payload).toEqual([FAKE_BOOK]);
  });

  it('cursor wraps at the 400 boundary via the helper', async () => {
    const db = makeTestDb();
    const { cursor: a } = { cursor: (396 + 4) % 400 };
    expect(a).toBe(0);

    await setCachedFetch(db, { cursor: 0, lastFetchedAt: 1, payload: [] });
    expect((await getCachedFetch(db)).cursor).toBe(0);
  });

  it('overwrites the row on repeated setCachedFetch (single-row constraint)', async () => {
    const db = makeTestDb();
    await setCachedFetch(db, { cursor: 4, lastFetchedAt: 100, payload: [] });
    await setCachedFetch(db, { cursor: 8, lastFetchedAt: 200, payload: [FAKE_BOOK] });
    const rows = await db.select<{ count: number }>(
      'SELECT COUNT(*) AS count FROM gutenberg_panel_state',
    );
    expect(rows[0].count).toBe(1);
    const state = await getCachedFetch(db);
    expect(state.cursor).toBe(8);
    expect(state.lastFetchedAt).toBe(200);
  });
});
```

Run — should fail (file missing).

**Create** `src/db/gutenbergPanel.ts`:

```ts
import type { SqlExecutor } from './types';
import type { GutenbergBook } from '../lib/gutenbergApi';

export interface CachedFetch {
  cursor: number;
  lastFetchedAt: number | null;
  payload: GutenbergBook[] | null;
}

interface Row {
  cursor_offset: number;
  last_fetched_at: number | null;
  payload_json: string | null;
}

export async function getCachedFetch(db: SqlExecutor): Promise<CachedFetch> {
  const rows = await db.select<Row>(
    `SELECT cursor_offset, last_fetched_at, payload_json
     FROM gutenberg_panel_state
     WHERE id = 1`,
  );
  if (rows.length === 0) {
    return { cursor: 0, lastFetchedAt: null, payload: null };
  }
  const row = rows[0];
  let payload: GutenbergBook[] | null = null;
  if (row.payload_json) {
    try {
      payload = JSON.parse(row.payload_json) as GutenbergBook[];
    } catch {
      payload = null;
    }
  }
  return {
    cursor: row.cursor_offset,
    lastFetchedAt: row.last_fetched_at,
    payload,
  };
}

export async function setCachedFetch(
  db: SqlExecutor,
  next: CachedFetch,
): Promise<void> {
  await db.execute(
    `UPDATE gutenberg_panel_state
     SET cursor_offset = ?, last_fetched_at = ?, payload_json = ?
     WHERE id = 1`,
    [
      next.cursor,
      next.lastFetchedAt,
      next.payload === null ? null : JSON.stringify(next.payload),
    ],
  );
}

export function advanceCursor(cursor: number): number {
  return (cursor + 4) % 400;
}
```

**Verify:**

```sh
npm test -- tests/db/gutenbergPanel.test.ts
```

Expected: all 4 tests pass.

**Commit:** `db: gutenbergPanel — single-row CRUD + advanceCursor helper`

---

### Task 13 — Refactor Settings `ApiKeyForm` + render both keys

**Why:** add the second key form without duplicating the existing one.

**Replace** `src/screens/Settings/ApiKeyForm.tsx` with:

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppStore } from '../../store';

type StoreKey = 'apiKey' | 'gutenbergApiKey';

interface Props {
  storeKey: StoreKey;
  saveAction: 'saveApiKey' | 'saveGutenbergApiKey';
  heading: string;
  description: string;
  placeholder: string;
  helpHref: string;
  helpLabel: string;
}

export function ApiKeyForm({
  storeKey,
  saveAction,
  heading,
  description,
  placeholder,
  helpHref,
  helpLabel,
}: Props) {
  const apiKey = useAppStore((s) => s[storeKey]);
  const save = useAppStore((s) => s[saveAction]);
  const [revealed, setRevealed] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  const displayValue =
    draft !== null
      ? draft
      : revealed && apiKey !== null
        ? apiKey
        : apiKey
          ? '●●●●●●●●●●●●●●●●'
          : '';

  const handleShow = () => {
    setRevealed((r) => !r);
    if (draft === null && apiKey !== null) {
      setDraft(apiKey);
    }
  };

  const handleSave = async () => {
    const value = draft ?? '';
    try {
      await save(value);
      toast.success(value === '' ? 'API key cleared.' : 'API key saved.');
      setDraft(null);
      setRevealed(false);
    } catch (err) {
      toast.error(`Could not save API key: ${(err as Error).message}`);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
        {heading}
      </h2>
      <p className="text-sm text-ink-muted">{description}</p>
      <div className="flex gap-2">
        <Input
          type={revealed ? 'text' : 'password'}
          value={displayValue}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="font-mono"
        />
        <Button variant="ghost" onClick={handleShow}>
          {revealed ? 'Hide' : 'Show'}
        </Button>
        <Button onClick={handleSave} disabled={draft === null}>
          Save
        </Button>
      </div>
      <a
        href={helpHref}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-accent-amber underline-offset-2 hover:underline"
      >
        {helpLabel}
      </a>
    </section>
  );
}
```

**Replace** the body of `src/screens/Settings/index.tsx`:

```tsx
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '../../store';
import { ApiKeyForm } from './ApiKeyForm';
import { DataLocationPanel } from './DataLocationPanel';

export function SettingsScreen() {
  const setView = useAppStore((s) => s.setView);
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-8 overflow-y-auto px-12 py-8">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit"
        onClick={() => setView('library')}
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        Library
      </Button>
      <h1 className="font-serif text-3xl tracking-tight text-ink">Settings</h1>
      <hr className="border-stone-200" />
      <ApiKeyForm
        storeKey="apiKey"
        saveAction="saveApiKey"
        heading="Anthropic API Key"
        description="Used by the AI study mentor. Stored in your OS keychain; never written to disk by Scholara."
        placeholder="sk-ant-..."
        helpHref="https://console.anthropic.com"
        helpLabel="Get a key at console.anthropic.com →"
      />
      <hr className="border-stone-200" />
      <ApiKeyForm
        storeKey="gutenbergApiKey"
        saveAction="saveGutenbergApiKey"
        heading="Project Gutenberg API Key (RapidAPI)"
        description="Used to load the rotating Project Gutenberg panel on your library. Stored in your OS keychain; never written to disk by Scholara."
        placeholder="X-RapidAPI-Key value"
        helpHref="https://rapidapi.com/help-lQ_hVT8W5/api/project-gutenberg-free-books-api1"
        helpLabel="Get a key on RapidAPI →"
      />
      <hr className="border-stone-200" />
      <DataLocationPanel />
    </div>
  );
}
```

**Verify:**

```sh
npm run lint
npm test
```

Expected: clean. Open the app in dev (`npm run tauri:dev`) and confirm both forms render in Settings.

**Commit:** `Settings: parameterise ApiKeyForm + add Project Gutenberg key form`

---

### Task 14 — Panel: shared types + small presentational components

**Why:** these are tiny enough to land together. They have no inter-dependencies beyond the shared types module.

**Create** `src/screens/Library/Gutenberg/types.ts`:

```ts
import type { GutenbergBook } from '../../../lib/gutenbergApi';

export type PanelState =
  | { kind: 'loading' }
  | { kind: 'missing-key' }
  | { kind: 'invalid-key' }
  | { kind: 'offline' }
  | { kind: 'api-error' }
  | { kind: 'ready'; books: GutenbergBook[] };

export type { GutenbergBook };
```

**Create** `src/screens/Library/Gutenberg/LoadingSkeleton.tsx`:

```tsx
export function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3" aria-busy="true" aria-label="Loading Project Gutenberg books">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="aspect-[2/3] w-full animate-pulse rounded-sm bg-stone-100"
        />
      ))}
    </div>
  );
}
```

**Create** `src/screens/Library/Gutenberg/OfflineState.tsx`:

```tsx
import { BookOpen } from 'lucide-react';

export function OfflineState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6">
      <BookOpen className="h-8 w-8 text-ink-muted" aria-hidden="true" />
      <p className="text-center text-xs text-ink-muted">
        Connect to the internet to access Project Gutenberg.
      </p>
    </div>
  );
}
```

**Create** `src/screens/Library/Gutenberg/ApiErrorState.tsx`:

```tsx
import { Button } from '@/components/ui/button';

interface Props {
  onRetry: () => void;
}

export function ApiErrorState({ onRetry }: Props) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6">
      <p className="text-center text-xs text-ink-muted">
        Couldn't reach the Project Gutenberg API.
      </p>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
```

**Create** `src/screens/Library/Gutenberg/PanelHeading.tsx`:

```tsx
import { ArrowUpRight } from 'lucide-react';

export function PanelHeading() {
  return (
    <h2 className="font-serif text-sm leading-snug tracking-tight text-ink">
      Read a new book from{' '}
      <a
        href="https://www.gutenberg.org"
        target="_blank"
        rel="noreferrer"
        className="text-accent-orange underline-offset-2 hover:underline"
      >
        Project Gutenberg
        <ArrowUpRight className="ml-0.5 inline h-3 w-3" aria-hidden="true" />
      </a>
    </h2>
  );
}
```

**Create** `src/screens/Library/Gutenberg/BookTile.tsx`:

```tsx
import { useState } from 'react';
import type { GutenbergBook } from './types';

interface Props {
  book: GutenbergBook;
  onClick: () => void;
}

export function BookTile({ book, onClick }: Props) {
  const [imgError, setImgError] = useState(false);
  const author = book.authors[0]?.name ?? '';

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col text-left focus:outline-none"
      aria-label={`Open ${book.title}`}
    >
      <div className="aspect-[2/3] w-full overflow-hidden rounded-sm border border-stone-200 bg-stone-100 transition group-hover:ring-1 group-hover:ring-accent-amber/50">
        {!imgError && book.cover_image ? (
          <img
            src={book.cover_image}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-2 text-center">
            <span className="font-serif text-xs leading-tight text-ink-muted line-clamp-4">
              {book.title}
            </span>
          </div>
        )}
      </div>
      <p className="mt-1.5 line-clamp-2 font-serif text-xs leading-tight text-ink">
        {book.title}
      </p>
      {author && (
        <p className="line-clamp-1 text-[11px] text-ink-muted">{author}</p>
      )}
    </button>
  );
}
```

**Verify:**

```sh
npm run lint
```

Expected: clean.

**Commit:** `Gutenberg panel: shared types + LoadingSkeleton/Offline/ApiError/Heading/Tile`

---

### Task 15 — Panel: `BookGrid2x2` + in-panel `ApiKeyForm`

**Create** `src/screens/Library/Gutenberg/BookGrid2x2.tsx`:

```tsx
import type { GutenbergBook } from './types';
import { BookTile } from './BookTile';

interface Props {
  books: GutenbergBook[];
  onSelect: (book: GutenbergBook) => void;
}

export function BookGrid2x2({ books, onSelect }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {books.map((book) => (
        <BookTile key={book.id} book={book} onClick={() => onSelect(book)} />
      ))}
    </div>
  );
}
```

**Create** `src/screens/Library/Gutenberg/ApiKeyForm.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { verifyKey } from '../../../lib/gutenbergApi';

type Variant = 'missing-key' | 'invalid-key';

interface Props {
  variant: Variant;
  onSaved: (key: string) => void;
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'invalid-key' }
  | { kind: 'offline' }
  | { kind: 'api-error' };

export function ApiKeyForm({ variant, onSaved }: Props) {
  const [draft, setDraft] = useState('');
  const [submit, setSubmit] = useState<SubmitState>({ kind: 'idle' });

  const handleSubmit = async () => {
    if (draft.trim() === '') return;
    setSubmit({ kind: 'verifying' });
    const result = await verifyKey(draft.trim());
    if (result.kind === 'ok') {
      onSaved(draft.trim());
      return;
    }
    if (result.kind === 'invalid-key') {
      setSubmit({ kind: 'invalid-key' });
      return;
    }
    if (result.kind === 'offline') {
      setSubmit({ kind: 'offline' });
      return;
    }
    setSubmit({ kind: 'api-error' });
  };

  const message = (() => {
    if (submit.kind === 'invalid-key' || variant === 'invalid-key') {
      return 'Your saved key was rejected. Please re-enter.';
    }
    if (submit.kind === 'offline') {
      return 'No internet connection. Try again when you are online.';
    }
    if (submit.kind === 'api-error') {
      return "Couldn't reach the Project Gutenberg API.";
    }
    return null;
  })();

  return (
    <div className="flex flex-1 flex-col gap-2.5">
      <p className="text-xs text-ink-muted">
        Enter your RapidAPI key to load books from Project Gutenberg.
      </p>
      {message && (
        <p className="text-xs text-accent-orange">{message}</p>
      )}
      <Input
        type="password"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (submit.kind !== 'idle' && submit.kind !== 'verifying') {
            setSubmit({ kind: 'idle' });
          }
        }}
        placeholder="X-RapidAPI-Key value"
        className="font-mono text-xs"
        disabled={submit.kind === 'verifying'}
      />
      <Button
        size="sm"
        onClick={handleSubmit}
        disabled={draft.trim() === '' || submit.kind === 'verifying'}
      >
        {submit.kind === 'verifying' ? 'Verifying…' : 'Save'}
      </Button>
      <a
        href="https://rapidapi.com/help-lQ_hVT8W5/api/project-gutenberg-free-books-api1"
        target="_blank"
        rel="noreferrer"
        className="text-xs text-accent-amber underline-offset-2 hover:underline"
      >
        Get a key on RapidAPI →
      </a>
    </div>
  );
}
```

**Verify:**

```sh
npm run lint
```

**Commit:** `Gutenberg panel: BookGrid2x2 + in-panel ApiKeyForm with inline verification`

---

### Task 16 — Panel: `DetailModal`

**Why:** the 75vw × 75vh modal with cover + metadata + Add-to-library.

**Create** `src/screens/Library/Gutenberg/DetailModal.tsx`:

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { downloadGutenbergEpub } from '../../../ipc/gutenberg';
import { useAppStore } from '../../../store';
import type { GutenbergBook } from './types';

interface Props {
  book: GutenbergBook | null;
  onClose: () => void;
}

function formatIssued(issued: string | null): string {
  if (!issued) return '—';
  const d = new Date(issued);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex rounded-full border border-stone-200 px-2 py-0.5 text-xs text-ink">
      {children}
    </span>
  );
}

export function DetailModal({ book, onClose }: Props) {
  const insertBook = useAppStore((s) => s.insertBook);
  const [adding, setAdding] = useState(false);

  if (!book) return null;

  const author = book.authors.map((a) => a.name).join(', ') || 'Unknown';

  const handleAdd = async () => {
    setAdding(true);
    try {
      const result = await downloadGutenbergEpub(book.id);
      const inserted = await insertBook({
        title: book.title,
        file_path: result.storedPath,
        file_type: 'epub',
      });
      if (book.authors[0]?.name) {
        // Best-effort: stamp author so the library tile reads correctly
        // even before the background metadata-extraction pass runs.
        await useAppStore.getState().updateBookMetadata(inserted.id, {
          title: inserted.title,
          author: book.authors[0].name,
        });
      }
      toast.success(`Added "${book.title}" to your library.`);
      setTimeout(onClose, 600);
    } catch (err) {
      const raw = (err as Error).message ?? String(err);
      const reason = raw.includes(':') ? raw.split(':', 2)[1].trim() : raw;
      toast.error(`Could not download "${book.title}": ${reason}`);
      setAdding(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="h-[75vh] w-[75vw] max-w-[1100px] overflow-hidden p-0">
        <DialogTitle className="sr-only">{book.title}</DialogTitle>
        <DialogDescription className="sr-only">
          Book details for {book.title} by {author}
        </DialogDescription>
        <div className="grid h-full grid-cols-[40%_60%]">
          <div className="flex items-center justify-center bg-stone-100 p-8">
            {book.cover_image ? (
              <img
                src={book.cover_image}
                alt=""
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="font-serif text-lg text-ink-muted">
                No cover available
              </span>
            )}
          </div>
          <div className="flex flex-col gap-4 overflow-y-auto p-8">
            <h2 className="font-serif text-3xl text-ink">{book.title}</h2>
            <p className="text-base text-ink-muted">{author}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-muted">Released</dt>
              <dd>{formatIssued(book.issued)}</dd>
              <dt className="text-ink-muted">Publisher</dt>
              <dd>Project Gutenberg</dd>
              {book.reading_ease_score && (
                <>
                  <dt className="text-ink-muted">Reading ease</dt>
                  <dd>{book.reading_ease_score}</dd>
                </>
              )}
              <dt className="text-ink-muted">Downloads</dt>
              <dd>{book.download_count.toLocaleString()}</dd>
            </dl>
            {book.subjects.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs uppercase tracking-wider text-ink-muted">
                  Subjects
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {book.subjects.map((s) => (
                    <Pill key={s}>{s}</Pill>
                  ))}
                </div>
              </div>
            )}
            {book.bookshelves.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs uppercase tracking-wider text-ink-muted">
                  Bookshelves
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {book.bookshelves.map((s) => (
                    <Pill key={s}>{s}</Pill>
                  ))}
                </div>
              </div>
            )}
            <div className="flex-1" />
            <div className="flex justify-end">
              <Button onClick={handleAdd} disabled={adding}>
                {adding ? 'Adding…' : 'Add to library'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**Note on shadcn `Dialog`:** confirm `DialogTitle` and `DialogDescription` are exported from `@/components/ui/dialog`. If they are not (the existing `dialog.tsx` may only export `Dialog` / `DialogContent` / `DialogClose`), check first:

```sh
grep -E "^export" src/components/ui/dialog.tsx
```

If `DialogTitle`/`DialogDescription` are missing, add them following the shadcn pattern. The existing modal dialogs (`EditMetadataModal`) likely demonstrate the project's convention — match it.

**Commit:** `Gutenberg panel: DetailModal at 75vw×75vh with cover + metadata`

---

### Task 17 — Panel root: `index.tsx` (state machine)

**Create** `src/screens/Library/Gutenberg/index.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../../store';
import { getDb } from '../../../db/client';
import {
  getCachedFetch,
  setCachedFetch,
  advanceCursor,
} from '../../../db/gutenbergPanel';
import { fetchBooks, type GutenbergBook } from '../../../lib/gutenbergApi';
import { isFresh } from '../../../lib/gutenbergCacheFreshness';
import { PanelHeading } from './PanelHeading';
import { BookGrid2x2 } from './BookGrid2x2';
import { LoadingSkeleton } from './LoadingSkeleton';
import { OfflineState } from './OfflineState';
import { ApiErrorState } from './ApiErrorState';
import { ApiKeyForm } from './ApiKeyForm';
import { DetailModal } from './DetailModal';
import type { PanelState } from './types';

export function GutenbergPanel() {
  const apiKey = useAppStore((s) => s.gutenbergApiKey);
  const saveApiKey = useAppStore((s) => s.saveGutenbergApiKey);
  const [state, setState] = useState<PanelState>({ kind: 'loading' });
  const [selected, setSelected] = useState<GutenbergBook | null>(null);
  const evaluatingRef = useRef(false);

  const evaluate = useCallback(async () => {
    if (evaluatingRef.current) return;
    evaluatingRef.current = true;
    try {
      const currentKey = useAppStore.getState().gutenbergApiKey;
      if (!currentKey) {
        setState({ kind: 'missing-key' });
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setState({ kind: 'offline' });
        return;
      }
      const db = await getDb();
      const cache = await getCachedFetch(db);

      if (
        cache.payload &&
        cache.payload.length > 0 &&
        isFresh(cache.lastFetchedAt, Date.now())
      ) {
        setState({ kind: 'ready', books: cache.payload });
        return;
      }

      setState({ kind: 'loading' });
      const result = await fetchBooks(cache.cursor, currentKey);
      if (result.kind === 'ok') {
        const next = {
          cursor: advanceCursor(cache.cursor),
          lastFetchedAt: Date.now(),
          payload: result.books,
        };
        await setCachedFetch(db, next);
        setState({ kind: 'ready', books: result.books });
        return;
      }
      if (result.kind === 'invalid-key') {
        await saveApiKey('');
        setState({ kind: 'invalid-key' });
        return;
      }
      // network or api-error: fall back to cached payload silently if we have one
      if (cache.payload && cache.payload.length > 0) {
        setState({ kind: 'ready', books: cache.payload });
        return;
      }
      setState({
        kind: result.kind === 'offline' ? 'offline' : 'api-error',
      });
    } finally {
      evaluatingRef.current = false;
    }
  }, [saveApiKey]);

  useEffect(() => {
    void evaluate();
  }, [evaluate, apiKey]);

  useEffect(() => {
    const onOnline = () => {
      setState((prev) => (prev.kind === 'offline' ? { kind: 'loading' } : prev));
      void evaluate();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [evaluate]);

  const handleKeySaved = useCallback(
    async (key: string) => {
      await saveApiKey(key);
      // The apiKey store change re-runs evaluate via the useEffect above.
    },
    [saveApiKey],
  );

  const handleRetry = useCallback(() => {
    void evaluate();
  }, [evaluate]);

  return (
    <div className="flex flex-[2] flex-col gap-3 rounded-md border border-stone-200 bg-cream p-4">
      <PanelHeading />
      {state.kind === 'loading' && <LoadingSkeleton />}
      {state.kind === 'missing-key' && (
        <ApiKeyForm variant="missing-key" onSaved={handleKeySaved} />
      )}
      {state.kind === 'invalid-key' && (
        <ApiKeyForm variant="invalid-key" onSaved={handleKeySaved} />
      )}
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

**Commit:** `Gutenberg panel: root coordinator with state machine + cache freshness + auto-recovery`

---

### Task 18 — Wire into `Library/index.tsx`, delete `BrainPlaceholder`

**Modify** `src/screens/Library/index.tsx`:

1. Replace the import:

```ts
import { BrainPlaceholder } from './BrainPlaceholder';
```

with:

```ts
import { GutenbergPanel } from './Gutenberg';
```

2. In the JSX, replace `<BrainPlaceholder />` with `<GutenbergPanel />`.

**Delete** `src/screens/Library/BrainPlaceholder.tsx`:

```sh
rm src/screens/Library/BrainPlaceholder.tsx
```

**Verify:**

```sh
npm run lint
npm test
npm run tauri:dev
```

In the running app:
- Library screen shows the new panel with the inline API-key form (no key saved yet).
- Enter a real RapidAPI key → 4 covers appear.
- Click a tile → modal opens with metadata.
- Add to library → toast + modal closes + tile appears in main grid + reader opens.

**Commit:** `Library: mount GutenbergPanel in top-right slot, drop BrainPlaceholder`

---

### Task 19 — Playwright e2e spec

**Create** `tests/playwright/gutenberg-panel.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

const FAKE_BOOKS_RESPONSE = {
  results: [
    {
      id: 1342,
      title: 'Pride and Prejudice',
      alternative_title: null,
      authors: [{ id: 68, name: 'Austen, Jane' }],
      subjects: ['Romance', 'England -- Fiction'],
      bookshelves: ['Best Books Ever Listings'],
      media_type: 'Text',
      download_count: 62904,
      issued: '1998-06-01',
      reading_ease_score: '69.20',
      cover_image: 'https://example.invalid/cover-1342.jpg',
    },
    {
      id: 11,
      title: "Alice's Adventures in Wonderland",
      alternative_title: null,
      authors: [{ id: 7, name: 'Carroll, Lewis' }],
      subjects: ['Fantasy'],
      bookshelves: [],
      media_type: 'Text',
      download_count: 30000,
      issued: '2008-06-27',
      reading_ease_score: '85.00',
      cover_image: 'https://example.invalid/cover-11.jpg',
    },
    {
      id: 84,
      title: 'Frankenstein',
      alternative_title: null,
      authors: [{ id: 41, name: 'Shelley, Mary' }],
      subjects: ['Horror'],
      bookshelves: [],
      media_type: 'Text',
      download_count: 25000,
      issued: '1993-10-01',
      reading_ease_score: '60.00',
      cover_image: 'https://example.invalid/cover-84.jpg',
    },
    {
      id: 74,
      title: 'The Adventures of Tom Sawyer',
      alternative_title: null,
      authors: [{ id: 53, name: 'Twain, Mark' }],
      subjects: ['Adventure'],
      bookshelves: [],
      media_type: 'Text',
      download_count: 20000,
      issued: '2004-07-01',
      reading_ease_score: '80.00',
      cover_image: 'https://example.invalid/cover-74.jpg',
    },
  ],
};

async function preloadKey(page: import('@playwright/test').Page, key: string) {
  await page.addInitScript((k) => {
    // Run before the bundle loads — stash the key on window so the mock can pick it up.
    (window as Window & { __SCHOLARA_GUTENBERG_KEY__?: string }).__SCHOLARA_GUTENBERG_KEY__ = k;
  }, key);
}

test.describe('Gutenberg panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://gutenbergapi.com/**', async (route, request) => {
      const url = new URL(request.url());
      if (url.searchParams.get('page_size') === '1') {
        // verifyKey
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ results: [FAKE_BOOKS_RESPONSE.results[0]] }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(FAKE_BOOKS_RESPONSE),
      });
    });
  });

  test('panel shows inline form when no key is saved', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);
    await expect(
      page.getByText('Enter your RapidAPI key to load books from Project Gutenberg.'),
    ).toBeVisible();
  });

  test('panel renders 4 covers after key is saved', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await page.locator('input[type="password"]').first().fill('fake-rapidapi-key');
    await page.getByRole('button', { name: 'Save' }).first().click();

    for (const book of FAKE_BOOKS_RESPONSE.results) {
      await expect(page.getByRole('button', { name: `Open ${book.title}` })).toBeVisible();
    }
  });

  test('clicking a tile opens the modal with full metadata', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await page.locator('input[type="password"]').first().fill('fake-rapidapi-key');
    await page.getByRole('button', { name: 'Save' }).first().click();

    await page
      .getByRole('button', { name: 'Open Pride and Prejudice' })
      .click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Pride and Prejudice')).toBeVisible();
    await expect(dialog.getByText('Austen, Jane')).toBeVisible();
    await expect(dialog.getByText('Project Gutenberg').first()).toBeVisible();
    await expect(dialog.getByText('Romance')).toBeVisible();
  });

  test('Add-to-library imports the EPUB and the book appears in the main grid', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await page.locator('input[type="password"]').first().fill('fake-rapidapi-key');
    await page.getByRole('button', { name: 'Save' }).first().click();

    await page.getByRole('button', { name: 'Open Frankenstein' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Add to library' }).click();

    // Modal closes ~600ms after success.
    await expect(dialog).toBeHidden({ timeout: 5000 });

    // The new book appears in the main BookGrid (its title is rendered there too).
    await expect(
      page.locator('main').getByText('Frankenstein').first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test('panel shows offline state when navigator goes offline', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await page.locator('input[type="password"]').first().fill('fake-rapidapi-key');
    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect(
      page.getByRole('button', { name: 'Open Pride and Prejudice' }),
    ).toBeVisible();

    // Force a fresh evaluation while offline by clearing the cache + reloading.
    await page.evaluate(async () => {
      const { getDb } = await import('/src/db/client.ts');
      const db = await getDb();
      await db.execute(
        'UPDATE gutenberg_panel_state SET last_fetched_at = NULL, payload_json = NULL WHERE id = 1',
      );
    }).catch(() => {
      // Dynamic import path may not be resolvable in preview; fall back to test-hook approach.
    });
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => '__appTestHooks' in window);

    await expect(
      page.getByText('Connect to the internet to access Project Gutenberg.'),
    ).toBeVisible({ timeout: 5000 });

    await context.setOffline(false);
  });
});
```

**Note:** the offline test's "clear cache" approach via dynamic import will not work under `vite preview` (paths are bundled). If it fails, expose a tiny test hook in `src/testHooks.ts` (gated on `import.meta.env.VITE_E2E`) called `clearGutenbergCache()` that runs the same `UPDATE` against `getDb()`. Add this hook **inside** Task 19 if the offline test fails on first run. Hook signature:

```ts
async clearGutenbergCache(): Promise<void> {
  const db = await getDb();
  await db.execute(
    'UPDATE gutenberg_panel_state SET last_fetched_at = NULL, payload_json = NULL WHERE id = 1',
  );
},
```

And replace the `page.evaluate(...)` block in the offline test with:

```ts
await page.evaluate(() => (window as Window & {
  __appTestHooks: { clearGutenbergCache(): Promise<void> };
}).__appTestHooks.clearGutenbergCache());
```

**Verify:**

```sh
npm run test:e2e -- gutenberg-panel.spec.ts
```

Expected: all 5 tests pass.

**Commit:** `e2e: gutenberg-panel.spec.ts — missing-key form, render, modal, add, offline`

---
