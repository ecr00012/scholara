# Scholara — Foundation Design

**Date:** 2026-05-04
**Phase:** 1 of 4 (Foundation → Reader → AI → WebGL & Scrolling Strip)
**Status:** Approved for implementation planning

---

## 1. Goal

Land a production-ready Tauri + React + TypeScript shell that:

- Boots into a polished Apple-Libraries-style Library screen.
- Lets the user upload a PDF or EPUB, persists it to the app data directory, and renders it as a tile with a stylized generated cover.
- Lets the user edit a book's title and author after upload.
- Provides a Settings screen for the Anthropic API key (stored in the OS keychain) and a view of the local data directory.
- Reserves visual space for features built in later phases (book reader, WebGL brain animation, scrolling vocabulary/notes/quotes strip) using clearly-labeled placeholders.

Foundation does **not** include reading, AI, animations, or the scrolling strip — only the shell that the next three phases build into.

---

## 2. Scope

### In scope
- Tauri 2.x + React 18 + TypeScript scaffold (Vite-based, from `npm create tauri-app@latest`).
- Tailwind CSS + shadcn/ui (light mode only, hard-locked).
- SQLite via `tauri-plugin-sql`, with a single migration creating all four tables specified in `CLAUDE.md`.
- Tauri IPC commands for file copy, app data dir lookup, OS keychain get/set, and OS file-manager reveal.
- Library screen: header, API-key banner (conditional), book grid, generated covers, quill-and-inkwell Add Book affordance, edit-metadata modal, deferred-feature placeholders for the WebGL animation and scrolling strip.
- Settings screen: API key form + data location panel.
- Zustand store for app-wide state (`view`, `books`, `apiKey`).
- Vitest unit tests for pure logic and DB wrappers.
- ESLint + Prettier with the scaffold's defaults plus minor config.

### Out of scope (deferred to later phases)
- Book reader (PDF/EPUB rendering, pagination, scrolling, highlighting, tile click → overlay) — Phase 2.
- Notes mode, quote underlines, orange subscript annotations — Phase 2 (requires a reader).
- Real cover image extraction from PDF/EPUB metadata — Phase 2 (will populate `cover_image_path` for rows where `metadata_source = 'filename'`).
- Author auto-extraction — Phase 2.
- AI chat, RAG, dictionary LLM call, streaming, spoiler evaluation, web search — Phase 3.
- WebGL brain animation in the top-right placeholder — Phase 4.
- Circularly scrolling vocabulary/notes/quotes strip; Global Dictionary & Notes modal — Phase 4.

---

## 3. Locked decisions (from brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Cover image strategy | **Stylized auto-generated covers only.** Deterministic SVG from `(title, author)`. Schema reserves `cover_image_path` for Phase 2 real-cover extraction. |
| 2 | App shell architecture | **Zustand + conditional render.** No router. `db/` and `ipc/` modules; components never call `Database.load()`, `invoke()`, or `dialog.open()` directly. |
| 3 | API key storage | **OS keychain** via the Rust `keyring` crate exposed through custom IPC commands. No SQLite storage of the key. |
| 4 | Book metadata parsing | **Filename-derive at upload + Edit Metadata modal in Foundation.** Phase 2 adds an auto-extract pass that fills only rows with `metadata_source = 'filename'`. |
| 5 | First-launch UX | **Library empty state + persistent API-key banner.** No onboarding screen, no flag persistence, no forced redirect. `Later` button hides the banner for the session only. |
| 6 | Add Book affordance | **Quill-and-inkwell** animated tile (in-grid `+` cell) and scaled empty-state CTA. The quill becomes a recurring "creation" motif shared with Notes Mode's orange quill (Phase 2). |

---

## 4. Architecture

### 4.1 Project layout (post-scaffold)

```
scholara/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs                     # Tauri builder + plugin registration
│   │   └── commands/
│   │       ├── mod.rs
│   │       ├── books.rs               # copy_uploaded_file, app_data_dir_path, reveal_in_file_manager
│   │       └── secrets.rs             # get_api_key, set_api_key
│   ├── migrations/
│   │   └── 0001_init.sql
│   ├── tauri.conf.json
│   └── Cargo.toml
├── src/
│   ├── main.tsx
│   ├── App.tsx                        # top-level view switch
│   ├── store.ts                       # zustand store
│   ├── db/
│   │   ├── client.ts                  # Database.load() singleton + PRAGMA foreign_keys = ON
│   │   ├── books.ts                   # listBooks, insertBook, updateMetadata, deleteBook
│   │   ├── vocabulary.ts              # stub for Phase 3
│   │   ├── notes.ts                   # stub for Phase 2
│   │   ├── conversations.ts           # stub for Phase 3
│   │   └── types.ts                   # Book, Note, Vocab, Conversation
│   ├── ipc/
│   │   ├── files.ts                   # copyUploadedFile, appDataDirPath, revealInFileManager
│   │   └── secrets.ts                 # getApiKey, setApiKey
│   ├── screens/
│   │   ├── Library/
│   │   │   ├── index.tsx
│   │   │   ├── Header.tsx
│   │   │   ├── ApiKeyBanner.tsx
│   │   │   ├── BookGrid.tsx
│   │   │   ├── BookTile.tsx
│   │   │   ├── GeneratedCover.tsx
│   │   │   ├── AddBookButton.tsx       # quill-and-inkwell, two variants
│   │   │   ├── EditMetadataModal.tsx
│   │   │   ├── BrainPlaceholder.tsx    # // DEFERRED: WebGL brain animation
│   │   │   └── ScrollStripPlaceholder.tsx  # // DEFERRED: scrolling vocab/notes/quotes
│   │   └── Settings/
│   │       ├── index.tsx
│   │       ├── ApiKeyForm.tsx
│   │       └── DataLocationPanel.tsx
│   ├── components/ui/                 # shadcn/ui generated
│   └── lib/
│       ├── cn.ts                      # tailwind class merger
│       ├── titleCase.ts               # smart filename → title
│       ├── hash.ts                    # FNV-1a 32-bit
│       ├── coverPalette.ts            # 12 curated palettes + 6 patterns
│       └── animations.ts              # framer-motion variants for the quill
├── tests/
│   ├── titleCase.test.ts
│   ├── hash.test.ts
│   ├── coverPalette.test.ts
│   └── db/
│       └── books.test.ts
├── tailwind.config.ts
├── postcss.config.js
├── vitest.config.ts
├── package.json
└── ...
```

### 4.2 Module boundaries

- React components import only from `db/`, `ipc/`, `lib/`, `components/ui/`, and the store. They do **not** import `@tauri-apps/api` or `@tauri-apps/plugin-*` directly.
- `db/` is the only place that talks to `tauri-plugin-sql`. `ipc/` is the only place that calls `invoke()`. `secrets/` lives inside `ipc/secrets.ts`.
- The Rust side exposes a narrow command surface (six commands total). All app logic lives in TypeScript.

### 4.3 Zustand store shape

```ts
interface AppStore {
  view: 'library' | 'settings';
  books: Book[];
  apiKey: string | null;
  apiKeyBannerDismissed: boolean;       // session-only, not persisted

  setView(view: 'library' | 'settings'): void;
  loadBooks(): Promise<void>;
  appendBook(book: Book): void;
  updateBookMetadata(id: number, patch: { title: string; author: string | null }): Promise<void>;
  deleteBook(id: number): Promise<void>;
  loadApiKey(): Promise<void>;
  saveApiKey(key: string): Promise<void>;
  dismissApiKeyBanner(): void;
}
```

Boot sequence (in `App.tsx` `useEffect`): `loadApiKey()` then `loadBooks()` in parallel.

---

## 5. Database

### 5.1 Migration `0001_init.sql`

```sql
CREATE TABLE books (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT    NOT NULL,
  author            TEXT,
  cover_image_path  TEXT,
  file_path         TEXT    NOT NULL UNIQUE,
  file_type         TEXT    NOT NULL CHECK (file_type IN ('pdf','epub')),
  last_opened       TEXT,
  current_position  TEXT,
  display_mode      TEXT    NOT NULL DEFAULT 'agent' CHECK (display_mode IN ('agent','reader')),
  metadata_source   TEXT    NOT NULL DEFAULT 'filename' CHECK (metadata_source IN ('filename','user','extracted')),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE vocabulary (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  word        TEXT    NOT NULL,
  definition  TEXT    NOT NULL,
  book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vocab_book ON vocabulary(book_id);
CREATE INDEX idx_vocab_recent ON vocabulary(created_at DESC);

CREATE TABLE notes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id           INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  page_or_position  TEXT    NOT NULL,
  note_text         TEXT,
  quote_text        TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (note_text IS NOT NULL OR quote_text IS NOT NULL)
);
CREATE INDEX idx_notes_book ON notes(book_id);

CREATE TABLE conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  role        TEXT    NOT NULL CHECK (role IN ('user','assistant')),
  content     TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_conv_book_time ON conversations(book_id, created_at);
```

### 5.2 Notes on the schema

- All timestamps are ISO-8601 strings (`datetime('now')`), platform-stable and human-readable.
- `current_position` and `page_or_position` are opaque JSON `TEXT`. Phase 2 will define their shape per `file_type` (e.g., `{ page: 42 }` for PDF, `{ cfi: "epubcfi(...)", chapter: 3 }` for EPUB).
- `cover_image_path` is `NULL` in Foundation; reserved for Phase 2.
- `metadata_source` lets Phase 2's auto-extract pass fill only rows the user hasn't touched.
- `ON DELETE CASCADE` on every child FK; deleting a book purges its notes/vocabulary/conversations.

### 5.3 Client setup

`db/client.ts` is a lazy singleton:
1. First call to `getDb()` → `Database.load("sqlite:scholara.db")`.
2. Immediately runs `PRAGMA foreign_keys = ON;` (the plugin does not enable this by default).
3. Subsequent calls return the cached instance.

---

## 6. Tauri integration

### 6.1 Plugins registered (`src-tauri/src/lib.rs`)

- `tauri-plugin-sql` (with `sqlite` feature) — runs `migrations/0001_init.sql` on first launch.
- `tauri-plugin-dialog` — file picker for Add Book.
- `tauri-plugin-opener` — `reveal_in_file_manager` IPC uses this.
- `tauri-plugin-fs` — **not registered.** All FS goes through our own commands.

### 6.2 Rust dependencies (`src-tauri/Cargo.toml`)

```
tauri = { version = "2", ... }
tauri-plugin-sql      = { version = "2", features = ["sqlite"] }
tauri-plugin-dialog   = "2"
tauri-plugin-opener   = "2"
keyring               = "3"
uuid                  = { version = "1", features = ["v4"] }
serde                 = { version = "1", features = ["derive"] }
serde_json            = "1"
```

### 6.3 IPC commands

| Command | Args | Returns | Purpose |
|---|---|---|---|
| `copy_uploaded_file` | `source_path: String` | `{ stored_path: String, file_type: 'pdf' \| 'epub' }` | Copies the picked file to `<app_data_dir>/books/<uuid>.<ext>`. Detects file type from the lowercase extension; rejects anything other than `pdf` or `epub`. |
| `app_data_dir_path` | — | `String` | Absolute path of the Tauri app data directory. |
| `reveal_in_file_manager` | `path: String` | `void` | Opens the OS file manager focused on the given path, via `tauri-plugin-opener`. |
| `get_api_key` | — | `String \| null` | Reads from OS keychain (`keyring::Entry::new("scholara", "anthropic_api_key")`). Returns `null` if not set. |
| `set_api_key` | `key: String` | `void` | Writes to OS keychain. Empty string deletes the entry. |

### 6.4 TS-side wrappers (`src/ipc/`)

```ts
// ipc/files.ts
export async function copyUploadedFile(source: string): Promise<{ storedPath: string; fileType: 'pdf' | 'epub' }>;
export async function appDataDirPath(): Promise<string>;
export async function revealInFileManager(path: string): Promise<void>;

// ipc/secrets.ts
export async function getApiKey(): Promise<string | null>;
export async function setApiKey(key: string): Promise<void>;  // pass '' to clear
```

### 6.5 Error handling

- All Rust commands return `Result<T, String>`, with the `Err` value being a human-readable message.
- TS wrappers re-throw on error; callers catch and surface a toast.
- User-visible toast text:
  - File copy fail (read or write) → "Could not save book. Try again or choose a different file."
  - Keychain read fail (other than `NoEntry`) → "Could not access keychain. Check OS permissions."
  - Keychain write fail → "Could not save API key. Check OS permissions."
- No structured error types in Foundation. We add them later only if the UI needs to branch on error kind.

---

## 7. First-launch UX

There is no dedicated welcome screen. First launch lands directly on the Library, which displays:

- **Empty state** in the grid area: a centered, scaled-up quill-and-inkwell affordance (the same component used as the in-grid `+` tile, sized larger), with the message "Begin a new study." in serif. Clicking opens the file picker.
- **API-key banner** (only when `apiKey === null` and `apiKeyBannerDismissed === false`): a thin amber bar across the top of the Library, reading *"Add your Anthropic API key to unlock the AI study mentor."*, with `Set up` (navigates to Settings) and `Later` (sets `apiKeyBannerDismissed = true` for the session) buttons.

Once the user adds a book, the empty state disappears and the grid renders. Once the user saves an API key, the banner disappears. Neither prompt persists state between launches; both reflect ground truth from the store.

---

## 8. Library screen

### 8.1 Layout

CSS grid, `grid-template-columns: 1fr 20rem`. Right column is two stacked placeholders.

```
┌────────────────────────────────────────────────┬─────────────┐
│  [API-key banner — only when key is null]      │             │
│                                                │   BRAIN     │
│  Scholara                          [⚙ Settings]│ PLACEHOLDER │
│  ─────────────────────────────────────────     │   ~40% h    │
│                                                ├─────────────┤
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐        │             │
│  │ TILE │  │ TILE │  │ TILE │  │ TILE │        │  SCROLL     │
│  └──────┘  └──────┘  └──────┘  └──────┘        │  STRIP      │
│  Title     Title     Title     Title           │ PLACEHOLDER │
│  Author    Author    Author    Author          │   ~60% h    │
│                                                │             │
│  ┌──────┐  ┌──────┐                            │             │
│  │ TILE │  │ +    │   ← quill-and-inkwell      │             │
│  └──────┘  └──────┘                            │             │
└────────────────────────────────────────────────┴─────────────┘
```

### 8.2 Tile sizing

- Tiles: `aspect-[2/3]` (book cover ratio).
- Grid: `grid-cols-[repeat(auto-fill,minmax(160px,1fr))]`, `gap-8`.
- Title under tile in `font-serif`, author below in muted sans-serif at 80% opacity.
- Tiles get `shadow-sm`; `hover:shadow-md hover:-translate-y-0.5 transition` for a subtle lift.

### 8.3 Aesthetic

- Background: warm off-white (`#FAFAF7` / cream). Not pure white.
- Title font: serif with a tasteful default stack — `"Iowan Old Style", "Palatino Linotype", Georgia, serif`.
- Chrome font: system sans-serif via Tailwind's default stack.
- Generous outer padding: `px-12 py-10`.
- Header wordmark: "Scholara" in serif, tracking `tracking-tight`, larger size.

### 8.4 Add Book flow

1. User clicks `<AddBookButton />` (in-grid `+` tile or empty-state CTA).
2. `dialog.open({ filters: [{ name: 'Books', extensions: ['pdf', 'epub'] }], multiple: false })`.
3. If `null` (cancelled), return silently.
4. Call `copyUploadedFile(sourcePath)` → `{ storedPath, fileType }`.
5. Derive title with `lib/titleCase.ts` — strip extension, replace `[_\-]+` with spaces, collapse whitespace, title-case smartly (lowercase function words `a/an/the/of/in/on/at/by/for/and/or/to`).
6. `db/books.insertBook({ title, author: null, file_path: storedPath, file_type: fileType, metadata_source: 'filename' })` returns the inserted row.
7. `store.appendBook(newRow)` → grid re-renders.
8. Toast: *"Added \"{title}\""* with an `Edit` action that opens `<EditMetadataModal />` for that book.
9. On error at any IPC or DB step: toast with the message from §6.5.

### 8.5 Edit metadata modal

- shadcn `Dialog`. Trigger: hover overflow (`⋯`) on a tile → "Edit metadata" menu item.
- Fields:
  - Title — required, `Input`, single-line, max 300 chars.
  - Author — optional, `Input`, single-line, max 300 chars.
- Buttons: `Save` (primary), `Cancel` (secondary).
- On Save: `db/books.updateMetadata(id, { title, author, metadata_source: 'user' })`, store updates, modal closes. Toast: "Updated."
- The modal also exposes a `Delete book` button at the bottom (visually de-emphasized). Clicking opens an inline confirm: "Delete \"{title}\"? This removes the file and any notes." Confirm → `db/books.deleteBook(id)` → cascades → store removes from `books`. Toast: "Deleted."

### 8.6 Quill-and-inkwell affordance (`<AddBookButton />`)

Two variants of the same component (`variant: 'tile' | 'cta'`):

- **`tile`** — appears as the last cell in the grid when `books.length > 0`. Same `aspect-[2/3]` as a book tile. No title/author beneath it.
- **`cta`** — appears in the empty state, scaled larger (~240px wide), with the message "Begin a new study." in serif beneath.

Visual elements (rendered as inline SVG, animated with framer-motion):
- A small **porcelain inkwell** at the bottom of the tile, in palette cream/off-white with a subtle gray rim.
- A **feather quill** resting against the inkwell at a slight angle, with a warm sepia ink-stain near the nib.

States:
- **Idle:** The quill drifts gently — a slow, low-amplitude rotation (~±1°) and translation (~±1px) in a 4-second loop. Subtle enough to be peripheral.
- **Hover:** The quill smoothly lifts away from the inkwell (200ms ease-out), rotates upright, dips into the well (the nib enters and a small ink ripple fires in the inkwell), then draws a calligraphic flourish across the tile (an SVG `path` with `pathLength` animated 0 → 1 over ~600ms) that resolves into a delicate "+". The flourish persists while hovered.
- **Un-hover:** Flourish fades over 300ms; quill returns to its idle position.
- **Click / press:** The flourish completes if mid-animation; the picker opens.
- **Drag-over (file dragged onto the tile):** The inkwell ink ripples; the parchment-cream background brightens slightly. (Drag-and-drop is wired to the same handler as click, accepting `.pdf` / `.epub` only.)

Accessibility: keyboard-focusable; `Enter` / `Space` triggers the same handler; visible focus ring (warm gold).

### 8.7 Drag-and-drop

The Library window accepts `.pdf` / `.epub` drops anywhere over the grid area. Drop handler is the same as Add Book click. Visual feedback: when a drop is in progress, the grid's background shifts subtly to indicate receptivity and the quill-and-inkwell tile highlights.

### 8.8 Deferred placeholders

- `<BrainPlaceholder />`: empty `<div>` with `// DEFERRED: WebGL brain animation` comment, very light gray background, sized to ~40% of the right column height.
- `<ScrollStripPlaceholder />`: empty `<div>` with `// DEFERRED: scrolling vocab/notes/quotes strip` comment, very light gray background, sized to ~60% of the right column height.

Both render as intentional reserved space — subtle borders or backgrounds, not blank gaps.

### 8.9 Tile click

In Foundation, `<BookTile />`'s onClick logs `book.id` to the console and shows a toast "Reader coming in the next phase." Phase 2 replaces this with the book overlay.

---

## 9. Settings screen

### 9.1 Layout

A back link, a title, and two sections separated by a divider.

```
← Library

Settings
─────────────────────────────────────

ANTHROPIC API KEY
Used by the AI study mentor. Stored in your OS keychain;
never written to disk by Scholara.

[ ●●●●●●●●●●●●●●●●  ] [ Show ] [ Save ]
Get a key at console.anthropic.com →

─────────────────────────────────────

YOUR LIBRARY
Your books and notes are stored locally at:

/Users/you/Library/Application Support/scholara
[ Reveal in Finder ]
```

### 9.2 API key form (`<ApiKeyForm />`)

- On mount: call `getApiKey()`. If non-null, set the input to a placeholder of dots equal to the key length (or fixed 16 dots) — but **do not** put the actual key in the DOM until the user clicks `Show`.
- `Show` toggles input `type` between `password` and `text`. When toggled to `text` the first time, fetch the actual key and set it as the input value.
- `Save` calls `setApiKey(input.value)`. Empty string clears. Toast on success / error.
- No format validation. Phase 3 will surface real auth errors when the key is used.

### 9.3 Data location panel (`<DataLocationPanel />`)

- On mount: `appDataDirPath()` once, store the result in local component state.
- Render the path as selectable mono-font text.
- `Reveal in Finder` button: calls `revealInFileManager(path)`. The button label is platform-aware — "Reveal in Finder" (macOS), "Show in Explorer" (Windows), "Open in Files" (Linux) — detected at module load via Tauri's `@tauri-apps/api/os` `platform()` (called once, cached). Falls back to "Open folder" if platform detection fails.

### 9.4 Not in Settings (Foundation)

Theme toggle (light only — hard constraint), font/reading prefs, language, sync, account, "Reset app" / "Delete all data."

---

## 10. Generated cover system

### 10.1 Algorithm

1. **Hash** the title with FNV-1a 32-bit (`lib/hash.ts`, ~8 lines, no dependency).
2. **Pick palette** from a curated set of 12 hand-tuned cream / warm / scholarly palettes, indexed by `hash % 12`. Each palette: `{ background, accent, ink }`. All light-mode-appropriate, no neon, no clashing combinations.
3. **Pick pattern** from 6 subtle background motifs, indexed by `(hash >> 8) % 6`: paper grain, faint horizontal rule lines, watermark "S" monogram, marbled endpaper texture, dotted grid, plain. Each rendered at ≤8% opacity over the background.
4. **Render SVG** inline:
   - Base rect with palette `background` and optional pattern overlay.
   - Top accent band: thin horizontal stripe at ~10% from top, palette `accent`.
   - Title: centered in upper-middle, serif, palette `ink`, large. Auto-fits via JS — drops a font-size step (24 → 20 → 16 → 14 px) if title length × current font-size exceeds tile width. Wraps to max 3 lines, ellipsizes after.
   - Author (when present): smaller italic serif, palette `ink` at 70% opacity, centered, lower portion.
   - Bottom decorative element: thin double rule line in `accent`.

### 10.2 Component contract

```tsx
<GeneratedCover
  title={book.title}
  author={book.author}
  imageSrc={book.cover_image_path ?? undefined}  // Phase 2 will populate
/>
```

If `imageSrc` is provided, render that image; otherwise render the SVG. `<BookTile />` memoizes on `(title, author, imageSrc)`.

### 10.3 Why SVG and not Canvas

- Crisp at any tile size (160 in-grid, ~240 empty-state, future detail-view higher).
- Renders synchronously — no first-paint flicker.
- Easy to override when Phase 2 adds real cover images: same prop, different code path.

---

## 11. Tooling

### 11.1 Setup commands

```bash
npm create tauri-app@latest scholara -- --template react-ts
cd scholara
npm install
npm install -D tailwindcss postcss autoprefixer @types/node prettier vitest @vitest/ui jsdom @testing-library/react
npm install zustand
npm install @tauri-apps/plugin-sql @tauri-apps/plugin-dialog @tauri-apps/plugin-opener
npm install framer-motion
npm install class-variance-authority clsx tailwind-merge lucide-react
npx tailwindcss init -p
npx shadcn@latest init                    # configure light-mode, neutral base
```

shadcn components added on demand: `button`, `dialog`, `input`, `dropdown-menu` (for tile overflow), `sonner` (toasts).

### 11.2 Light mode lock

`tailwind.config.ts`: `darkMode: ['class']`. The `dark` class is never applied anywhere. shadcn's CSS-variable definitions cover only the light-mode tokens.

### 11.3 Test setup

Vitest with `jsdom` environment.

- `lib/titleCase.ts`, `lib/hash.ts`, `lib/coverPalette.ts` — full unit coverage.
- `db/books.ts` — happy-path test per function against an in-memory SQLite via `better-sqlite3` (test-only dev dependency). Wraps the same SQL the production `db/client.ts` runs, so the schema migration is shared between the two via a single source-of-truth `migrations/0001_init.sql` read into both.
- IPC and React components: not unit-tested in Foundation. Verified by manual `tauri:dev` smoke testing per §13.

### 11.4 `package.json` scripts

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "tauri": "tauri",
  "tauri:dev": "tauri dev",
  "tauri:build": "tauri build",
  "test": "vitest run",
  "test:watch": "vitest",
  "lint": "eslint . --ext .ts,.tsx",
  "format": "prettier --write ."
}
```

### 11.5 Lint and format

ESLint with the scaffold's defaults; Prettier configured for single-quote, trailing commas, 100-col print width.

---

## 12. Cross-platform considerations

- All file paths constructed via `std::path::PathBuf` on the Rust side; never string-concatenate.
- App data dir resolved via Tauri's `app.path().app_data_dir()` (cross-platform).
- File copy uses `std::fs::copy` — works on macOS, Windows, Linux.
- `keyring` crate handles platform branching internally (macOS Keychain, Windows Credential Manager, Linux Secret Service).
- File-manager reveal via `tauri-plugin-opener` — handles platform-specific commands.

---

## 13. Verification — Foundation is "done" when:

1. `npm run tauri:dev` launches a window showing the Library screen with: header, empty state (quill-and-inkwell CTA), and right-column placeholder divs.
2. Clicking the quill-and-inkwell CTA opens a file dialog. Picking a `.pdf` or `.epub` copies the file to the app data dir, inserts a `books` row, and renders a tile with a generated cover, filename-derived title, and no author. Toast "Added \"{title}\"" with an `Edit` action.
3. Hovering a tile shows the `⋯` overflow. Clicking → "Edit metadata" → modal opens. Editing and saving updates the tile immediately and sets `metadata_source = 'user'` in DB.
4. Deleting a book via the modal removes the tile and the DB row.
5. Quitting and relaunching: uploaded books still appear (DB persistence across launches).
6. Settings gear → Settings screen → entering an API key + Save → toast confirms. Relaunching: key still present (keychain persistence). `Show` reveals it; `Save` with empty input clears it.
7. With API key empty: Library shows the amber banner. Saving a key: banner disappears. `Later`: banner hides for the session, returns next launch.
8. `Reveal in Finder` opens the OS file manager focused on the app data dir.
9. Drag-and-drop a `.pdf` or `.epub` onto the Library window: same outcome as Add Book click.
10. `npm test` passes (logic + DB unit tests).
11. `npm run lint` passes.
12. `npm run tauri:build` produces an installable app bundle on the host OS.

---

## 14. Known follow-ups for later phases

- **Phase 2 (Reader):** PDF/EPUB rendering library decision; auto-extract author + cover for `metadata_source = 'filename'` rows; tile click → book overlay; notes mode; quote underlines; orange subscript annotations; defines `current_position` / `page_or_position` JSON shape.
- **Phase 3 (AI):** LangChain + Anthropic integration; streaming chat panel; dictionary modal; spoiler evaluation; RAG strategy (initial: stuff read-so-far text into prompt); web search later.
- **Phase 4 (Animations & Strip):** WebGL brain animation in `<BrainPlaceholder />`; circularly scrolling vocab/notes/quotes strip in `<ScrollStripPlaceholder />`; Global Dictionary & Notes modal.

---

## 15. Open questions / risks

- **shadcn/ui in a Tauri context:** shadcn's components assume a browser environment but are pure React, so no Tauri-specific issues are expected. If anything surfaces (e.g., portaled dialogs misbehaving inside the Tauri window), document and resolve during scaffolding.
- **`tauri-plugin-sql` migration ordering:** Confirm during scaffold that migrations run before `Database.load()` returns; if not, gate `getDb()` on a one-time setup signal.
- **Linux Secret Service availability:** On Linux distributions without a running Secret Service (rare but possible — e.g., minimal server installs), `keyring` will error. We surface "Could not access keychain" gracefully; Phase 1 does not implement a fallback. If this becomes a real-world issue, Phase 3 can add a SQLite-encrypted fallback when keychain is unavailable.
- **Drag-and-drop file paths in Tauri 2:** Tauri 2 exposes dropped files via the `onFileDrop` event with absolute paths. Confirm during scaffold that this returns OS-absolute paths usable directly by `copyUploadedFile`.
