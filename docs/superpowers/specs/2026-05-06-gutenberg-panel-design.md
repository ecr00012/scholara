# Scholara — Project Gutenberg Panel Design (Phase 4a)

**Date:** 2026-05-06
**Phase:** 4a (Library right-sidebar evolution; brain animation deferred replaced by PG panel)
**Status:** Approved for implementation planning

---

## 1. Goal & Scope

### 1.1 Goal

Replace the top-right Library placeholder with a "Read a new book from Project Gutenberg" panel that surfaces 4 of PG's most-downloaded books each day, lets the user open a detail modal, and one-click imports the EPUB into the local library. Drives discovery without leaving the app.

### 1.2 Scope

**In scope:**
- New panel mounted in the Library top-right slot (replacing `BrainPlaceholder`), 2×2 grid of 4 books, heading "Read a new book from Project Gutenberg" with the words "Project Gutenberg" rendered as an orange external link to `https://www.gutenberg.org`.
- Daily rotation through PG most-downloaded ranks #1–400, advancing the cursor by 4 every 24h, wrapping `(cursor + 4) % 400`. Cursor + last-fetched-at + 4-book payload cached in a single-row SQLite table.
- Detail modal at 75vw × 75vh: cover left, metadata right (title, authors, "Released: {issued}", "Publisher: Project Gutenberg", reading-ease score, download count, subjects + bookshelves as pills), bottom-right Add-to-library, top-right close.
- "Add to library": Tauri IPC downloads `https://www.gutenberg.org/ebooks/{id}.epub.images` (fallback `.epub.noimages`), writes to the app books dir, inserts via existing `insertBook`. Toast on success, modal auto-closes.
- Generalize secrets IPC from `get_api_key`/`set_api_key` → `get_secret(name)`/`set_secret(name)`. Anthropic flow refactored to call with name `"anthropic"`. Project Gutenberg key stored under name `"gutenberg"`.
- Inline API-key form inside the panel when no key is saved or saved key is rejected (HTTP 401). Verification call on submit: `GET /books?page_size=1`.
- Settings screen gains a second "Project Gutenberg API Key (RapidAPI)" form below the Anthropic one, sharing a refactored `ApiKeyForm` component.
- State machine for the panel: `missing-key → invalid-key → offline → api-error → cache-fresh → fetch-and-render`. Cached payload acts as silent fallback when a *refresh* (not first load) fails.
- Auto-recovery from offline state on the `window.online` event.
- New SQLite migration `0003_gutenberg.sql` adding the `gutenberg_panel_state` table.
- New Rust IPC: `get_secret`, `set_secret`, `download_gutenberg_epub`. Old commands `get_api_key` / `set_api_key` removed (keychain entries themselves remain compatible — same service `"scholara"`, same account name `"anthropic"`).
- Vitest coverage for pure HTTP wrapper, DB single-row helpers, and cache freshness. Playwright coverage for panel render, offline state, missing-key form, modal open, and add-to-library flow.
- CLAUDE.md and AGENT.md gain one new constraint line: "All keychain-backed secrets go through `getSecret(name)` / `setSecret(name)`."

**Out of scope (deferred):**
- App-wide duplicate-book detection across all import paths (drag-drop, file picker, PG panel). For this phase, every Add-to-library inserts a fresh row, even for a book already present. Tracked in this doc as future work, not in CLAUDE.md/AGENT.md.
- Manual refresh button on the panel — daily auto-refresh is the contract.
- Per-tile "See on Project Gutenberg" deep links (the heading link is sufficient).
- Browse / search the wider PG catalog beyond the rotating 4.
- Generalized fetched-books cache. We cache only the current 4-book payload.
- Vocab/notes scrolling strip implementation (separate future feature; bottom placeholder is unchanged).
- WebGL brain animation — replaced by this panel, no longer planned.
- Per-book "noimages" toggle (we always default to `.epub.images` and only fall back on 404).

### 1.3 Inherited contracts (unchanged)

- All FS through Rust IPC; no `@tauri-apps/api/fs` from components.
- Module boundaries: components → store → db/ + ipc/ → Tauri.
- Light mode only. shadcn/ui + Tailwind. SQLite via `tauri-plugin-sql`. Cross-platform.
- Auth: none. API keys in OS keychain. No SSR.
- Two test runners: Vitest (helpers + DB) and Playwright (library-correctness e2e against `vite preview`).

---

## 2. Locked decisions (from brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Which placeholder is replaced | **Top-right** (`BrainPlaceholder`). Brain animation feature is dropped. Bottom placeholder (vocab/notes scroll strip) is unchanged. |
| 2 | Panel layout | **2×2 grid** of larger covers — readable in the 320px-wide sidebar. |
| 3 | "Daily" semantics | **24h since last successful fetch**, evaluated on Library mount. |
| 4 | Cache scope | **Just the current 4 books**, single-row table with `cursor_offset`, `last_fetched_at`, `payload_json`. |
| 5 | Cursor advancement | **Advance by 4 per day**, wrap `(cursor + 4) % 400`. ~100-day cycle through PG's top 400. |
| 6 | API key plumbing | **Generalize secrets IPC** to `get_secret(name)`/`set_secret(name)`. Anthropic and Gutenberg both go through it. |
| 7 | EPUB download mechanism | **Tauri Rust IPC** (`download_gutenberg_epub`) using Rust HTTP client. Tries `.epub.images` first, falls back to `.epub.noimages` on 404. |
| 8 | Modal right-panel content | Title, authors, "Released: {issued}", static "Publisher: Project Gutenberg", reading-ease score, download count, subjects pills, bookshelves pills. **No summary section** — API does not provide one. |
| 9 | Missing-key UX | **Inline form inside the panel.** Verification on submit via `GET /books?page_size=1`. Settings still has the editable form for later changes. |
| 10 | Error precedence | (1) `navigator.onLine === false` or `fetch` `TypeError` → offline; (2) HTTP 401/403 → invalid-key form; (3) other non-2xx → api-error with retry. Cached payload silently shown if a *refresh* fails. `window.online` triggers auto-retry. |
| 11 | Duplicate detection | **Allowed for now** — Add-to-library always inserts a fresh row. Future work for app-wide duplicate handling tracked in this spec only (not yet in CLAUDE.md/AGENT.md). |
| 12 | Sort parameter | Try `?ordering=-download_count` (Django REST Framework convention). The API documentation visible to us doesn't enumerate sort params; if `ordering` is unsupported, the implementation plan must record the actual parameter (or fall back to the default order if it is already popularity-ranked). |
| 13 | EPUB filename on disk | `gutenberg-{id}-{nonce}.epub` where `nonce` is a short random suffix, to avoid filesystem collisions when duplicates are added (see #11). |

---

## 3. Architecture

### 3.1 File layout

```
src/
  screens/Library/
    Gutenberg/
      index.tsx              # GutenbergPanel — root, state-machine coordinator
      PanelHeading.tsx       # heading + orange external link
      BookGrid2x2.tsx        # 2×2 grid of BookTiles
      BookTile.tsx           # cover + title + author label
      DetailModal.tsx        # 75vw×75vh modal
      ApiKeyForm.tsx         # in-panel inline key form
      OfflineState.tsx       # BookOpen icon + offline copy
      ApiErrorState.tsx      # AlertCircle (or no icon) + retry
      LoadingSkeleton.tsx    # 4 shimmering aspect-[2/3] blocks
    BrainPlaceholder.tsx     # DELETED
    index.tsx                # mounts <GutenbergPanel/> in flex-[2] slot

  ipc/
    secrets.ts               # getSecret(name) / setSecret(name)
    gutenberg.ts             # downloadGutenbergEpub(bookId)

  lib/
    gutenbergApi.ts          # pure: verifyKey, fetchBooks; classifies errors

  db/
    gutenbergPanel.ts        # getCachedFetch, setCachedFetch (single-row CRUD)
    migrations/0003_gutenberg.sql

  screens/Settings/
    ApiKeyForm.tsx           # refactored to take secretName / heading / etc props
    index.tsx                # renders Anthropic + Gutenberg forms

src-tauri/src/
  secrets.rs                 # get_secret / set_secret commands
  gutenberg.rs               # download_gutenberg_epub command (new file)
  lib.rs                     # register new commands; remove get_api_key/set_api_key
```

### 3.2 Module boundaries

- **`lib/gutenbergApi.ts`** — pure HTTP + classification. No React, no Tauri, no store. Easy to unit-test with mocked `fetch`.
- **`db/gutenbergPanel.ts`** — thin SQL wrapper, single-row table.
- **`screens/Library/Gutenberg/index.tsx`** — the only stateful coordinator. Reads cache + key on mount; runs the state machine; renders one of {LoadingSkeleton, ApiKeyForm, OfflineState, ApiErrorState, BookGrid2x2}; owns the modal-open state.
- **Children of `Gutenberg/`** — presentational; receive props, emit events.
- **Store (`store.ts`)** — only adds `gutenbergApiKey: string | null` + `loadGutenbergApiKey` + `saveGutenbergApiKey`. The 4-book payload + cursor + last-fetched-at live in SQLite, not the store; the panel reads them once on mount.

### 3.3 State machine (panel root)

```
                  mount
                    │
                    ▼
            ┌─────────────────┐
            │  has gutenberg  │
            │   key saved?    │
            └────────┬────────┘
              no     │     yes
        ┌──────────┘ └──────────┐
        ▼                       ▼
  [missing-key]          ┌──────────────┐
  ApiKeyForm             │ navigator    │
  intro + Save           │ .onLine?     │
        │                └──────┬───────┘
   submit│                no    │   yes
        ▼                ┌─────┘└─────┐
   verifyKey()           ▼            ▼
   GET /books?           [offline]   ┌──────────────┐
   page_size=1           OfflineState│ cache fresh? │
        │                            │ (<24h old)   │
   ┌────┴────┐                       └──────┬───────┘
   │ 200 ok  │                          no  │  yes
   │  401    │                              │   │
   │  other  │                              ▼   ▼
   └─┬──┬──┬─┘                       fetchBooks() [grid]
     │  │  └──→ [api-error]                        ─┘
     │  └──→ "Invalid API key" message in form
     ▼ save key
   set cursor=0; fetch immediately
                                     ┌──────────────────────────────────────┐
                                     │ fetchBooks(offset, key) result:      │
                                     │   ok    → write cache row, render    │
                                     │   401   → drop key, → invalid-key    │
                                     │   net   → cache exists? render it    │
                                     │            silently; else → offline  │
                                     │   other → cache exists? render it    │
                                     │            silently; else → api-err  │
                                     └──────────────────────────────────────┘

window.online listener: if currently in [offline], re-evaluate from top.
On every successful fetch: cursor = (cursor + 4) % 400; persist row.
Modal Add-to-library does NOT mutate panel state.
```

### 3.4 First-ever load

The cache row is created with `cursor_offset = 0, last_fetched_at = NULL, payload_json = NULL` by the migration. First successful fetch persists `cursor_offset` *after* the fetch (so the *next* day rolls to #5–8). First 4 books shown are PG ranks #1–4.

### 3.5 Data flow on Add-to-library

1. User clicks the button in `DetailModal`.
2. Button enters "Adding…" disabled state.
3. `downloadGutenbergEpub(book.id)` IPC call → Rust downloads the EPUB to `<app_data_dir>/books/gutenberg-{id}-{nonce}.epub`, returns `{ storedPath, fileType: 'epub' }`.
4. TS calls existing `useAppStore.insertBook({ title: book.title, file_path: storedPath, file_type: 'epub' })`. Author from `book.authors[0]?.name` is set via the existing post-insert metadata pass — *or* directly here if cheap. (Decision deferred to implementation: simplest is to insert with the title we know, then let the existing background extraction pass overwrite author from the EPUB itself.)
5. Toast "Added '{title}' to your library."
6. Modal auto-closes after ~600ms.

### 3.6 Data flow on daily refresh

1. Library screen mounts → `<GutenbergPanel/>` mounts.
2. Panel reads cache row + key from SQLite/keychain.
3. If cache is fresh (`now - last_fetched_at < 24h`) and `payload_json` is non-null → render directly, no network call.
4. Otherwise → call `fetchBooks(cursor_offset, key)`.
5. On success → write `payload_json`, advance `cursor_offset = (cursor_offset + 4) % 400`, set `last_fetched_at = now`. Render.
6. On failure → see error precedence (§3.3). If we have a stale cached payload, render it silently (no error UI).

---

## 4. Schema, IPC, store

### 4.1 SQLite migration `0003_gutenberg.sql`

```sql
CREATE TABLE gutenberg_panel_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  cursor_offset   INTEGER NOT NULL DEFAULT 0,
  last_fetched_at INTEGER,
  payload_json    TEXT
);

INSERT OR IGNORE INTO gutenberg_panel_state (id, cursor_offset) VALUES (1, 0);
```

Single-row pattern (`id = 1` constraint). `last_fetched_at` is unix milliseconds; `payload_json` is the raw JSON array of 4 book objects from the `/books` endpoint.

### 4.2 Rust IPC — `secrets.rs` (refactor)

```rust
#[tauri::command]
async fn get_secret(name: String) -> Result<Option<String>, String>;

#[tauri::command]
async fn set_secret(name: String, value: String) -> Result<(), String>;
```

Both wrap the existing keyring crate. Service stays `"scholara"`; `account` becomes the `name` argument. Old commands `get_api_key` / `set_api_key` are removed. Existing keychain entries written under account `"anthropic"` (from the Foundation phase) keep working.

### 4.3 Rust IPC — `gutenberg.rs` (new)

```rust
#[tauri::command]
async fn download_gutenberg_epub(book_id: i64) -> Result<DownloadResult, String>;

struct DownloadResult { stored_path: String, file_type: String /* "epub" */ }
```

- Tries `https://www.gutenberg.org/ebooks/{book_id}.epub.images` first.
- On HTTP 404, retries with `.epub.noimages`.
- Streams response bytes to `<app_data_dir>/books/gutenberg-{book_id}-{nonce}.epub` (nonce is a short random suffix, e.g. 6 hex chars).
- Returns the absolute stored path.
- Errors classified via the returned `String` payload: `"network"`, `"not_found"`, `"server"`, `"io"`. UI maps these into toast messages.

### 4.4 TS IPC wrappers

`src/ipc/secrets.ts`:
```ts
export async function getSecret(name: string): Promise<string | null>;
export async function setSecret(name: string, value: string): Promise<void>;
```

`src/ipc/gutenberg.ts`:
```ts
export async function downloadGutenbergEpub(
  bookId: number,
): Promise<{ storedPath: string; fileType: 'epub' }>;
```

### 4.5 Store additions

```ts
// existing apiKey is preserved as the Anthropic field; bodies switch to:
loadApiKey():    apiKey   = await getSecret('anthropic');
saveApiKey(k):   await setSecret('anthropic', k); apiKey = k === '' ? null : k;

// new fields:
gutenbergApiKey: string | null;
loadGutenbergApiKey():  gutenbergApiKey = await getSecret('gutenberg');
saveGutenbergApiKey(k): await setSecret('gutenberg', k);
                        gutenbergApiKey = k === '' ? null : k;
```

The 4-book payload, cursor, and last-fetched-at do **not** live in the store — the panel reads them from SQLite once on mount and updates the row directly.

### 4.6 `lib/gutenbergApi.ts`

Pure HTTP module:

```ts
type FetchResult =
  | { kind: 'ok'; books: GutenbergBook[] }
  | { kind: 'invalid-key' }
  | { kind: 'api-error'; status: number }
  | { kind: 'offline' };  // network error or navigator.onLine === false

export async function verifyKey(key: string): Promise<FetchResult>;
export async function fetchBooks(offset: number, key: string): Promise<FetchResult>;
```

URL: `https://gutenbergapi.com/books?ordering=-download_count&page_size=4&offset={offset}`
Header: `X-RapidAPI-Key: {key}`

Implementation must check `navigator.onLine` before issuing fetch, and treat any thrown `TypeError` as `kind: 'offline'`.

---

## 5. Visual treatment

All shadcn/ui + Tailwind, light mode only. Theme tokens already in `tailwind.config.ts`: `cream`, `ink`, `ink-muted`, `accent.amber`, `accent.gold`, `accent.orange`.

### 5.1 Panel container

```
rounded-md border border-stone-200 bg-cream p-4 flex flex-col gap-3
```

Sits in the existing `flex-[2]` slot in `src/screens/Library/index.tsx`'s right `<aside>`.

### 5.2 Heading

- Two-line allowed: `font-serif text-sm tracking-tight text-ink leading-snug`.
- "Project Gutenberg" wrapped in:
  ```
  <a href="https://www.gutenberg.org" target="_blank" rel="noreferrer"
     className="text-accent-orange underline-offset-2 hover:underline">
    Project Gutenberg
  </a>
  ```
- `lucide-react` `ArrowUpRight` 12px immediately after the link, same color.

### 5.3 2×2 grid

```
grid grid-cols-2 gap-3
```

Each `BookTile`:
- `<img src={book.cover_image} loading="lazy" alt="">` in `aspect-[2/3] w-full rounded-sm border border-stone-200 bg-stone-100 overflow-hidden`.
- On image error → `<GeneratedCover title={...} author={...} />` at the same aspect ratio.
- Title beneath: `mt-1.5 text-xs leading-tight text-ink line-clamp-2 font-serif`.
- Author: `text-[11px] text-ink-muted line-clamp-1`.
- Hover: `hover:ring-1 hover:ring-accent-amber/50 transition` on the cover frame.
- Click anywhere on tile → opens `DetailModal` with that book.

### 5.4 LoadingSkeleton

Four `aspect-[2/3]` blocks with `bg-stone-100 animate-pulse rounded-sm`. No title/author lines.

### 5.5 In-panel ApiKeyForm

- `text-xs text-ink-muted` line: "Enter your RapidAPI key to load books from Project Gutenberg."
- `<Input type="password" />` + `<Button>Save</Button>` stacked vertically (panel is narrow, no horizontal room).
- Help link below: `<a className="text-xs text-accent-amber hover:underline">Get a key on RapidAPI →</a>` to the RapidAPI listing URL.
- Invalid-key state: same form, with `text-xs text-accent-orange` message above: "Your saved key was rejected. Please re-enter."
- On submit: spinner inside the button, button disabled, `verifyKey` runs. On `kind: 'ok'`, save the key and immediately fetch the panel content. On `kind: 'invalid-key'`, render the "Your saved key was rejected." message above the input and do not save. On `kind: 'offline'`, do not save the key; show the offline state. On `kind: 'api-error'`, do not save the key; show "Couldn't reach the Project Gutenberg API." inline above the input with a retry of the verify call (not the panel-level retry button).

### 5.6 OfflineState

Vertically centered:
- `lucide-react` `BookOpen` icon, 32px, `text-ink-muted`.
- `text-xs text-ink-muted text-center` below: "Connect to the internet to access Project Gutenberg."

### 5.7 ApiErrorState

Same vertical-center layout:
- (Optional `AlertCircle` 32px icon — implementation may omit if visually noisy.)
- "Couldn't reach the Project Gutenberg API."
- `<Button variant="ghost" size="sm">Try again</Button>` re-runs `fetchBooks(cursor)`.

### 5.8 DetailModal

Uses shadcn `Dialog`. Override `DialogContent`:

```
w-[75vw] max-w-[1100px] h-[75vh] p-0 overflow-hidden
```

Inside:

```
<div className="grid grid-cols-[40%_60%] h-full">
  <div className="bg-stone-100 p-8 flex items-center justify-center">
    <img src={book.cover_image} className="max-h-full max-w-full object-contain" />
  </div>
  <div className="flex flex-col p-8 gap-4 overflow-y-auto">
    <h2 className="font-serif text-3xl text-ink">{book.title}</h2>
    <p className="text-base text-ink-muted">{authorsJoined}</p>
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt>Released</dt><dd>{formattedIssued}</dd>
      <dt>Publisher</dt><dd>Project Gutenberg</dd>
      <dt>Reading ease</dt><dd>{book.reading_ease_score}</dd>
      <dt>Downloads</dt><dd>{book.download_count.toLocaleString()}</dd>
    </dl>
    {/* Subjects */}
    <div>
      <h3 className="text-xs uppercase tracking-wider text-ink-muted mb-2">
        Subjects
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {book.subjects.map(s => <Pill>{s}</Pill>)}
      </div>
    </div>
    {/* Bookshelves — same treatment */}
    <div className="flex-1" />
    <div className="flex justify-end">
      <Button onClick={handleAdd}>{addButtonLabel}</Button>
    </div>
  </div>
</div>
```

Top-right close: shadcn `DialogClose` default, absolute `top-4 right-4`.

`Pill`:
```
inline-flex rounded-full border border-stone-200 px-2 py-0.5 text-xs text-ink
```

Add-to-library button states:
1. Idle → "Add to library"
2. Pending → spinner + "Adding…", disabled
3. Success → toast + modal closes after 600ms
4. Failure → toast error, button re-enables

Date formatting: `formattedIssued = format(new Date(book.issued), 'MMM d, yyyy')`. The `issued` field comes as ISO date string from the API (verified during impl). If `issued` is null, missing, or unparseable, render `—` in the `<dd>` instead.

### 5.9 Settings — refactored ApiKeyForm

`src/screens/Settings/ApiKeyForm.tsx` accepts:

```ts
interface Props {
  secretName: 'anthropic' | 'gutenberg';
  heading: string;
  description: string;
  placeholder: string;
  helpHref: string;
  helpLabel: string;
  storeKey: 'apiKey' | 'gutenbergApiKey';
}
```

`storeKey` is a typed union over the actual zustand fields, so the form reaches into the right slice without becoming generic-over-everything. The body is otherwise unchanged from the existing form.

Settings index renders both:

```tsx
<ApiKeyForm secretName="anthropic" storeKey="apiKey" heading="Anthropic API Key" ... />
<hr className="border-stone-200" />
<ApiKeyForm secretName="gutenberg" storeKey="gutenbergApiKey"
            heading="Project Gutenberg API Key (RapidAPI)" ... />
```

---

## 6. Error copy table

| State | Heading / message | Affordance |
|---|---|---|
| missing-key (panel) | "Enter your RapidAPI key to load books from Project Gutenberg." | Input + Save + "Get a key on RapidAPI →" link |
| invalid-key (panel) | "Your saved key was rejected. Please re-enter." | Same form, message above input |
| offline (panel) | "Connect to the internet to access Project Gutenberg." | `BookOpen` icon |
| api-error (panel) | "Couldn't reach the Project Gutenberg API." | "Try again" button |
| download-failed (modal toast) | "Could not download '{title}': {reason}" | Button stays enabled |
| download-success (modal toast) | "Added '{title}' to your library." | Modal auto-closes after 600ms |

---

## 7. CLAUDE.md / AGENT.md updates

Append one constraint to the "Hard Constraints — Never Violate" section in **both** CLAUDE.md and AGENT.md:

> - **Secrets:** All keychain-backed secrets go through `getSecret(name)` / `setSecret(name)`. Service is `"scholara"`; account is the `name` argument.

No deferred-features note about duplicate detection in CLAUDE.md/AGENT.md (per user direction); that future work lives only in this spec (§9).

---

## 8. Testing strategy

### 8.1 Vitest (node env)

- **`lib/gutenbergApi.test.ts`** — pure HTTP wrapper:
  - `verifyKey` returns `kind: 'ok'` on 200, `kind: 'invalid-key'` on 401, `kind: 'api-error'` on 500, `kind: 'offline'` on `fetch` rejection. Mocks `fetch` via `vi.fn()`.
  - `fetchBooks(offset, key)` builds URL `/books?ordering=-download_count&page_size=4&offset={offset}` and forwards `X-RapidAPI-Key` header.
  - Error classification matches §3.3 precedence.
- **`db/gutenbergPanel.test.ts`** — single-row CRUD against in-memory SQLite:
  - Initial read after migration returns `{ cursor: 0, lastFetchedAt: null, payload: null }`.
  - `setCachedFetch(...)` writes; `getCachedFetch()` reads.
  - Cursor wrap: `(396 + 4) % 400 === 0`.
- **`lib/gutenbergCacheFreshness.test.ts`** — `isFresh(lastFetchedAt, now, ttlMs = 24h)`:
  - `isFresh(null, ...)` → `false`.
  - Within TTL → `true`. Past TTL → `false`.

All DB tests use the project's existing `// @vitest-environment node` annotation (per memory entry [feedback_vitest_env.md]).

### 8.2 Playwright (e2e against `vite preview`)

Single spec `tests/e2e/gutenberg-panel.spec.ts`, with `page.route()` mocks against the GutenbergAPI host:

- Panel renders 4 covers from a mocked top-4 fetch.
- Panel shows offline state when `context.setOffline(true)` is set before mount.
- Panel shows inline form when no `gutenberg` secret is saved.
- Clicking a tile opens the modal; assert title, author, "Released", "Publisher: Project Gutenberg", subjects, bookshelves all render.
- Add-to-library: button → toast → modal closes → tile appears in main `BookGrid`. The `download_gutenberg_epub` IPC is mocked at the test-hook layer.

Real `gutenberg.org` is **not** hit in CI.

### 8.3 Manual verification (for the implementation PR)

- Real RapidAPI key in dev → panel renders 4 real covers.
- Click a tile → real metadata, cover loads from `gutenberg.org`.
- Add-to-library a real book → file written, library tile appears, opens in reader.
- Toggle airplane mode while panel is mounted → panel shows offline state; coming back online auto-recovers.
- Mutate the saved key (set to `bad`) → next refresh shows invalid-key form.
- Manually advance `cursor_offset` to 396 in DB → next fetch wraps to 0 cleanly.

---

## 9. Deferred / future work (this feature only)

- **App-wide duplicate detection across all import paths.** Drag-drop, file picker, and the new PG panel can all create duplicate library rows. Future work: design a single duplicate-detection layer (likely keyed by content hash or a `provenance` table) shared across all import paths, so the same book cannot be added twice regardless of source. Until then, every Add-to-library inserts a fresh row, and PG-sourced files use a `gutenberg-{id}-{nonce}.epub` filename to avoid disk collisions.
- **Per-tile "See on Project Gutenberg" link.** Heading link is sufficient now.
- **Manual refresh button.**
- **Browse / search the wider PG catalog.**
- **Larger fetched-books cache** for repeat visits beyond the rotating 4.

---

## 10. Known unknowns to resolve at implementation time

- **Sort parameter name.** The visible API docs do not enumerate sort parameters. We try `?ordering=-download_count` first; if the API does not honor it, the implementation plan must record the actual parameter (or accept the default order if that is already popularity-ranked). The error precedence and cursor logic are unaffected.
- **`issued` field format.** Assumed ISO date string; confirm at impl by inspecting a real response.
- **Author plumbing on Add-to-library.** Two viable paths: (a) pass `book.authors[0]?.name` into the existing `insertBook` call directly, or (b) let the existing background metadata-extraction pass populate it from the EPUB. Decision deferred to the implementation plan; both result in the same end state.
