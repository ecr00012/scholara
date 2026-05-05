# Scholara — Reader Design (Phase 2)

**Date:** 2026-05-05
**Phase:** 2 of 4 (Foundation → **Reader** → AI → WebGL & Scrolling Strip)
**Status:** Approved for implementation planning

---

## 1. Goal & Scope

### 1.1 Goal

Land Phase 2: open any uploaded book in a reader (EPUB or PDF), persist the chosen display mode and reading position per book, support note-taking with quote selection and orange annotations, give "Add to Dictionary" a complete shell with a swappable stub for Phase 3, and backfill `author` + `cover_image_path` for books inserted under Foundation's filename-only metadata. Library tiles gain a thin reading-progress bar so the home screen reflects what's been read.

### 1.2 Scope

**In scope:**
- PDF.js for PDF, epub.js for EPUB, loaded via IPC byte transfer.
- Two display modes (Agent 80/20 and Full Reader) with a per-book persisted toggle.
- Notes Mode: orange quill toggle, one-quote-per-note draft model, save-quill, escape/toggle-off discard.
- Orange annotation rendering: underline span with final-word subscript for quotes, subscript count for notes at a position.
- "Add to Dictionary" floating toolbar on single-word selection; top-of-screen modal driven by a stubbed `streamWordDefinition(word)` that emits placeholder tokens; auto-save on stream completion.
- Auto-extract pass: background, once-per-book, runs at app boot and after each upload. Extracts EPUB title/author/cover and PDF author + page-1 cover render.
- Library tile shows reading-progress bar (warm orange, 2px) along the cover's bottom edge when `current_position` is non-null.
- Cross-fade transition (~250ms) when the auto-extract pass replaces a generated cover with a real one.
- Reader → Library navigation via a `← Library` affordance; missing-file fallback screen.
- New IPC commands: `read_book_bytes`, `save_cover_bytes`, `delete_book_files`. Existing book-delete TS flow extended to call `delete_book_files`.
- New schema migration `0002_phase2.sql` adding `books.epub_locations TEXT NULL`.
- Store gains `view: 'reader'`, `currentBookId`, `currentBookNotes`, `currentBookVocab`, `notesModeActive`, `extractionInFlight`.
- Playwright introduced as second test runner for library-correctness tests.

**Out of scope (deferred to later phases):**
- AI Chat tab content (Phase 3 replaces the placeholder card).
- Real LLM call inside `streamWordDefinition` (Phase 3 swaps the function body).
- Streaming response in the Full Reader floating-input flow (Phase 3 wires it; Phase 2 the input renders and shows a "AI features arriving in Phase 3." toast on submit).
- RAG, spoiler evaluation, conversations table population, web search (Phase 3).
- WebGL brain animation, scrolling vocab/notes/quotes strip, Global Dictionary & Notes modal (Phase 4).
- Asset-protocol streaming for book content (escape hatch if A-mode IPC bytes prove slow on large PDFs — see §16).
- Manual cover-image upload from Edit Metadata (not in scope this phase).

### 1.3 Inherited contracts (unchanged from Foundation)

- All FS through Rust IPC; no `@tauri-apps/api/fs` from components.
- Module boundaries: components → store → db/ + ipc/ → Tauri.
- `<GeneratedCover imageSrc={...} />` is the integration point for real covers (Phase 2 fills the prop).
- Light mode only. shadcn/ui + Tailwind. SQLite via `tauri-plugin-sql`. Cross-platform (macOS / Windows / Linux).
- Auth: none. API key in OS keychain. No SSR.

---

## 2. Locked decisions (from brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Rendering libraries | **PDF.js + epub.js**, used directly (no React wrappers). |
| 2 | Position JSON shape | **Unified discriminated shape with `fraction` scalar.** `{ type: 'pdf' \| 'epub', locator: number \| string, fraction: 0..1, label: string }`. Quote-bearing notes wrap two positions: `{ start, end }`. |
| 3 | EPUB locations cache | **New nullable column** `books.epub_locations TEXT`. Generated once on first EPUB open, cached forever. |
| 4 | Auto-extract trigger | **Background pass on app boot + after each upload.** Once per book ever. Filtered by `WHERE metadata_source = 'filename'`; failures don't stamp, costing only retry CPU. |
| 5 | EPUB metadata extraction | Title (override filename when non-empty after trim), author from `creator`, cover from `book.coverUrl()`. |
| 6 | PDF metadata extraction | Author from doc-info dict (often null — accepted), cover from page-1 render at ~600px wide. **Title stays as filename.** |
| 7 | Reader rendering mode | **EPUB paginated** (epub.js `flow: 'paginated'`); **PDF continuous virtualized scroll**. |
| 8 | Quote/note model | **One quote per note row.** Drafts replace, never accumulate. |
| 9 | Notes Mode save UI | **Small orange quill** icon adjacent to the note input. |
| 10 | Display modes UI | Agent (80/20 split, four-tab agent panel; AI Chat is placeholder); Full Reader (full-screen + bottom-center floating logo expanding into a liquid-glass input). |
| 11 | Mode toggle persistence | Persists immediately on flip; writes `books.display_mode`. |
| 12 | Dictionary modal stub | `streamWordDefinition(word) → DefinitionStream` interface; Phase 2 stub fakes a token stream of a placeholder string; auto-save on `done`. |
| 13 | Word selection trigger | Single-word selection only. Multi-word selection is reserved for the Notes-Mode quote flow. |
| 14 | File loading strategy | **A: IPC `read_book_bytes` returns full file bytes**, with path-traversal guard. |
| 15 | Position persistence cadence | Debounced 500ms write on every page-flip / scroll-stop. |
| 16 | `last_opened` | Bumped on book open (fire-and-forget). |
| 17 | Reader navigation | Full-screen view swap (third value in `view`); missing-file fallback screen with `← Library`. |
| 18 | Library tile progress | 2px warm-orange bar along cover's bottom edge when `current_position` is non-null. |
| 19 | Cover crossfade | ~250ms cross-fade when auto-extract replaces generated cover with real one. |
| 20 | Module split | Per-library leaf components (`EpubReader`, `PdfReader`) under shared chrome (`Reader/index.tsx`). |
| 21 | Test layering | **Vitest** for pure helpers + DB; **Playwright** for library-correctness tests against `vite preview`. |

---

## 3. Architecture

### 3.1 Project layout (additions to Foundation)

```
src/
├── screens/
│   └── Reader/
│       ├── index.tsx                  # the reader view; chooses display mode + leaf
│       ├── AgentDisplay.tsx           # 80/20 shell
│       ├── FullReaderDisplay.tsx      # full-screen shell
│       ├── EpubReader.tsx             # epub.js leaf
│       ├── PdfReader.tsx              # PDF.js leaf — virtualized page list
│       ├── ReaderChrome.tsx           # back link, mode toggle, quill, page indicator
│       ├── ModeToggle.tsx             # segmented agent/reader control
│       ├── NotesModeInput.tsx         # the note-body input + save-quill
│       ├── FloatingLogoInput.tsx      # bottom-center floating logo → liquid-glass input
│       ├── DictionaryModal.tsx        # top-of-screen modal driven by streamWordDefinition
│       ├── SelectionToolbar.tsx       # floating "Add to Dictionary" / "Highlight as Quote"
│       ├── MissingFileScreen.tsx      # fallback when book.file_path can't be read
│       ├── annotations/
│       │   ├── EpubAnnotations.ts     # epub.js range underline + final-word <sup>
│       │   └── PdfAnnotations.ts      # rect-overlay underline + final-word <sup>
│       └── agentPanel/
│           ├── AgentPanel.tsx         # tab container
│           ├── AiChatTab.tsx          # placeholder card
│           ├── NotesTab.tsx           # lists notes for this book
│           ├── HighlightsTab.tsx      # lists notes that have a quote
│           └── DictionaryTab.tsx      # lists vocabulary for this book
├── llm/
│   └── dictionary.ts                  # streamWordDefinition stub + DefinitionStream type
├── lib/
│   ├── extractMetadata.ts             # background-pass entry point
│   ├── epubExtract.ts                 # title/author/cover/locations from epub.js
│   ├── pdfExtract.ts                  # author/page-1-cover from PDF.js
│   ├── positionShape.ts               # Position/QuoteRange (de)serialization helpers
│   ├── positionProgress.ts            # getProgress(json) → fraction | null
│   └── pdfRectTransform.ts            # PDF unit-space ↔ viewport-pixel math
├── ipc/
│   └── files.ts                       # ADD: readBookBytes, saveCoverBytes, deleteBookFiles
├── db/
│   ├── books.ts                       # ADD: setCurrentPosition, setDisplayMode,
│   │                                  #      setLastOpened, setExtractedMetadata,
│   │                                  #      setEpubLocations, listBooksNeedingExtraction
│   ├── notes.ts                       # IMPLEMENT: listNotesForBook, insertNote, deleteNote
│   └── vocabulary.ts                  # IMPLEMENT: listVocabularyForBook, listAllVocabulary,
│                                      #            insertVocabulary, deleteVocabulary
└── store.ts                           # ADD: openBook, closeBook, currentBookId, view='reader',
                                       #      and reader-scoped data + actions

src-tauri/
├── migrations/
│   └── 0002_phase2.sql                # ADD: ALTER TABLE books ADD COLUMN epub_locations TEXT
└── src/commands/
    └── books.rs                       # ADD: read_book_bytes, save_cover_bytes, delete_book_files

tests/
└── playwright/                        # NEW
    ├── fixtures/{sample.epub, sample-no-cover.epub, sample.pdf,
    │             sample-no-author.pdf, cross-page.pdf}
    ├── mocks/{ipc.ts, db.ts}
    └── *.spec.ts
playwright.config.ts                   # NEW
```

### 3.2 Reader composition pattern

```
<ReaderScreen>                                  // src/screens/Reader/index.tsx
  ├── (hooks: load book, set last_opened, kick metadata pass)
  ├── if missing → <MissingFileScreen />
  ├── if displayMode === 'agent' → <AgentDisplay book={book}>
  │     ├── <ReaderChrome book={book} />        // top bar
  │     ├── <ReaderLeaf book={book} ... />      // EpubReader or PdfReader
  │     ├── <NotesModeInput ... />              // only when notes mode active
  │     └── <AgentPanel book={book} />          // right column, four tabs
  └── if displayMode === 'reader' → <FullReaderDisplay book={book}>
        ├── <ReaderChrome book={book} variant="fullscreen" />
        ├── <ReaderLeaf book={book} ... />      // same leaf component
        └── (notesModeActive ? <NotesModeInput fullWidth /> : <FloatingLogoInput />)
```

`ReaderLeaf` resolves at runtime: `book.file_type === 'pdf' ? <PdfReader /> : <EpubReader />`. The two leaves expose the same React props:

```ts
interface ReaderLeafProps {
  bytes: ArrayBuffer;                                  // from readBookBytes
  initialPosition: Position | null;
  onPositionChange(pos: Position): void;                // debounced upstream
  onSelectionChange(sel: ReaderSelection | null): void; // null when nothing selected
  notes: NoteRow[];                                     // for annotation rendering
  notesModeActive: boolean;                             // affects selection highlight
  registerJumpTo(fn: (pos: Position) => void): void;    // parent gets a jump callback
  registerGetCurrentPosition(fn: () => Position): void; // for body-only note save
  /** Only set on EPUB leaf, optional out-param for caching epub_locations after first gen */
  cachedEpubLocations?: string | null;
  onEpubLocationsGenerated?(locations: string): void;
}
```

`ReaderSelection` is the unified cross-library selection shape:

```ts
type ReaderSelection =
  | { kind: 'word'; word: string; anchorRect: DOMRect }            // for Dictionary toolbar
  | { kind: 'range'; text: string; position: QuoteRange;
      anchorRect: DOMRect };                                       // for Notes Mode quote
```

### 3.3 Module boundary reaffirmation

- `Reader/` components import from `db/`, `ipc/`, `lib/`, `llm/`, the store, and `components/ui/`. They **never** import `@tauri-apps/api/*` or `@tauri-apps/plugin-*` directly. PDF.js and epub.js are imported only by the leaf components and the `lib/*Extract.ts` modules.
- `lib/extractMetadata.ts` is the only module that touches both `db/books.ts` and the per-format extractors. Components don't import it directly — the store calls it on boot and after upload.
- `llm/dictionary.ts` exports the stub today; Phase 3 rewrites the body of `streamWordDefinition`. The exported type `DefinitionStream` is the contract.
- The one acceptable use of `@tauri-apps/api/core`'s `convertFileSrc` is in `GeneratedCover.tsx` for `<img src>` of an extracted cover — see §11.3.

### 3.4 Position contract

```ts
// src/db/types.ts (ADDED)

export type Position =
  | { type: 'pdf';  locator: number; fraction: number; label: string }
  | { type: 'epub'; locator: string; fraction: number; label: string };

export type QuoteRange = { start: Position; end: Position };

// Stored in books.current_position as JSON.stringify(Position).
// Stored in notes.page_or_position as JSON.stringify(Position | QuoteRange).
//
// notes with quote_text non-null → page_or_position is QuoteRange.
// notes with quote_text null     → page_or_position is Position.
```

The discriminator-on-`type` makes the runtime branch obvious; the unified `fraction` field lets Phase 3's spoiler-aware RAG do "is this passage before current position?" comparisons in pure JS without library round-trips.

For PDF: `locator` is the 1-indexed page number. `fraction = locator / totalPages`. `label = "Page N"`.
For EPUB: `locator` is a CFI string. `fraction = book.locations.percentageFromCfi(locator)`. `label = chapter title` (or "Chapter N" fallback).

For PDF QuoteRange we *also* persist the page-rect payload alongside `start`/`end`; see §9 for the exact encoding (`pages: [{ page, rects: [...] }]`).

---

## 4. Database

### 4.1 Migration `0002_phase2.sql`

```sql
ALTER TABLE books ADD COLUMN epub_locations TEXT;
```

That's the entire migration. We don't add a separate "extraction failed" column (failures retry harmlessly), don't change `notes` (the JSON shape is opaque to SQL), and don't add new tables.

### 4.2 New `db/books.ts` functions

```ts
// All take SqlExecutor as their first arg, matching the existing pattern.

export async function setCurrentPosition(db, id, position: Position): Promise<void>;
export async function setDisplayMode(db, id, mode: 'agent' | 'reader'): Promise<void>;
export async function setLastOpened(db, id): Promise<void>;       // sets datetime('now')
export async function setEpubLocations(db, id, locations: string): Promise<void>;

export async function setExtractedMetadata(db, id, patch: {
  title?: string;
  author?: string | null;
  cover_image_path?: string | null;
}): Promise<void>;
// Stamps metadata_source = 'extracted'. Only updates fields present in patch.
// Caller (extractMetadata.ts) is responsible for not calling this for rows
// where metadata_source !== 'filename'.

export async function listBooksNeedingExtraction(db): Promise<Book[]>;
// SELECT ... WHERE metadata_source = 'filename'
```

### 4.3 New `db/notes.ts` functions

```ts
export async function listNotesForBook(db, bookId): Promise<NoteRow[]>;
// Ordered by created_at ASC.

export async function insertNote(db, input: {
  book_id: number;
  page_or_position: string;        // already JSON.stringified by caller
  note_text: string | null;
  quote_text: string | null;
}): Promise<number>;
// Throws if both note_text and quote_text are null (CHECK constraint).

export async function deleteNote(db, id): Promise<void>;
```

### 4.4 New `db/vocabulary.ts` functions

```ts
export async function listVocabularyForBook(db, bookId): Promise<VocabRow[]>;
// Ordered by created_at DESC.

export async function listAllVocabulary(db): Promise<VocabRow[]>;
// Used by Phase 4's Global Dictionary, but the function lives here now since
// the Dictionary tab in the agent panel benefits from a uniform helper.

export async function insertVocabulary(db, input: {
  word: string;
  definition: string;
  book_id: number;
}): Promise<number>;

export async function deleteVocabulary(db, id): Promise<void>;
```

---

## 5. IPC commands

### 5.1 New Rust commands

| Command | Args | Returns | Purpose |
|---|---|---|---|
| `read_book_bytes` | `path: String` | `Vec<u8>` | Read full file from disk. Canonicalize input and verify it lives under `<app_data_dir>/books/`; reject otherwise. |
| `save_cover_bytes` | `book_id: i64, bytes: Vec<u8>, ext: String` | `String` (stored path) | Validate `ext ∈ {jpg, jpeg, png, webp}`. Write to `<app_data_dir>/covers/<book_id>.<ext>`, creating the `covers/` directory if missing. Return the absolute stored path. |
| `delete_book_files` | `book_id: i64, file_path: String` | `()` | Delete `<file_path>` (the books/<uuid>.<ext>) and any `covers/<book_id>.*`. Idempotent — succeeds even if files are already missing. |

All follow the Foundation `Result<T, String>` convention; TS wrappers re-throw, callers toast.

### 5.2 TS-side wrappers (`src/ipc/files.ts` additions)

```ts
export async function readBookBytes(path: string): Promise<ArrayBuffer>;
export async function saveCoverBytes(
  bookId: number,
  bytes: ArrayBuffer,
  ext: 'jpg' | 'jpeg' | 'png' | 'webp',
): Promise<string>;
export async function deleteBookFiles(bookId: number, filePath: string): Promise<void>;
```

`readBookBytes` converts the returned `Uint8Array` to its underlying `ArrayBuffer` (which is what PDF.js / epub.js want).

### 5.3 Path-traversal guard (Rust)

```rust
fn assert_within_books_dir(app: &AppHandle, path: &Path) -> Result<(), String> {
    let books_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("books");
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    let canonical_books = books_dir.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.starts_with(&canonical_books) {
        return Err("Path is outside the books directory".into());
    }
    Ok(())
}
```

Cheap insurance against a malformed `file_path` row sneaking past — defense in depth even though Foundation's `copyUploadedFile` is the only writer.

### 5.4 Existing book-delete flow extension

The TS-side delete path becomes:
1. `await deleteBookFiles(bookId, file_path)` — removes file + cover from disk.
2. `await booksDb.deleteBook(db, id)` — removes the row, cascades notes/vocab/conversations.

If (1) fails, we still proceed to (2) with a soft-warn toast. Orphaned files are recoverable; orphaned DB rows are not.

### 5.5 Capabilities

`src-tauri/capabilities/default.json`: add the three new commands to the allowlist. No new plugin permissions needed (custom commands are on the `tauri.command` allowlist, not a plugin allowlist).

`src-tauri/tauri.conf.json` security section: add `<app_data_dir>/covers/**` to the asset-protocol scope (read-only), used only by `<img>` for displaying extracted cover thumbnails (§11.3). Book content stays on the IPC-bytes path.

---

## 6. Auto-extract pass

### 6.1 Lifecycle

Triggered:
1. **App boot:** `App.tsx`'s `useEffect` calls `runMetadataExtractionPass()` after `loadBooks()` resolves.
2. **After upload:** `Library/index.tsx`'s drop and click handlers call `runMetadataExtractionPass()` after `insertBook` returns. Re-entrant: if a pass is already in flight, the new call is a no-op (the new book will be picked up by the in-progress pass on its next iteration anyway).

### 6.2 Pass algorithm (`lib/extractMetadata.ts`)

```ts
export async function runMetadataExtractionPass(
  store: AppState,
): Promise<void> {
  const db = await getDb();
  const candidates = await listBooksNeedingExtraction(db); // metadata_source = 'filename'

  for (const book of candidates) {
    if (store.extractionInFlight.has(book.id)) continue;
    store.extractionInFlight.add(book.id);

    try {
      const bytes = await readBookBytes(book.file_path);
      const result = book.file_type === 'epub'
        ? await extractEpubMetadata(bytes, book.id)
        : await extractPdfMetadata(bytes, book.id);

      await setExtractedMetadata(db, book.id, result);
      // Refresh just this book in the store (in-place patch, not full reload):
      store.patchBook(book.id, { ...result, metadata_source: 'extracted' });
    } catch (err) {
      console.warn(`Metadata extraction failed for book ${book.id}:`, err);
      // Intentionally no DB write — book stays at metadata_source = 'filename',
      // will retry on next boot. Confirmed acceptable by design.
    } finally {
      store.extractionInFlight.delete(book.id);
    }
  }
}
```

Serial loop, one book at a time. Yields naturally to the event loop between books. No concurrency — keeps the main thread responsive and avoids two PDF.js page renders fighting for the same canvas pool.

The `store.patchBook` action takes an `id` and a partial `Book`, updates that single row in `state.books` immutably. This is what triggers the cover crossfade (the tile re-renders with `cover_image_path` newly set).

### 6.3 EPUB extractor (`lib/epubExtract.ts`)

```ts
export async function extractEpubMetadata(
  bytes: ArrayBuffer,
  bookId: number,
): Promise<{ title?: string; author: string | null; cover_image_path: string | null }> {
  const book = ePub(bytes);
  await book.ready;

  const meta = book.packaging.metadata;

  const titleRaw = (meta.title ?? '').trim();
  const authorRaw = (meta.creator ?? '').trim();

  // Cover: epub.js returns a Blob URL; we fetch the Blob and persist its bytes.
  let coverPath: string | null = null;
  try {
    const url = await book.coverUrl();
    if (url) {
      const blob = await (await fetch(url)).blob();
      const ext = blob.type === 'image/png' ? 'png'
                : blob.type === 'image/webp' ? 'webp' : 'jpg';
      const buf = await blob.arrayBuffer();
      coverPath = await saveCoverBytes(bookId, buf, ext);
    }
  } catch {
    // EPUB without a cover image is common; not an error.
  }

  return {
    ...(titleRaw ? { title: titleRaw } : {}),
    author: authorRaw || null,
    cover_image_path: coverPath,
  };
}
```

Title only included in the patch if non-empty after trim — respects "only override filename when present and non-empty."

### 6.4 PDF extractor (`lib/pdfExtract.ts`)

```ts
export async function extractPdfMetadata(
  bytes: ArrayBuffer,
  bookId: number,
): Promise<{ author: string | null; cover_image_path: string | null }> {
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;

  const info = (await pdf.getMetadata()).info as { Author?: string };
  const author = (info.Author ?? '').trim() || null;

  let coverPath: string | null = null;
  try {
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const targetWidth = 600;
    const scale = targetWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png'),
    );
    coverPath = await saveCoverBytes(bookId, await blob.arrayBuffer(), 'png');
  } catch {
    // Encrypted/corrupt PDFs may fail page render — leave cover null.
  }

  return { author, cover_image_path: coverPath };
}
```

`title` is intentionally not in the return shape — PDF title stays as filename.

### 6.5 What the user sees

- Boot Phase-2 first time after Phase-1 use: tiles render with their generated covers; over the next few seconds (one per book) covers cross-fade to extracted ones, authors appear underneath titles.
- Upload a new book: tile appears immediately with generated cover + filename title; within 1–2 seconds (one book) it cross-fades to the real cover and the author shows up.
- A corrupt file: tile stays with generated cover, no author. Same outcome each launch (silent retries).

---

## 7. Reader chrome & display-mode shells

### 7.1 Common chrome (`ReaderChrome.tsx`)

Both display modes use this top bar:

```
┌─────────────────────────────────────────────────────────┐
│ ← Library    [Reader|Agent]                          🪶 │
└─────────────────────────────────────────────────────────┘
```

- **`← Library`**: text+arrow link, top-left, serif. Calls `store.closeBook()` → sets `view: 'library'`, clears `currentBookId`.
- **Mode toggle**: shadcn `ToggleGroup` with two icon buttons (split-panel and open-book lucide icons). Clicking the inactive button flips and persists `display_mode` immediately.
- **Orange quill**: Notes Mode toggle. Outline when off, filled-amber when on. Tooltip "Take a note (n)". Keyboard shortcut: `n`.

In the Agent display the chrome spans only the reader column (left 80%). In the Full Reader display it spans the full window. Same component, parent-controlled width via `variant: 'split' | 'fullscreen'`.

### 7.2 Agent Display (`AgentDisplay.tsx`)

```
┌──────────────────────────────────────────┬──────────────┐
│ ReaderChrome                              │ AgentPanel  │
│ ─────────────────────────────────────    │  tabs row   │
│                                          │  ─────────  │
│   ReaderLeaf (epub or pdf)               │             │
│                                          │  tab body   │
│                                          │             │
│   prev/next or Page N of M               │             │
│ NotesModeInput (only when notes active)  │             │
└──────────────────────────────────────────┴──────────────┘
```

- CSS grid: `grid-template-columns: 1fr 22rem` (slightly wider than the Library's 20rem because the agent panel needs room for tab content).
- The reader column is itself flex-column: chrome / leaf (`flex-1 min-h-0`) / chrome-bottom (page indicator) / NotesModeInput (conditional).
- Agent panel border-left, cream background tint (`bg-cream/50`) to differentiate from the reading surface.

### 7.3 Full Reader Display (`FullReaderDisplay.tsx`)

```
┌─────────────────────────────────────────────────────────┐
│ ReaderChrome                                             │
│                                                          │
│             ReaderLeaf (epub or pdf)                     │
│                                                          │
│                                                          │
│            ●  ← FloatingLogoInput  (when notes off)      │
│   [▔▔▔▔▔▔▔▔▔▔▔▔▔▔]  ← NotesModeInput  (when notes on)    │
└─────────────────────────────────────────────────────────┘
```

- Reader leaf gets the full window minus the chrome strip.
- `FloatingLogoInput` is absolutely positioned `bottom-6 left-1/2 -translate-x-1/2`. Default state: a 56×56 circle with the Scholara logo, soft shadow, cream background. Click → animates to a `~80vw` × 56 frosted-glass input (`backdrop-blur-md bg-white/40 border border-white/30`), framer-motion `layoutId` shared between circle and input for a smooth morph. Esc or click-outside collapses back. Submit (Enter) → toast: *"AI features arriving in Phase 3."*
- `NotesModeInput` in Full Reader takes the same bottom slot when active, replacing the floating logo. Same width (~80vw), same frosted-glass styling, with the small orange save-quill on the right.
- The orange quill in the chrome (top-right per spec) is the toggle for Notes Mode.

### 7.4 Notes Mode behavioral cues (both displays)

When Notes Mode is active:
- Chrome's quill turns from outline to filled.
- The reader's background gets a faint warm tint (`bg-amber-50/30` overlay) to signal mode change.
- Selection highlights are amber (`bg-amber-200/40`) instead of the browser default.
- The note input slides in (200ms ease-out) at the bottom.

When Notes Mode exits (via toggle off, Esc, or save):
- Chrome's quill returns to outline.
- Tint clears.
- Input slides out.
- Any draft (unsaved selection + unsaved typed body) is discarded silently.

### 7.5 Reader leaf navigation

- **EPUB:** epub.js's `rendition.prev()` / `rendition.next()` driven by:
  - On-screen prev/next arrow buttons centered below the reader.
  - Keyboard: `←` / `→`.
  - Click-on-edge navigation: **deferred** (too easy to misfire while selecting text).
- **PDF:** native scroll. Page indicator is a passive readout updated on scroll-stop. Keyboard: `Space` / `Shift+Space` for page down/up, `Home` / `End` for first/last page.

### 7.6 Agent panel tabs (Phase 2 content)

- **AI Chat:** centered card, serif: *"AI mentor coming soon."* Subdued, no input field rendered.
- **Notes:** scrollable list of `NoteRow`s for this book. Each item shows the quote (italic if present), the note body, the page label (from `position.label`), and a small delete button. Clicking the item calls the leaf's `jumpTo(position)`.
- **Highlights:** subset of Notes — only rows where `quote_text !== null`. Same item shape.
- **Dictionary:** scrollable list of `VocabRow`s for this book. Word in serif, definition below. No edit; delete only.

### 7.7 What loads when

`ReaderScreen` mount:
1. Resolve `book` from store (`books.find(b => b.id === currentBookId)`).
2. If no `book` (e.g., deleted in another window) → render missing-file fallback.
3. Bump `last_opened` (fire-and-forget DB write).
4. Call `readBookBytes(book.file_path)`. Loading state during the await: cream background + small "Opening…" text. If reject → render missing-file fallback.
5. Hand bytes to the leaf; the leaf initializes its library; once ready, render content.
6. Position changes from the leaf are debounced 500ms then written via `setCurrentPosition`.

Missing-file fallback (`MissingFileScreen.tsx`):
```
            This book's file is missing.
       It may have been moved or deleted.

                  [ ← Library ]
```
Notes/vocab for the book are preserved (we don't auto-cleanup the row).

---

## 8. Notes Mode — data model & flow

### 8.1 Component-level state

`NotesModeInput.tsx` owns the Notes Mode draft:

```ts
interface NotesDraft {
  quote: { text: string; range: QuoteRange } | null;   // from selection
  body: string;                                         // typed in input
}
```

The draft is **component state**, not store state — it doesn't survive a remount, but it doesn't need to (closing the reader exits Notes Mode anyway).

### 8.2 Mode lifecycle

```
[off]  ──quill click / 'n' key──>  [on, empty draft]
                                          │
                                          ├──user selects text──> [on, draft.quote = selection]
                                          │      (replaces any prior draft.quote;
                                          │       previous selection's amber tint clears)
                                          │
                                          ├──user types in input──> [on, draft.body = typed]
                                          │
                                          ├──user clicks save-quill──> persist + reset + [off]
                                          │      (only enabled when quote || body is non-empty)
                                          │
                                          ├──user presses Esc──> reset + [off]
                                          │
                                          └──user clicks quill again──> reset + [off]
```

### 8.3 Save action

```ts
async function saveNote(book: Book, draft: NotesDraft) {
  const db = await getDb();

  let positionJson: string;
  if (draft.quote) {
    positionJson = JSON.stringify(draft.quote.range);   // QuoteRange
  } else {
    positionJson = JSON.stringify(getCurrentLeafPosition()); // single Position
  }

  const id = await insertNote(db, {
    book_id: book.id,
    page_or_position: positionJson,
    note_text: draft.body.trim() || null,
    quote_text: draft.quote?.text ?? null,
  });

  // Reload notes for this book so the leaf re-renders annotations and
  // the Notes / Highlights tabs in the agent panel update.
  store.reloadNotesForCurrentBook();

  toast.success('Saved');
}
```

`getCurrentLeafPosition()` is a small ref-based bridge: each leaf exposes `getCurrentPosition(): Position` via a registered callback (`registerGetCurrentPosition` in `ReaderLeafProps`). Used here for body-only notes (no quote selected).

### 8.4 Validation rules

- Save button disabled when `draft.quote === null && draft.body.trim() === ''`.
- A quote with leading/trailing whitespace is trimmed before persistence (the visual highlight follows the trimmed range, not the user's sloppy drag).
- `note_text` empty string → stored as `NULL` (matches Foundation's CHECK constraint).
- Multi-quote per note is impossible by construction — selecting new text *replaces* the draft's quote.

### 8.5 Selection toolbar interactions

When Notes Mode is **on** and the user finishes a multi-word selection:
- `SelectionToolbar` shows **Highlight as Quote** (primary). Click → set `draft.quote = { text, range }`. Toolbar dismisses.
- **Add to Dictionary** is hidden for multi-word selections.

When Notes Mode is **on** and the user finishes a single-word selection:
- `SelectionToolbar` shows **Highlight as Quote** (a single word is a valid quote).
- **Add to Dictionary** is hidden when Notes Mode is on (avoids two competing actions).

When Notes Mode is **off** and the user finishes a single-word selection:
- `SelectionToolbar` shows **Add to Dictionary** (primary). Click → open `DictionaryModal` with the word.

When Notes Mode is **off** and the user finishes a multi-word selection:
- `SelectionToolbar` shows **Take a note on this** — clicking activates Notes Mode AND immediately seeds `draft.quote` with the selection. (Convenience entrypoint that skips the user "click quill, re-select" two-step.)

The toolbar is positioned near the selection's bounding rect (`anchorRect.bottom + 8px, anchorRect.left`). It dismisses on next click anywhere or on selection-clear.

### 8.6 Position vs QuoteRange disambiguation when reading

`page_or_position` is `JSON.parse`'d on read. We tell which kind it is by checking `quote_text !== null`:
- If `quote_text` is non-null → it's a `QuoteRange` (`{ start, end }`).
- Otherwise → it's a `Position`.

Belt-and-suspenders: the parsed object's shape (presence of `start` and `end` keys vs. presence of `type`) is also a discriminator. The leaf annotation modules use both signals defensively.

---

## 9. Annotation rendering

### 9.1 The orange palette

- Underline color: `#C8702C` (warm sepia-orange; matches Foundation's `accent-amber` family — confirm during scaffold).
- Underline weight: 1.5px on EPUB, 1.5px (in PDF coordinate space, scaled to viewport) on PDF.
- Subscript style: `font-size: 0.55em; vertical-align: sub; color: #C8702C; font-weight: 600;`.

### 9.2 EPUB annotations (`annotations/EpubAnnotations.ts`)

epub.js exposes `rendition.annotations.add(type, cfiRange, data, callback, className, styles)`. We use `type: 'underline'`. Two passes per render:

```ts
export function applyEpubAnnotations(
  rendition: Rendition,
  notes: NoteRow[],
): { detach(): void } {
  // Group quote-bearing notes by their CFI range.
  // Group all notes by chapter prefix for subscript counts.

  for (const note of notes) {
    if (note.quote_text) {
      const range = JSON.parse(note.page_or_position) as QuoteRange;
      const cfi = range.start.locator + ',' + range.end.locator;
      // (epub.js range CFIs are encoded with a comma between start and end.)
      rendition.annotations.add(
        'underline',
        cfi,
        { noteId: note.id },
        (e) => onAnnotationClick(note.id, e),
        'scholara-quote-underline',
        { 'text-decoration-color': '#C8702C', 'text-decoration-thickness': '1.5px' },
      );
      // Final-word subscript: in epub.js's annotation `cb`, find the last
      // text node of the rendered range and append a styled <sup>.
    }
  }

  // For position-anchored notes (no quote): inject a <sup> at the position's
  // CFI offset showing the count of notes at the same chapter+position.

  return { detach: () => rendition.annotations.clear() };
}
```

Annotation re-render trigger: when `notes` prop changes (new note saved, note deleted), the `EpubReader` calls `applyEpubAnnotations` after detaching the previous batch.

Click-on-annotation handler: opens an inline popover near the quote with the note body and a delete button.

### 9.3 PDF annotations (`annotations/PdfAnnotations.ts`)

PDF.js renders each page as a canvas with an absolutely-positioned text layer overlay. We add a third absolutely-positioned overlay per page — the **annotation layer** — sibling to the text layer, transparent, capturing pointer events only on the annotation marks.

```ts
export function applyPdfAnnotations(
  pageNumber: number,
  pageContainer: HTMLElement,
  pageViewport: PageViewport,
  notes: NoteRow[],
): void {
  // Clear any existing scholara-annotation children.
  pageContainer.querySelectorAll('.scholara-annotation').forEach(n => n.remove());

  // Find rect-quads for this page from quote-bearing notes whose range overlaps it.
  for (const note of notes) {
    if (!note.quote_text) continue;
    const range = JSON.parse(note.page_or_position) as PdfQuoteRange;
    const onThisPage = range.pages.find(p => p.page === pageNumber);
    if (!onThisPage) continue;

    for (const r of onThisPage.rects) {
      // Convert PDF unit-space rects to viewport pixels via pdfRectTransform.
      const [x, y] = pageViewport.convertToViewportPoint(r.x, r.y + r.h);
      const w = r.w * pageViewport.scale;
      const underline = document.createElement('div');
      underline.className = 'scholara-annotation scholara-quote-underline';
      underline.style.cssText = `
        position: absolute; left: ${x}px; top: ${y}px;
        width: ${w}px; height: 1.5px; background: #C8702C;
        pointer-events: auto; cursor: pointer;
      `;
      underline.dataset.noteId = String(note.id);
      pageContainer.appendChild(underline);
    }

    // Final-word subscript: append on the last rect of the last page in the range.
    if (onThisPage === range.pages[range.pages.length - 1]) {
      // ...append a <sup> styled span at the right edge of the last rect.
    }
  }

  // For position-anchored notes (no quote) on this page: inject a <sup>
  // count near the page's top-right corner showing the count for this page.
}
```

PDF annotations rebuild on every page render (page entering/exiting viewport, zoom change, notes-prop change).

**Note on PDF QuoteRange shape:** for PDFs, the persisted JSON is enriched beyond the unified `{ start, end }` form to also include the per-page rect quads — these are needed for re-rendering. The full shape:

```ts
type PdfQuoteRange = {
  start: Position;      // { type: 'pdf', locator: firstPage, fraction, label }
  end: Position;        // { type: 'pdf', locator: lastPage, fraction, label }
  pages: Array<{
    page: number;
    rects: Array<{ x: number; y: number; w: number; h: number }>;  // PDF unit space
  }>;
};
```

For EPUBs, no enrichment is needed — the CFI range string itself encodes everything epub.js needs to render the underline:

```ts
type EpubQuoteRange = {
  start: Position;      // { type: 'epub', locator: startCfi, fraction, label }
  end: Position;        // { type: 'epub', locator: endCfi, fraction, label }
};
```

`QuoteRange` is therefore a union: `EpubQuoteRange | PdfQuoteRange`, discriminated by `start.type`.

### 9.4 Selection capture for quotes

**EPUB:** epub.js's `rendition.on('selected', (cfiRange, contents) => …)` fires on selection. We split the range CFI on the comma into start and end CFIs; each becomes a Position with `locator` = that CFI half, `fraction` = `book.locations.percentageFromCfi(half)`, `label` = chapter title.

**PDF:** the user drags across the text layer; on `mouseup`, we read `window.getSelection()`. Convert each `Range` to per-page rects via `Range.getClientRects()`, then map back to PDF unit space using each page's inverse viewport transform (helpers live in `lib/pdfRectTransform.ts`). Store as the `pages: [{ page, rects: [...] }]` shape. The `start` Position is `{ page: firstPage, fraction: firstPage / total, label: "Page N" }`; `end` is the last page; the `locator` field on each Position holds the page number.

Cross-page selection in PDF.js continuous scroll is the most fragile area in this phase — covered explicitly by Playwright tests with `cross-page.pdf` (§13.4).

### 9.5 Subscript counts

For each page (PDF) or chapter (EPUB), count notes whose anchor falls there. Render the count as a small `<sup>` in the orange palette:
- PDF position-only notes: top-right of the page, fixed corner.
- EPUB position-only notes: at the CFI's text offset.
- Quote subscripts: on the quote's final word, count of notes at that anchor.

Counts come from the same `notes` prop the leaf already has — derived in-render with a `useMemo`, no separate query.

---

## 10. Dictionary modal & stub

### 10.1 The stub (`src/llm/dictionary.ts`)

```ts
export interface DefinitionStream {
  tokens: AsyncIterable<string>;
  done: Promise<string>;
  abort(): void;
}

export function streamWordDefinition(word: string): DefinitionStream {
  const placeholder =
    `Definition coming soon — Phase 3 will fetch a real definition for "${word}" from Anthropic.`;
  const parts = placeholder.split(/(\s+)/); // keep whitespace as separate tokens

  let aborted = false;
  let resolveDone!: (s: string) => void;
  let rejectDone!: (e: unknown) => void;
  const done = new Promise<string>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });

  async function* tokenGen() {
    let acc = '';
    for (const p of parts) {
      if (aborted) {
        rejectDone(new Error('aborted'));
        return;
      }
      await new Promise((r) => setTimeout(r, 30));
      acc += p;
      yield p;
    }
    resolveDone(acc);
  }

  return {
    tokens: tokenGen(),
    done,
    abort() { aborted = true; },
  };
}
```

Phase 3 replaces the function body with a LangChain streaming call. The interface (`DefinitionStream`) and signature (`streamWordDefinition(word: string)`) are the contract — call sites in `DictionaryModal.tsx` will not change.

The Phase 2 stub is fully local — no network, no telemetry. Phase 3 will introduce the offline check and the "Connect to the internet to use AI features." toast at the same time it adds the only outbound call.

### 10.2 Modal behavior (`DictionaryModal.tsx`)

State:
```ts
type State =
  | { phase: 'streaming'; partial: string }
  | { phase: 'done'; full: string; saved: boolean }
  | { phase: 'aborted' };
```

Lifecycle:
1. Modal mounts with `word` prop. Calls `streamWordDefinition(word)` once.
2. Concurrently:
   - Loop over `tokens`, accumulating into `partial`, re-rendering each chunk.
   - Await `done`. On resolve → `state = 'done'`, then `insertVocabulary({ word, definition: full, book_id: currentBookId })`, set `saved: true`.
3. Click anywhere on the modal:
   - If `phase === 'streaming'` → `abort()`, `state = 'aborted'`, fade out, no DB write.
   - If `phase === 'done'` → fade out (already saved at done-resolve).
4. Animation: slide down from `translateY(-100%)` on mount (200ms ease-out); fade `opacity → 0` on dismiss (200ms ease-in).

### 10.3 Visual structure

```
┌─────────────────────────────────────────────────────────┐
│   serendipity                                            │
│   ─────────────────────────────────────────             │
│   The occurrence and development of events by chance     │
│   in a happy or beneficial way... ▌                      │
└─────────────────────────────────────────────────────────┘
```

- Frosted-glass background (`bg-white/70 backdrop-blur-md`), warm border (`border border-amber-100`).
- Word in serif, 22px, full ink.
- Definition in sans-serif, 16px, soft ink. The `▌` blinking caret indicates streaming-in-progress, hidden once `phase === 'done'`.
- Position: top center, 32px from top, max-width 560px.
- Click target: the entire modal, including its backdrop. Hovering shows a subtle "(click to dismiss)" hint after 1.5s.

### 10.4 Failure modes (Phase 2)

- `streamWordDefinition` throwing: in Phase 2 the stub never throws, but the modal wraps the loop in try/catch and renders "Could not load definition." with a Dismiss button. Phase 3 will surface real errors here.
- Inserting into `vocabulary` failing: log + toast "Could not save to dictionary." The modal still dismisses normally; the user can re-try.

### 10.5 Trigger conditions

The modal opens only when:
- A single-word selection has just completed,
- AND Notes Mode is **off**,
- AND the user clicks "Add to Dictionary" in the SelectionToolbar,
- AND `currentBookId !== null`.

Multi-word selections never reach this path. Selection-with-trailing-punctuation is sanitized: trim and strip leading/trailing non-letter chars before passing to `streamWordDefinition`. If the result is empty or contains internal whitespace (multi-word after sanitize), we don't show "Add to Dictionary."

---

## 11. Library updates

The Library screen gets two minor visual additions and one wiring change. Foundation's component layout stays put.

### 11.1 Tile click → open reader (replaces Foundation's no-op toast)

`BookTile.tsx` (currently logs `book.id` and toasts "Reader coming in the next phase.") changes its `onClick` to:

```ts
onClick={() => store.openBook(book.id)}
```

`store.openBook` (defined in §12) sets `view: 'reader'` and `currentBookId: book.id`. The `App.tsx` shell now switches between three views: `library | settings | reader`.

### 11.2 Reading-progress bar (`GeneratedCover.tsx` extension)

`GeneratedCover` already accepts `imageSrc` (Foundation contract). It gains one optional prop:

```tsx
<GeneratedCover
  title={book.title}
  author={book.author}
  imageSrc={book.cover_image_path ?? undefined}
  progress={getProgress(book.current_position)}   // 0..1 or null
/>
```

When `progress` is non-null, render a 2px bar absolutely positioned along the bottom edge of the cover:

```tsx
<div className="absolute inset-x-0 bottom-0 h-[2px] bg-stone-200/40">
  <div
    className="h-full bg-[#C8702C] transition-[width] duration-300 ease-out"
    style={{ width: `${Math.round(progress * 100)}%` }}
  />
</div>
```

Hidden entirely when `current_position` is null. The `transition-[width]` makes progress changes between sessions feel smooth on remount.

`getProgress(json: string | null): number | null` — small helper in `lib/positionProgress.ts`. Parses the JSON, returns `position.fraction`, or `null` on parse error / null input. Called once per tile during `BookTile` render.

### 11.3 Cover crossfade

`GeneratedCover.tsx` is re-rendered when `imageSrc` flips from `undefined` to a path (the auto-extract pass landing). To make that visually a fade rather than a flash, render *both* the SVG and the `<img>` stacked, with the `<img>` fading in over the SVG over 250ms once it's loaded:

```tsx
<div className="relative h-full w-full">
  <GeneratedSvgCover ... />          {/* always rendered */}
  {imageSrc && (
    <img
      src={convertFileSrc(imageSrc)}
      onLoad={(e) => e.currentTarget.classList.add('opacity-100')}
      className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-[250ms]"
    />
  )}
</div>
```

`convertFileSrc` (from `@tauri-apps/api/core`) is the only place we use Tauri's asset protocol — for *displaying* covers, not for reading book content. Cover paths come from our own IPC writer (`save_cover_bytes`), they're scoped to `<app_data_dir>/covers/`, and `<img src>` is the natural way to render them in a browser context. We add `<app_data_dir>/covers/**` to the asset protocol scope in `tauri.conf.json` (read-only).

### 11.4 Library tile under-text (unchanged from Foundation)

```
Title in serif
Author in muted sans
```

The progress is shown visually via the bar; no additional text line.

### 11.5 Pre-existing edit/delete flow

The `EditMetadataModal` and `DeleteBookDialog` flows from Foundation continue to work unchanged. The delete flow now additionally calls `deleteBookFiles(bookId, file_path)` IPC before the DB delete (§5.4). That's a one-line addition to the existing handler.

---

## 12. Store changes

### 12.1 New state shape

```ts
interface AppState {
  // ── Foundation, unchanged ─────────────────────────────
  view: 'library' | 'settings' | 'reader';   // EXTENDED
  books: Book[];
  apiKey: string | null;
  apiKeyBannerDismissed: boolean;

  // ── Phase 2 additions ─────────────────────────────────
  currentBookId: number | null;
  currentBookNotes: NoteRow[];               // notes for currentBook (loaded on open)
  currentBookVocab: VocabRow[];              // vocab for currentBook (loaded on open)
  notesModeActive: boolean;                  // also resets on close
  extractionInFlight: Set<number>;           // in-memory only

  // ── Foundation actions, unchanged ─────────────────────
  setView, loadBooks, insertBook, updateBookMetadata, deleteBook,
  loadApiKey, saveApiKey, dismissApiKeyBanner,

  // ── Phase 2 actions ───────────────────────────────────
  openBook(id: number): Promise<void>;
  closeBook(): void;
  patchBook(id: number, patch: Partial<Book>): void;
  setBookDisplayMode(id: number, mode: 'agent' | 'reader'): Promise<void>;
  setBookCurrentPosition(id: number, position: Position): Promise<void>;
  setBookEpubLocations(id: number, locations: string): Promise<void>;
  setNotesModeActive(active: boolean): void;
  reloadNotesForCurrentBook(): Promise<void>;
  reloadVocabForCurrentBook(): Promise<void>;
  insertNoteForCurrentBook(input: { ... }): Promise<void>;
  insertVocabForCurrentBook(input: { ... }): Promise<void>;
  deleteNote(id: number): Promise<void>;
  deleteVocabulary(id: number): Promise<void>;
  runMetadataExtractionPass(): Promise<void>;
}
```

### 12.2 Action specifics

**`openBook(id)`** —
1. Set `currentBookId = id`, `view = 'reader'`, `notesModeActive = false`.
2. `setLastOpened(db, id)` (fire-and-forget).
3. `reloadNotesForCurrentBook()` and `reloadVocabForCurrentBook()` in parallel.
4. The reader screen handles the `readBookBytes` itself — store doesn't hold the bytes, since they're large and view-scoped.

**`closeBook()`** —
1. Set `currentBookId = null`, `view = 'library'`, `notesModeActive = false`, `currentBookNotes = []`, `currentBookVocab = []`.
2. No DB writes (position is already persisted on every flip via the debounced cadence).

**`patchBook(id, patch)`** —
Pure in-memory: `books = books.map(b => b.id === id ? { ...b, ...patch } : b)`. Used by the auto-extract pass to land partial updates without re-fetching the whole list.

**`setBookCurrentPosition(id, position)`** —
1. Update `books` in-place (so the Library tile's progress bar reflects the new fraction next time we land there).
2. `setCurrentPosition(db, id, position)`.

**`runMetadataExtractionPass()`** — implementation per §6.

### 12.3 Boot sequence (`App.tsx`)

```tsx
useEffect(() => {
  void (async () => {
    await Promise.all([loadApiKey(), loadBooks()]);
    void runMetadataExtractionPass();    // fire-and-forget after books load
  })();
}, []);
```

Pass intentionally fires *after* the initial books load resolves, so users see their library fully populated immediately, then watch covers/authors arrive.

---

## 13. Tests

### 13.1 Two layers, two test runners

- **Vitest** for pure helpers, DB wrappers, the dictionary stub, the extract orchestration logic, and any function exercisable without rendering.
- **Playwright** (new this phase) for library-correctness tests: load a fixture into the actual reader components and drive real interactions against a Chromium that matches what Tauri's webview ships.

### 13.2 Playwright setup

- New dev deps: `@playwright/test`.
- New config: `playwright.config.ts` — runs against `vite preview` (the production build, not `tauri:dev`, since we don't need the Tauri runtime for these tests; mocking the IPC layer at the boundary is enough).
- A small **IPC mock** (`tests/playwright/mocks/ipc.ts`): a script injected into the page that monkey-patches `@tauri-apps/api/core`'s `invoke` to resolve `read_book_bytes` from a fixture file (loaded into the page via Playwright's file-upload primitive or a fetch from a static path), and resolves `save_cover_bytes` / `delete_book_files` to no-ops. Covers any other IPC call the reader makes.
- A small in-memory SQLite shim already exists for unit tests (`better-sqlite3`); Playwright tests use it via the same shim, exposed to the page through a test-only build flag.

```
playwright.config.ts
tests/playwright/
  fixtures/{sample.epub, sample-no-cover.epub, sample.pdf,
            sample-no-author.pdf, cross-page.pdf}
  mocks/{ipc.ts, db.ts}
  epub-reader.spec.ts
  pdf-reader.spec.ts
  notes-mode.spec.ts
  annotations.spec.ts
  dictionary-modal.spec.ts
```

`package.json` adds:

```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui",
"test:all": "vitest run && playwright test"
```

### 13.3 Vitest tests (pure logic + DB)

- `lib/extractMetadata.ts` — orchestration: serial processing, re-entrant skip, swallow-on-failure semantics; mocked extractors and DB.
- `lib/epubExtract.ts` — fixture EPUB → assert title/author/cover paths; trim semantics; cover-missing returns `null` without throwing. jsdom env.
- `lib/pdfExtract.ts` — fixture PDF → assert author parsing; page-1 render produces a non-empty image blob saved through a mocked `saveCoverBytes`. jsdom env.
- `llm/dictionary.ts` — `streamWordDefinition` yields tokens, resolves `done` with full string, `abort()` cuts the stream and rejects `done`.
- `db/notes.ts` — happy path per function (insert, list, delete) against in-memory `better-sqlite3`. CHECK constraint rejects both-null inserts. node env.
- `db/vocabulary.ts` — same pattern.
- `db/books.ts` additions — `setCurrentPosition`, `setDisplayMode`, `setLastOpened`, `setExtractedMetadata`, `setEpubLocations`, `listBooksNeedingExtraction`. node env.
- `lib/positionProgress.ts` — `getProgress` JSON parse → fraction with null/error fallback.
- `lib/positionShape.ts` — `Position`/`QuoteRange` (de)serialization and discriminator inference (quote vs single).
- `lib/pdfRectTransform.ts` — PDF unit-space ↔ viewport-pixel math; pure given a viewport scale.

### 13.4 Playwright tests (library correctness)

Each test mounts the actual `<ReaderScreen>` against a fixture and asserts on real DOM state.

**`epub-reader.spec.ts`:**
- Open `sample.epub`. Verify the rendition mounts and at least one page is visible.
- Press `→` three times. Verify `onPositionChange` was called with monotonically increasing `fraction` values.
- Save a known position (e.g., navigate to page 5), close, reopen. Verify we land back on the same CFI and the same `fraction`.
- Generate Locations index. Verify `book.locations.percentageFromCfi(firstCfi) ≈ 0` and `percentageFromCfi(lastCfi) ≈ 1`. Verify the cached locations string round-trips through `setEpubLocations`/`book.locations.load(json)`.

**`pdf-reader.spec.ts`:**
- Open `sample.pdf`. Verify pages 1 and 2 render (canvas elements present with non-zero dimensions).
- Scroll to page 5. Verify `onPositionChange` fires with `{ type: 'pdf', locator: 5, ... }`.
- Reopen at saved position. Verify we land at page 5.

**`notes-mode.spec.ts`:**
- Activate Notes Mode. Verify quill fills, tint applies.
- Drag-select a known span in EPUB. Verify the draft quote text matches the span. Save. Verify a `notes` row exists with `quote_text` matching and `page_or_position` containing a valid CFI range.
- Same for PDF on a single page.
- Press Esc mid-draft. Verify no row written.
- Save body-only note (no selection). Verify `quote_text === null`, `page_or_position` is a single Position (not a range).

**`annotations.spec.ts`:**
- Pre-seed the test DB with a saved EPUB quote at a known CFI. Open the book. Verify an annotation element with the warm-orange underline color exists at that location.
- Pre-seed a PDF quote on page 1. Open. Scroll to page 1. Verify a `.scholara-quote-underline` div exists with the expected position rects.
- **Cross-page PDF quote:** pre-seed a quote spanning pages 1 and 2 (using `cross-page.pdf`). Open. Scroll to page 1. Verify underline rects on page 1. Scroll to page 2. Verify underline rects on page 2 *and* the final-word subscript appears only on page 2.
- Subscript counts: pre-seed 3 position-only notes on PDF page 4. Verify the subscript shows "3".

**`dictionary-modal.spec.ts`:**
- Select a single word in EPUB. Click "Add to Dictionary" in the toolbar. Verify modal slides in. Verify tokens stream in (assert text content grows over time). On stream completion, verify a `vocabulary` row exists.
- Click modal mid-stream. Verify modal fades, no `vocabulary` row written.
- Multi-word selection: verify "Add to Dictionary" is *not* shown in the toolbar.

### 13.5 Test fixtures

Fixtures live in `tests/fixtures/` (shared between Vitest and Playwright; the Playwright `fixtures/` line in §13.2 is illustrative of test layout, not a duplicate fixture directory — Playwright tests load from `../fixtures/`).

- `tests/fixtures/sample.epub` (under 100KB) — title, creator, cover image, ~6 chapters of Lorem Ipsum.
- `tests/fixtures/sample-no-cover.epub` (~20KB) — same shape, no cover.
- `tests/fixtures/sample.pdf` (under 50KB) — 8 pages, `/Author` info entry, plain text.
- `tests/fixtures/sample-no-author.pdf` — same, no author.
- `tests/fixtures/cross-page.pdf` (under 50KB) — 2 pages where a paragraph wraps across the page boundary, used to exercise cross-page selection.

Total fixture footprint stays under 300KB.

### 13.6 What we still don't test

- The Tauri Rust IPC commands themselves (manual smoke per §14 — the Rust commands are thin wrappers over `std::fs` calls; their failure modes are integration-level).
- Visual regressions (no screenshot comparison this phase).
- Real Anthropic API calls (Phase 3).
- Cross-platform packaging (covered by `npm run tauri:build` smoke at step 24).

### 13.7 CI implication

Phase 2 introduces Playwright; the Foundation `npm test` script becomes `npm run test:all` for full coverage. Phase 2's verification §14 step 1 updates accordingly.

---

## 14. Verification — Phase 2 is "done" when

1. `npm run test:all` passes (Vitest + Playwright; all new tests + Foundation's tests still green).
2. `npm run lint` passes.
3. `npm run tauri:dev` launches into the Library screen as before; tiles render with their generated covers.
4. **Auto-extract on boot:** Foundation-era books visibly transition from generated covers to real covers (where extractable) within a few seconds, with a smooth crossfade. Authors appear under titles where the file had embedded author metadata. Books with no extractable metadata stay with their generated covers — no error, no flicker.
5. **Auto-extract on upload:** uploading a new EPUB shows the tile with its generated cover, then crossfades to the real cover within 1–2 seconds; author appears.
6. **Open EPUB book:** click tile → reader opens in last-saved display mode (default `agent`). Pages render with epub.js's paginated layout. Prev/next arrows and ←/→ keyboard navigate pages. Position persists across navigation; reopening returns to the saved page.
7. **Open PDF book:** click tile → reader opens. Pages render in continuous virtualized scroll. Page indicator updates. Position persists; reopening returns to the saved page.
8. **Mode toggle:** flipping Agent ↔ Full Reader updates the layout immediately and persists `display_mode` (verified by closing and reopening).
9. **Notes Mode (Agent display):** click orange quill → mode activates (quill fills, faint amber tint, input slides in). Selecting text shows the amber highlight and seeds the draft quote. Typing in the input fills the body. Clicking the small save-quill writes to the `notes` table, exits mode, and renders the orange underline + final-word subscript over the quote. Reopening the book shows the annotation persists.
10. **Notes Mode (Full Reader):** same flow; the full-width frosted-glass input replaces the floating logo while active.
11. **Note without quote:** activate Notes Mode, type body only, click save-quill — note row is created with `quote_text = NULL`, `page_or_position` = current position. An orange subscript count appears on that page.
12. **Note discard:** activate Notes Mode, select text, type body, press Esc — no DB row written, all state cleared.
13. **Add to Dictionary:** select a single word with Notes Mode off → SelectionToolbar shows "Add to Dictionary" → click → modal slides down from top, streams the placeholder definition token-by-token, auto-saves on completion. Click modal → fades out. The word appears in the agent panel's Dictionary tab and in the `vocabulary` table.
14. **Add to Dictionary mid-stream dismiss:** trigger modal, click before stream completes → modal fades, no DB write, no `vocabulary` row.
15. **Selection toolbar respects mode:**
    - Notes off, single word → only "Add to Dictionary".
    - Notes off, multi-word → only "Take a note on this".
    - Notes on, multi-word → only "Highlight as Quote".
    - Notes on, single word → only "Highlight as Quote" ("Add to Dictionary" hidden).
16. **Agent panel Notes / Highlights / Dictionary tabs** show the current book's data live, update immediately after a save, and clicking a Notes item jumps the reader to that position.
17. **AI Chat tab** shows the placeholder card — no input, no error.
18. **Floating logo input (Full Reader):** clicking the circle morphs it into the full-width frosted-glass input. Submitting shows the toast "AI features arriving in Phase 3." Esc collapses back to the circle.
19. **Library tile progress:** after reading partway through a book and returning to the Library, the cover shows the orange progress bar at the corresponding fraction. Books never opened show no bar.
20. **Cover image displays correctly across platforms** (asset protocol scope works on macOS, Windows, and Linux for `<app_data_dir>/covers/**`).
21. **Missing-file fallback:** if `book.file_path` is deleted on disk between launches, opening the book shows the "This book's file is missing" screen with a working `← Library` button. Notes and vocab for the book are preserved.
22. **Delete book:** deleting a book removes its `books` row, its file from `<app_data_dir>/books/`, its cover (if any) from `<app_data_dir>/covers/`, and its notes/vocab/conversations rows (cascade).
23. **Cross-page PDF quote:** select text spanning two pages in a PDF, save as quote in Notes Mode → both pages render the orange underline on their respective spans, with the subscript on the final word of the second page.
24. **`npm run tauri:build`** produces an installable bundle. The bundle, on a clean install, completes verification steps 1–23 with no migration errors (the `0002_phase2.sql` migration runs cleanly on a fresh DB and on a Foundation-era DB).

---

## 15. Cross-platform considerations

- **PDF.js Worker setup with Vite.** PDF.js requires a separate Worker script (`pdf.worker.min.mjs`). Vite needs explicit configuration — we use the `?url` import or copy the worker to `public/`. Standard pattern; verified on macOS/Windows/Linux during scaffold.
- **epub.js + Tauri WebView quirks.** epub.js can stumble when injecting per-chapter iframes if the parent's CSP is strict. Tauri 2's default CSP is permissive; we keep it that way during Phase 2 and document any tightening as a Phase-3 task.
- **Asset protocol scope** (for cover thumbnails, §11.3) — `<app_data_dir>/covers/**` added in `tauri.conf.json`. Tauri normalizes path separators per OS.
- **Cover file extensions per OS.** None of `jpg|jpeg|png|webp` cause case-sensitivity issues; we always write lowercase.
- **Selection rect coordinates on hi-DPI screens.** PDF.js handles devicePixelRatio internally for canvas rendering; the text layer is in CSS pixels, so our rect math operates in the same coordinate space as the underline overlay. No DPR division needed in our code.
- **Keyboard shortcuts.** `←` / `→` for page navigation, `Esc` to exit Notes Mode, `n` to toggle Notes Mode. We avoid Cmd/Ctrl combos (no platform branching needed).
- **File path canonicalization.** `read_book_bytes`'s path-traversal guard uses `Path::canonicalize` which resolves symlinks and normalizes separators on every OS.

---

## 16. Open questions / risks

- **PDF.js cross-page selection fragility.** Browser-native selection across PDF.js pages works but the resulting `Range` can have surprising boundaries (e.g., selection includes whitespace between pages). The QuoteRange-from-selection helper has to defensively handle "selection ends in a non-text node" cases. Playwright's `cross-page.pdf` test catches regressions; if we hit something the helper can't handle gracefully in the wild, we may need to constrain selection to the topmost contiguous span.
- **EPUB Locations index generation cost.** For a 500-page novel, generating the locations index can take 1–3 seconds on first open. We do this lazily (on first open of an EPUB) with a small "Indexing for navigation…" indicator that hides on completion. The cached `epub_locations` makes subsequent opens instant.
- **PDF page-1 cover for academic papers.** Page 1 of an academic PDF is often a dense title page that doesn't make a great thumbnail. We accept this as good-enough for Phase 2; users can override via Edit Metadata's existing flow (Foundation supports manual title/author edits but doesn't yet support a manual cover-image upload — that's a Phase-2-or-later question; not in scope this phase).
- **EPUB `coverUrl()` timing.** epub.js resolves `coverUrl()` only after `book.opened` resolves — the extractor awaits `book.ready` first; if a future epub.js version changes this, the extractor breaks silently (cover null, no error). Vitest test catches this with the `sample.epub` fixture.
- **In-memory copy of book bytes.** The reader holds the full ArrayBuffer in JS heap during the session. For a 50MB PDF this is 50MB of JS memory. Modern desktops handle this fine; we'll revisit if reports come in.
- **Race: extraction pass vs. user edit.** If the user opens Edit Metadata on a book *while* the auto-extract pass is processing it, two writes could collide. Mitigation: the extractor uses `setExtractedMetadata` which only sets `metadata_source = 'extracted'`, while Edit Metadata uses `updateMetadata` which sets `metadata_source = 'user'`. Whoever writes last wins, and the `WHERE metadata_source = 'filename'` filter prevents *future* extraction passes from touching the row. Worst case: a 200ms window where the user's edit is overwritten by the extractor. We document this as known-and-accepted; a "lock" mechanism is overkill.
- **Tauri 2 IPC byte-transfer cost for large PDFs.** The 50MB-PDF case may take 1–2 seconds to transfer over IPC. If users complain, B-mode (asset protocol for book content) is the documented fallback. The `ReaderLeafProps` would just gain a `Source = { type: 'bytes' } | { type: 'url' }` discriminator without breaking call sites.
- **Playwright + Tauri webview parity.** Playwright runs against Chromium, Tauri uses the OS's WebView2 (Windows) / WebKit (macOS) / WebKitGTK (Linux). 95% of the time they behave identically. The 5% — usually CSS or selection edge cases — won't be caught by Playwright. Manual smoke per §14 covers Tauri-specific surprises.
- **Existing `BookTile` toast.** Foundation's "Reader coming in the next phase." toast disappears in Phase 2 — replaced by `store.openBook(book.id)`.

---

## 17. Known follow-ups for later phases

- **Phase 3 (AI):** swap `streamWordDefinition` body for a real Anthropic call via LangChain; populate AI Chat tab; wire Full Reader floating input to streaming response in top 30%; add spoiler-aware RAG (uses the `fraction` field from `current_position`); add offline-detection and toast.
- **Phase 4 (Animations & Strip):** WebGL brain animation in `<BrainPlaceholder />`; circularly scrolling vocab/notes/quotes strip in `<ScrollStripPlaceholder />` (uses `last_opened` for ordering); Global Dictionary & Notes modal (uses `listAllVocabulary`).
- **Manual cover-image upload** in Edit Metadata, for cases where the auto-extracted page-1 cover is unsatisfying.
- **Asset-protocol B-mode** for book content if A-mode IPC bytes prove slow on large PDFs.
- **CSP tightening** review (currently permissive Tauri 2 default).
