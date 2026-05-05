# Reader (Phase 2) Implementation Plan

**Goal:** Land Scholara's Phase 2 — open uploaded PDFs/EPUBs in a working reader with two persisted display modes, take notes with quote selection and orange annotations, ship a Dictionary modal shell driven by a stub stream, backfill `author` + `cover_image_path` for filename-only books, and add a reading-progress bar to library tiles.

**Architecture:** Two reader leaf components (`PdfReader`, `EpubReader`) sharing a `ReaderLeafProps` contract, mounted under either an Agent Display (80/20 split) or a Full Reader Display. All file I/O goes through three new Rust IPC commands (`read_book_bytes`, `save_cover_bytes`, `delete_book_files`). A unified discriminated `Position` type (`{ type: 'pdf' | 'epub', locator, fraction, label }`) is persisted as JSON in `books.current_position` and `notes.page_or_position`. Auto-extract pass (boot + post-upload) populates real metadata via PDF.js and epub.js. A swappable `streamWordDefinition(word) → DefinitionStream` stub powers the Dictionary modal so Phase 3 can replace its body without touching call sites.

**Tech Stack:** Tauri 2, React 19, TypeScript 5.8, Tailwind 3, shadcn/ui (Base UI primitives), Zustand 5, SQLite (`tauri-plugin-sql`), framer-motion 12, **new:** `pdfjs-dist`, `epubjs`, `@playwright/test`. Vitest stays for unit/DB tests; Playwright joins for library-correctness tests against `vite preview`.

**Reference spec:** `docs/superpowers/specs/2026-05-05-reader-design.md` (sections cited as `§N`).

---

## Conventions (read once, applies to every task)

- **Light mode only.** Never add dark variants. shadcn/ui + Tailwind classes only.
- **Module boundaries:** components → store → db/ + ipc/ → Tauri. Components NEVER import `@tauri-apps/api/*` directly. The single exception is `convertFileSrc` in `GeneratedCover.tsx` (§11.3, Task 25).
- **All FS through Rust IPC.** No `@tauri-apps/plugin-fs`.
- **DB writes** take `SqlExecutor` as the first parameter (matches Foundation pattern in [src/db/books.ts](src/db/books.ts)).
- **DB tests** must start with `// @vitest-environment node` (better-sqlite3 needs node, not jsdom). See [tests/db/books.test.ts](tests/db/books.test.ts) for the existing pattern.
- **Tests are TDD-friendly but pragmatic:** write tests for pure helpers, DB functions, the dictionary stub, and orchestration logic before implementation. Reader leaf components and visual flows are covered by Playwright (Tasks 31–35), not Vitest (jsdom can't render PDF.js or epub.js convincingly).
- **Commit cadence:** at least one commit per task (commit when the task is green: types compile, relevant tests pass). Use the conventional `Phase 2: <task short title>` style.
- **Orange palette constant:** `#C8702C` (warm sepia-orange). Used everywhere — annotation underlines, progress bar, subscript counts, save-quill icon. Define once in `src/lib/theme.ts` (Task 5).
- **The orange quill toggle keyboard shortcut is `n`.** Esc exits Notes Mode. `←`/`→` page EPUBs. `Space`/`Shift+Space` page PDFs. `Home`/`End` jump to first/last PDF page.
- **Position JSON shape — always `JSON.stringify` before writing, `JSON.parse` on read.** See `src/lib/positionShape.ts` (Task 6) for serialization helpers.

---

## File Structure (what each new file owns)

```
src/
├── lib/
│   ├── theme.ts                       # ORANGE = '#C8702C'; subscript styles
│   ├── positionShape.ts               # Position/QuoteRange types + helpers
│   ├── positionProgress.ts            # getProgress(json) → 0..1 | null
│   ├── pdfRectTransform.ts            # PDF unit-space ↔ viewport-pixel math
│   ├── extractMetadata.ts             # background-pass orchestration
│   ├── epubExtract.ts                 # epub.js metadata + cover extraction
│   ├── pdfExtract.ts                  # PDF.js metadata + page-1 cover render
│   └── pdfWorker.ts                   # PDF.js worker setup (one-time)
├── llm/
│   └── dictionary.ts                  # streamWordDefinition stub + types
├── ipc/
│   └── files.ts                       # ADD: readBookBytes, saveCoverBytes, deleteBookFiles
├── db/
│   ├── books.ts                       # ADD setters + listBooksNeedingExtraction
│   ├── notes.ts                       # IMPLEMENT: list/insert/delete
│   └── vocabulary.ts                  # IMPLEMENT: list/insert/delete
├── screens/Reader/
│   ├── index.tsx                      # ReaderScreen — mode + leaf dispatch
│   ├── AgentDisplay.tsx               # 80/20 shell
│   ├── FullReaderDisplay.tsx          # full-screen shell
│   ├── EpubReader.tsx                 # epub.js leaf
│   ├── PdfReader.tsx                  # PDF.js leaf
│   ├── ReaderChrome.tsx               # back link, mode toggle, quill
│   ├── ModeToggle.tsx                 # segmented agent/reader control
│   ├── NotesModeInput.tsx             # body input + save-quill
│   ├── FloatingLogoInput.tsx          # full-reader bottom-center morphing input
│   ├── DictionaryModal.tsx            # top-of-screen, driven by stream
│   ├── SelectionToolbar.tsx           # Add to Dictionary / Highlight / Take note
│   ├── MissingFileScreen.tsx          # fallback
│   ├── annotations/
│   │   ├── EpubAnnotations.ts         # epub.js underline + final-word <sup>
│   │   └── PdfAnnotations.ts          # rect-overlay underline + <sup>
│   └── agentPanel/
│       ├── AgentPanel.tsx             # tab container
│       ├── AiChatTab.tsx              # placeholder card
│       ├── NotesTab.tsx               # listNotesForBook list
│       ├── HighlightsTab.tsx          # quote-bearing notes only
│       └── DictionaryTab.tsx          # listVocabularyForBook list
└── store.ts                           # extend with reader state + actions

src-tauri/
├── migrations/
│   └── 0002_phase2.sql                # ALTER TABLE books ADD COLUMN epub_locations TEXT
└── src/commands/
    └── books.rs                       # ADD: read_book_bytes, save_cover_bytes, delete_book_files

tests/
├── db/
│   ├── books-phase2.test.ts           # new books.ts setters
│   ├── notes.test.ts
│   └── vocabulary.test.ts
├── lib/
│   ├── positionShape.test.ts
│   ├── positionProgress.test.ts
│   ├── pdfRectTransform.test.ts
│   ├── extractMetadata.test.ts
│   ├── epubExtract.test.ts
│   └── pdfExtract.test.ts
├── llm/
│   └── dictionary.test.ts
├── fixtures/
│   ├── sample.epub
│   ├── sample-no-cover.epub
│   ├── sample.pdf
│   ├── sample-no-author.pdf
│   └── cross-page.pdf
└── playwright/
    ├── mocks/
    │   ├── ipc.ts
    │   └── db.ts
    ├── epub-reader.spec.ts
    ├── pdf-reader.spec.ts
    ├── notes-mode.spec.ts
    ├── annotations.spec.ts
    └── dictionary-modal.spec.ts
playwright.config.ts
```

---

## Tasks

Each task lists **files**, **steps**, **code** (where applicable), **test/verify**, and **commit**.

---

### Task 1 — Install runtime dependencies

**Files:** `package.json` (no manual edit; use `npm install`).

**Steps:**

```bash
npm install pdfjs-dist@^4.7.76 epubjs@^0.3.93
npm install -D @playwright/test@^1.48.0
npx playwright install chromium
```

Pin versions so reproducible. epub.js 0.3.93 is the actively maintained line on npm; pdfjs-dist 4.x exports ESM and works with Vite 7.

**Verify:**
```bash
npm ls pdfjs-dist epubjs @playwright/test
```
All three should print without "missing" or "invalid". `npm run build` must still pass.

**Commit:** `Phase 2: install pdfjs-dist, epubjs, playwright`

---

### Task 2 — PDF.js worker bootstrap

**Why:** PDF.js needs an off-thread worker. Vite must serve it as a real URL. Setting it once at module load avoids per-call configuration.

**Files:** `src/lib/pdfWorker.ts` (new).

**Code:**

```ts
import { GlobalWorkerOptions } from 'pdfjs-dist';
// Vite transforms `?url` into a static asset URL at build time.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let initialised = false;

export function initPdfWorker(): void {
  if (initialised) return;
  GlobalWorkerOptions.workerSrc = workerUrl;
  initialised = true;
}
```

**Caller convention:** every module that imports `pdfjs-dist` (i.e., `pdfExtract.ts` and `PdfReader.tsx`) calls `initPdfWorker()` before its first PDF.js call. Idempotent.

**Verify:** No standalone test. Verified indirectly by Tasks 16 and 32.

**Commit:** `Phase 2: PDF.js worker bootstrap`

---

### Task 3 — Schema migration `0002_phase2.sql` + Rust registration

**Files:**
- `src-tauri/migrations/0002_phase2.sql` (new)
- `src-tauri/src/lib.rs` (modify migrations vec)
- `tests/helpers/sqlite.ts` (apply both migrations to in-memory DB)

**`src-tauri/migrations/0002_phase2.sql`:**

```sql
ALTER TABLE books ADD COLUMN epub_locations TEXT;
```

**`src-tauri/src/lib.rs` — extend the migrations vec:**

```rust
let migrations = vec![
    Migration {
        version: 1,
        description: "init schema",
        sql: include_str!("../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    },
    Migration {
        version: 2,
        description: "phase 2: epub_locations",
        sql: include_str!("../migrations/0002_phase2.sql"),
        kind: MigrationKind::Up,
    },
];
```

**`tests/helpers/sqlite.ts` — replace the single migration apply with both:**

```ts
// @vitest-environment node
import BetterSqlite3 from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SqlExecutor } from '../../src/db/types';

const MIGRATIONS = [
  '0001_init.sql',
  '0002_phase2.sql',
].map((f) => path.resolve(__dirname, '../../src-tauri/migrations', f));

export function makeTestDb(): SqlExecutor {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  for (const mig of MIGRATIONS) {
    db.exec(readFileSync(mig, 'utf-8'));
  }

  return {
    async execute(sqlStr, params = []) {
      const stmt = db.prepare(sqlStr);
      const info = stmt.run(...(params as unknown[]));
      return {
        lastInsertId: Number(info.lastInsertRowid),
        rowsAffected: info.changes,
      };
    },
    async select<T>(sqlStr: string, params: unknown[] = []) {
      const stmt = db.prepare(sqlStr);
      return stmt.all(...(params as unknown[])) as T[];
    },
  };
}
```

**Verify:**
```bash
npm test -- tests/db/books.test.ts
```
Existing Foundation DB test still passes (the ALTER adds a nullable column; existing reads still work). Then:
```bash
npm run tauri:dev
```
On launch, the migration runs against an existing DB without errors (check the dev console for SQL exceptions).

**Commit:** `Phase 2: 0002 migration adds books.epub_locations`

---

### Task 4 — Extend `db/types.ts` with `Book.epub_locations` field

**File:** `src/db/types.ts`.

**Edit:** Add `epub_locations: string | null;` to the `Book` interface.

```ts
export interface Book {
  id: number;
  title: string;
  author: string | null;
  cover_image_path: string | null;
  file_path: string;
  file_type: FileType;
  last_opened: string | null;
  current_position: string | null;
  display_mode: DisplayMode;
  metadata_source: MetadataSource;
  epub_locations: string | null;     // NEW (Phase 2)
  created_at: string;
}
```

Also update `db/books.ts`'s `listBooks` SELECT to include the new column:

```ts
return db.select<Book>(
  `SELECT id, title, author, cover_image_path, file_path, file_type,
          last_opened, current_position, display_mode, metadata_source,
          epub_locations, created_at
   FROM books
   ORDER BY datetime(created_at) DESC, id DESC`,
);
```

**Verify:** `npm run build` (TS compile) passes. Existing `tests/db/books.test.ts` still passes.

**Commit:** `Phase 2: Book.epub_locations field`

---

### Task 5 — `lib/theme.ts` orange palette constants

**File:** `src/lib/theme.ts` (new).

**Code:**

```ts
export const ORANGE = '#C8702C';

export const ANNOTATION_UNDERLINE_PX = 1.5;

export const SUBSCRIPT_INLINE_STYLE = {
  fontSize: '0.55em',
  verticalAlign: 'sub',
  color: ORANGE,
  fontWeight: 600,
} as const;
```

**Tailwind convenience:** add `accent-orange: #C8702C` to `tailwind.config.ts` under `theme.extend.colors` if not already present, so we can use `bg-accent-orange` / `text-accent-orange`. Read the existing config first; add only if absent.

**Verify:** `npm run build` passes. No tests yet — used by Tasks 14, 25 onward.

**Commit:** `Phase 2: theme constants for orange palette`

---

### Task 6 — Position types and (de)serialization (`lib/positionShape.ts`)

**Files:** `src/lib/positionShape.ts` (new), `tests/lib/positionShape.test.ts` (new — TDD: write first).

**Test first** (`tests/lib/positionShape.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import {
  serializePosition,
  deserializePosition,
  serializeQuoteRange,
  deserializeQuoteRange,
  isQuoteRange,
} from '../../src/lib/positionShape';
import type { Position, EpubQuoteRange, PdfQuoteRange } from '../../src/lib/positionShape';

describe('positionShape', () => {
  it('round-trips a PDF Position', () => {
    const p: Position = { type: 'pdf', locator: 5, fraction: 0.25, label: 'Page 5' };
    expect(deserializePosition(serializePosition(p))).toEqual(p);
  });

  it('round-trips an EPUB Position', () => {
    const p: Position = {
      type: 'epub',
      locator: 'epubcfi(/6/4!/4/2/2)',
      fraction: 0.4,
      label: 'Chapter 3',
    };
    expect(deserializePosition(serializePosition(p))).toEqual(p);
  });

  it('round-trips an EPUB QuoteRange', () => {
    const r: EpubQuoteRange = {
      start: { type: 'epub', locator: 'cfiA', fraction: 0.1, label: 'Ch 1' },
      end:   { type: 'epub', locator: 'cfiB', fraction: 0.11, label: 'Ch 1' },
    };
    expect(deserializeQuoteRange(serializeQuoteRange(r))).toEqual(r);
  });

  it('round-trips a PDF QuoteRange with rects', () => {
    const r: PdfQuoteRange = {
      start: { type: 'pdf', locator: 1, fraction: 0.1, label: 'Page 1' },
      end:   { type: 'pdf', locator: 2, fraction: 0.2, label: 'Page 2' },
      pages: [
        { page: 1, rects: [{ x: 10, y: 20, w: 100, h: 12 }] },
        { page: 2, rects: [{ x: 10, y: 30, w: 80,  h: 12 }] },
      ],
    };
    expect(deserializeQuoteRange(serializeQuoteRange(r))).toEqual(r);
  });

  it('isQuoteRange detects a range vs a single position', () => {
    const range = { start: { type: 'pdf', locator: 1, fraction: 0, label: 'Page 1' },
                    end:   { type: 'pdf', locator: 1, fraction: 0, label: 'Page 1' } };
    const single = { type: 'pdf', locator: 1, fraction: 0, label: 'Page 1' };
    expect(isQuoteRange(range)).toBe(true);
    expect(isQuoteRange(single)).toBe(false);
  });
});
```

**Implementation** (`src/lib/positionShape.ts`):

```ts
export type Position =
  | { type: 'pdf';  locator: number; fraction: number; label: string }
  | { type: 'epub'; locator: string; fraction: number; label: string };

export interface EpubQuoteRange {
  start: Extract<Position, { type: 'epub' }>;
  end:   Extract<Position, { type: 'epub' }>;
}

export interface PdfQuoteRange {
  start: Extract<Position, { type: 'pdf' }>;
  end:   Extract<Position, { type: 'pdf' }>;
  pages: Array<{
    page: number;
    rects: Array<{ x: number; y: number; w: number; h: number }>;
  }>;
}

export type QuoteRange = EpubQuoteRange | PdfQuoteRange;

export function serializePosition(p: Position): string {
  return JSON.stringify(p);
}

export function deserializePosition(json: string): Position {
  return JSON.parse(json) as Position;
}

export function serializeQuoteRange(r: QuoteRange): string {
  return JSON.stringify(r);
}

export function deserializeQuoteRange(json: string): QuoteRange {
  return JSON.parse(json) as QuoteRange;
}

/** True if the parsed JSON is a QuoteRange (has start+end), false if a single Position. */
export function isQuoteRange(parsed: unknown): parsed is QuoteRange {
  return typeof parsed === 'object'
      && parsed !== null
      && 'start' in parsed
      && 'end' in parsed;
}
```

**Verify:** `npm test -- positionShape` — all 5 cases pass.

**Commit:** `Phase 2: Position/QuoteRange types and serialization`

---

### Task 7 — `lib/positionProgress.ts` for library tile progress bar

**Files:** `src/lib/positionProgress.ts` (new), `tests/lib/positionProgress.test.ts` (new).

**Test first:**

```ts
import { describe, it, expect } from 'vitest';
import { getProgress } from '../../src/lib/positionProgress';

describe('getProgress', () => {
  it('returns null for null input', () => {
    expect(getProgress(null)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(getProgress('not-json')).toBeNull();
  });

  it('returns null for parsed object without fraction', () => {
    expect(getProgress(JSON.stringify({ type: 'pdf', locator: 1, label: 'Page 1' }))).toBeNull();
  });

  it('returns the fraction from a Position', () => {
    expect(getProgress(JSON.stringify({
      type: 'pdf', locator: 5, fraction: 0.42, label: 'Page 5',
    }))).toBe(0.42);
  });

  it('returns the end.fraction from a QuoteRange', () => {
    expect(getProgress(JSON.stringify({
      start: { type: 'pdf', locator: 1, fraction: 0.05, label: 'Page 1' },
      end:   { type: 'pdf', locator: 2, fraction: 0.10, label: 'Page 2' },
    }))).toBe(0.10);
  });

  it('clamps to [0,1]', () => {
    expect(getProgress(JSON.stringify({
      type: 'pdf', locator: 1, fraction: -0.2, label: 'Page 1',
    }))).toBe(0);
    expect(getProgress(JSON.stringify({
      type: 'pdf', locator: 999, fraction: 1.7, label: 'Page 999',
    }))).toBe(1);
  });
});
```

**Implementation:**

```ts
export function getProgress(json: string | null): number | null {
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  let fraction: unknown;
  if (typeof parsed === 'object' && parsed !== null) {
    if ('end' in parsed && typeof (parsed as { end?: unknown }).end === 'object') {
      fraction = ((parsed as { end: { fraction?: unknown } }).end).fraction;
    } else {
      fraction = (parsed as { fraction?: unknown }).fraction;
    }
  }
  if (typeof fraction !== 'number' || Number.isNaN(fraction)) return null;
  return Math.max(0, Math.min(1, fraction));
}
```

`books.current_position` is always a single Position (never a QuoteRange — the QuoteRange shape is only in `notes.page_or_position`). The `end.fraction` branch is defensive insurance against a future shape change.

**Verify:** `npm test -- positionProgress` — all 6 cases pass.

**Commit:** `Phase 2: getProgress helper for library tiles`

---

### Task 8 — `lib/pdfRectTransform.ts` PDF unit-space ↔ viewport math

**Files:** `src/lib/pdfRectTransform.ts` (new), `tests/lib/pdfRectTransform.test.ts` (new).

**Test first:**

```ts
import { describe, it, expect } from 'vitest';
import { viewportRectToPdfRect, pdfRectToViewportRect } from '../../src/lib/pdfRectTransform';

interface MockViewport {
  scale: number;
  height: number;
  convertToViewportPoint(x: number, y: number): [number, number];
  convertToPdfPoint(x: number, y: number): [number, number];
}

function makeViewport(scale: number, pageHeightPdfPts: number): MockViewport {
  // PDF coords: origin bottom-left, +y up.
  // Viewport coords: origin top-left, +y down.
  // y_view = (pageHeight - y_pdf) * scale; x_view = x_pdf * scale.
  return {
    scale,
    height: pageHeightPdfPts * scale,
    convertToViewportPoint: (x, y) => [x * scale, (pageHeightPdfPts - y) * scale],
    convertToPdfPoint: (x, y) => [x / scale, pageHeightPdfPts - y / scale],
  };
}

describe('pdfRectTransform', () => {
  it('viewportRectToPdfRect inverts pdfRectToViewportRect', () => {
    const vp = makeViewport(2, 800);  // scale=2, page=800pt tall
    const pdf = { x: 100, y: 200, w: 50, h: 12 };
    const view = pdfRectToViewportRect(pdf, vp);
    expect(viewportRectToPdfRect(view, vp)).toEqual(pdf);
  });

  it('pdfRectToViewportRect: scale=1 page=600pt, rect at (10, 100, 50w, 12h)', () => {
    const vp = makeViewport(1, 600);
    // top in viewport = (600 - (100+12)) * 1 = 488
    expect(pdfRectToViewportRect({ x: 10, y: 100, w: 50, h: 12 }, vp))
      .toEqual({ x: 10, y: 488, w: 50, h: 12 });
  });
});
```

**Implementation:**

```ts
export interface ViewportLike {
  scale: number;
  convertToViewportPoint(x: number, y: number): number[];   // [x, y]
  convertToPdfPoint(x: number, y: number): number[];        // [x, y]
}

export interface PdfRect    { x: number; y: number; w: number; h: number }
export interface ViewRect   { x: number; y: number; w: number; h: number }

/** PDF-space rect (origin bottom-left) → viewport-pixel rect (origin top-left). */
export function pdfRectToViewportRect(r: PdfRect, vp: ViewportLike): ViewRect {
  const [x, yTop] = vp.convertToViewportPoint(r.x, r.y + r.h);
  return { x, y: yTop, w: r.w * vp.scale, h: r.h * vp.scale };
}

/** Viewport-pixel rect → PDF-space rect (used when capturing user selection). */
export function viewportRectToPdfRect(r: ViewRect, vp: ViewportLike): PdfRect {
  const [xPdf, yPdfTop] = vp.convertToPdfPoint(r.x, r.y);
  const wPdf = r.w / vp.scale;
  const hPdf = r.h / vp.scale;
  return { x: xPdf, y: yPdfTop - hPdf, w: wPdf, h: hPdf };
}
```

**Verify:** `npm test -- pdfRectTransform` — both cases pass.

**Commit:** `Phase 2: pdfRectTransform helpers`

---

### Task 9 — `db/notes.ts` implementation + tests

**Files:** `src/db/notes.ts` (replace stub), `tests/db/notes.test.ts` (new).

**Test first** (`tests/db/notes.test.ts`):

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../helpers/sqlite';
import * as booksDb from '../../src/db/books';
import * as notesDb from '../../src/db/notes';
import type { SqlExecutor } from '../../src/db/types';

let db: SqlExecutor;
let bookId: number;

beforeEach(async () => {
  db = makeTestDb();
  bookId = await booksDb.insertBook(db, {
    title: 'Test', author: null, file_path: '/p.epub', file_type: 'epub',
  });
});

describe('notes', () => {
  it('insertNote + listNotesForBook returns the row', async () => {
    const id = await notesDb.insertNote(db, {
      book_id: bookId,
      page_or_position: '{"type":"pdf","locator":1,"fraction":0,"label":"Page 1"}',
      note_text: 'hello',
      quote_text: null,
    });
    expect(id).toBeGreaterThan(0);
    const rows = await notesDb.listNotesForBook(db, bookId);
    expect(rows).toHaveLength(1);
    expect(rows[0].note_text).toBe('hello');
    expect(rows[0].quote_text).toBeNull();
  });

  it('insertNote rejects when both note_text and quote_text are null', async () => {
    await expect(
      notesDb.insertNote(db, {
        book_id: bookId,
        page_or_position: '{}',
        note_text: null,
        quote_text: null,
      }),
    ).rejects.toThrow();
  });

  it('listNotesForBook orders by created_at ASC then id ASC', async () => {
    await notesDb.insertNote(db, {
      book_id: bookId, page_or_position: '{}', note_text: 'a', quote_text: null,
    });
    await notesDb.insertNote(db, {
      book_id: bookId, page_or_position: '{}', note_text: 'b', quote_text: null,
    });
    const rows = await notesDb.listNotesForBook(db, bookId);
    expect(rows.map((r) => r.note_text)).toEqual(['a', 'b']);
  });

  it('deleteNote removes the row', async () => {
    const id = await notesDb.insertNote(db, {
      book_id: bookId, page_or_position: '{}', note_text: 'x', quote_text: null,
    });
    await notesDb.deleteNote(db, id);
    expect(await notesDb.listNotesForBook(db, bookId)).toHaveLength(0);
  });
});
```

**Implementation** (`src/db/notes.ts`):

```ts
import type { NoteRow, SqlExecutor } from './types';

export type { NoteRow };

export interface InsertNoteInput {
  book_id: number;
  page_or_position: string;
  note_text: string | null;
  quote_text: string | null;
}

export async function listNotesForBook(
  db: SqlExecutor,
  bookId: number,
): Promise<NoteRow[]> {
  return db.select<NoteRow>(
    `SELECT id, book_id, page_or_position, note_text, quote_text, created_at
     FROM notes
     WHERE book_id = ?
     ORDER BY datetime(created_at) ASC, id ASC`,
    [bookId],
  );
}

export async function insertNote(
  db: SqlExecutor,
  input: InsertNoteInput,
): Promise<number> {
  const result = await db.execute(
    `INSERT INTO notes (book_id, page_or_position, note_text, quote_text)
     VALUES (?, ?, ?, ?)`,
    [input.book_id, input.page_or_position, input.note_text, input.quote_text],
  );
  return result.lastInsertId;
}

export async function deleteNote(db: SqlExecutor, id: number): Promise<void> {
  await db.execute(`DELETE FROM notes WHERE id = ?`, [id]);
}
```

**Verify:** `npm test -- tests/db/notes` — all 4 cases pass.

**Commit:** `Phase 2: db/notes implementation`

---

### Task 10 — `db/vocabulary.ts` implementation + tests

**Files:** `src/db/vocabulary.ts` (replace stub), `tests/db/vocabulary.test.ts` (new).

**Test first:**

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../helpers/sqlite';
import * as booksDb from '../../src/db/books';
import * as vocabDb from '../../src/db/vocabulary';
import type { SqlExecutor } from '../../src/db/types';

let db: SqlExecutor;
let bookId: number;

beforeEach(async () => {
  db = makeTestDb();
  bookId = await booksDb.insertBook(db, {
    title: 'Test', author: null, file_path: '/p.epub', file_type: 'epub',
  });
});

describe('vocabulary', () => {
  it('insertVocabulary + listVocabularyForBook', async () => {
    await vocabDb.insertVocabulary(db, {
      word: 'serendipity', definition: 'happy chance', book_id: bookId,
    });
    const rows = await vocabDb.listVocabularyForBook(db, bookId);
    expect(rows).toHaveLength(1);
    expect(rows[0].word).toBe('serendipity');
  });

  it('listVocabularyForBook orders by created_at DESC', async () => {
    await vocabDb.insertVocabulary(db, { word: 'a', definition: 'x', book_id: bookId });
    await vocabDb.insertVocabulary(db, { word: 'b', definition: 'y', book_id: bookId });
    const rows = await vocabDb.listVocabularyForBook(db, bookId);
    expect(rows.map((r) => r.word)).toEqual(['b', 'a']);
  });

  it('listAllVocabulary across books', async () => {
    const otherId = await booksDb.insertBook(db, {
      title: 'Other', author: null, file_path: '/q.pdf', file_type: 'pdf',
    });
    await vocabDb.insertVocabulary(db, { word: 'x', definition: '1', book_id: bookId });
    await vocabDb.insertVocabulary(db, { word: 'y', definition: '2', book_id: otherId });
    const all = await vocabDb.listAllVocabulary(db);
    expect(all).toHaveLength(2);
  });

  it('deleteVocabulary removes the row', async () => {
    const id = await vocabDb.insertVocabulary(db, {
      word: 'x', definition: 'y', book_id: bookId,
    });
    await vocabDb.deleteVocabulary(db, id);
    expect(await vocabDb.listVocabularyForBook(db, bookId)).toHaveLength(0);
  });
});
```

**Implementation:**

```ts
import type { VocabRow, SqlExecutor } from './types';

export type { VocabRow };

export interface InsertVocabInput {
  word: string;
  definition: string;
  book_id: number;
}

export async function listVocabularyForBook(
  db: SqlExecutor,
  bookId: number,
): Promise<VocabRow[]> {
  return db.select<VocabRow>(
    `SELECT id, word, definition, book_id, created_at
     FROM vocabulary
     WHERE book_id = ?
     ORDER BY datetime(created_at) DESC, id DESC`,
    [bookId],
  );
}

export async function listAllVocabulary(
  db: SqlExecutor,
): Promise<VocabRow[]> {
  return db.select<VocabRow>(
    `SELECT id, word, definition, book_id, created_at
     FROM vocabulary
     ORDER BY datetime(created_at) DESC, id DESC`,
  );
}

export async function insertVocabulary(
  db: SqlExecutor,
  input: InsertVocabInput,
): Promise<number> {
  const result = await db.execute(
    `INSERT INTO vocabulary (word, definition, book_id) VALUES (?, ?, ?)`,
    [input.word, input.definition, input.book_id],
  );
  return result.lastInsertId;
}

export async function deleteVocabulary(
  db: SqlExecutor,
  id: number,
): Promise<void> {
  await db.execute(`DELETE FROM vocabulary WHERE id = ?`, [id]);
}
```

**`returns lastInsertId`:** the test for "ordering" calls `insertVocabulary` twice, then asserts `b` is first. `created_at` defaults to `datetime('now')` (second precision); the secondary `id DESC` tiebreaker keeps tests stable.

**Verify:** `npm test -- tests/db/vocabulary` — all 4 cases pass.

**Commit:** `Phase 2: db/vocabulary implementation`

---

### Task 11 — `db/books.ts` Phase-2 setters + `listBooksNeedingExtraction`

**Files:** `src/db/books.ts` (extend), `tests/db/books-phase2.test.ts` (new).

**Test first:**

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../helpers/sqlite';
import * as booksDb from '../../src/db/books';
import type { SqlExecutor } from '../../src/db/types';

let db: SqlExecutor;
let bookId: number;

beforeEach(async () => {
  db = makeTestDb();
  bookId = await booksDb.insertBook(db, {
    title: 'T', author: null, file_path: '/p.epub', file_type: 'epub',
  });
});

describe('books phase 2 setters', () => {
  it('setCurrentPosition serializes JSON to current_position', async () => {
    await booksDb.setCurrentPosition(db, bookId, {
      type: 'epub', locator: 'cfi', fraction: 0.3, label: 'Ch 2',
    });
    const [b] = await booksDb.listBooks(db);
    expect(JSON.parse(b.current_position!).fraction).toBe(0.3);
  });

  it('setDisplayMode flips the column', async () => {
    await booksDb.setDisplayMode(db, bookId, 'reader');
    const [b] = await booksDb.listBooks(db);
    expect(b.display_mode).toBe('reader');
  });

  it('setLastOpened writes a non-null datetime string', async () => {
    await booksDb.setLastOpened(db, bookId);
    const [b] = await booksDb.listBooks(db);
    expect(b.last_opened).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('setEpubLocations stores the locations string', async () => {
    await booksDb.setEpubLocations(db, bookId, '["a","b","c"]');
    const [b] = await booksDb.listBooks(db);
    expect(b.epub_locations).toBe('["a","b","c"]');
  });

  it('setExtractedMetadata stamps metadata_source = extracted', async () => {
    await booksDb.setExtractedMetadata(db, bookId, {
      author: 'A', cover_image_path: '/covers/1.png',
    });
    const [b] = await booksDb.listBooks(db);
    expect(b.author).toBe('A');
    expect(b.cover_image_path).toBe('/covers/1.png');
    expect(b.metadata_source).toBe('extracted');
  });

  it('setExtractedMetadata applies title only when present in patch', async () => {
    await booksDb.setExtractedMetadata(db, bookId, { author: 'A' });
    let [b] = await booksDb.listBooks(db);
    expect(b.title).toBe('T');                   // unchanged
    await booksDb.setExtractedMetadata(db, bookId, { title: 'New', author: 'A' });
    [b] = await booksDb.listBooks(db);
    expect(b.title).toBe('New');
  });

  it('listBooksNeedingExtraction returns only filename-source rows', async () => {
    const extractedId = await booksDb.insertBook(db, {
      title: 'X', author: null, file_path: '/x.pdf', file_type: 'pdf',
    });
    await booksDb.setExtractedMetadata(db, extractedId, { author: 'A' });
    const rows = await booksDb.listBooksNeedingExtraction(db);
    expect(rows.map((r) => r.id)).toEqual([bookId]);
  });
});
```

**Implementation — append to `src/db/books.ts`:**

```ts
import type { Position } from '../lib/positionShape';

export async function setCurrentPosition(
  db: SqlExecutor,
  id: number,
  position: Position,
): Promise<void> {
  await db.execute(
    `UPDATE books SET current_position = ? WHERE id = ?`,
    [JSON.stringify(position), id],
  );
}

export async function setDisplayMode(
  db: SqlExecutor,
  id: number,
  mode: 'agent' | 'reader',
): Promise<void> {
  await db.execute(
    `UPDATE books SET display_mode = ? WHERE id = ?`,
    [mode, id],
  );
}

export async function setLastOpened(
  db: SqlExecutor,
  id: number,
): Promise<void> {
  await db.execute(
    `UPDATE books SET last_opened = datetime('now') WHERE id = ?`,
    [id],
  );
}

export async function setEpubLocations(
  db: SqlExecutor,
  id: number,
  locations: string,
): Promise<void> {
  await db.execute(
    `UPDATE books SET epub_locations = ? WHERE id = ?`,
    [locations, id],
  );
}

export interface ExtractedMetadataPatch {
  title?: string;
  author?: string | null;
  cover_image_path?: string | null;
}

export async function setExtractedMetadata(
  db: SqlExecutor,
  id: number,
  patch: ExtractedMetadataPatch,
): Promise<void> {
  const sets: string[] = [`metadata_source = 'extracted'`];
  const params: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    params.push(patch.title);
  }
  if (patch.author !== undefined) {
    sets.push('author = ?');
    params.push(patch.author);
  }
  if (patch.cover_image_path !== undefined) {
    sets.push('cover_image_path = ?');
    params.push(patch.cover_image_path);
  }
  params.push(id);
  await db.execute(`UPDATE books SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function listBooksNeedingExtraction(
  db: SqlExecutor,
): Promise<Book[]> {
  return db.select<Book>(
    `SELECT id, title, author, cover_image_path, file_path, file_type,
            last_opened, current_position, display_mode, metadata_source,
            epub_locations, created_at
     FROM books
     WHERE metadata_source = 'filename'
     ORDER BY id ASC`,
  );
}
```

(Re-export `Book` type at the top of the file if not already imported as a value.)

**Verify:** `npm test -- tests/db/books-phase2` — all 7 cases pass. Existing `tests/db/books.test.ts` still passes.

**Commit:** `Phase 2: db/books setters and extraction filter`

---

### Task 12 — Rust IPC commands: `read_book_bytes`, `save_cover_bytes`, `delete_book_files`

**Files:** `src-tauri/src/commands/books.rs` (extend), `src-tauri/src/lib.rs` (register), `src-tauri/capabilities/default.json` (no change — custom commands aren't in the permission list).

**Append to `src-tauri/src/commands/books.rs`:**

```rust
use std::path::PathBuf;
use tauri::path::BaseDirectory;

fn assert_within_books_dir(app: &AppHandle, path: &Path) -> Result<(), String> {
    let books_dir = app
        .path()
        .app_data_dir()
        .map_err(err("Could not resolve app data dir"))?
        .join("books");
    let canonical = path
        .canonicalize()
        .map_err(err("Could not canonicalize path"))?;
    let canonical_books = books_dir
        .canonicalize()
        .map_err(err("Could not canonicalize books dir"))?;
    if !canonical.starts_with(&canonical_books) {
        return Err("Path is outside the books directory".into());
    }
    Ok(())
}

#[tauri::command]
pub fn read_book_bytes(app: AppHandle, path: String) -> Result<Vec<u8>, String> {
    let p = PathBuf::from(&path);
    assert_within_books_dir(&app, &p)?;
    std::fs::read(&p).map_err(err("Could not read book"))
}

#[tauri::command]
pub fn save_cover_bytes(
    app: AppHandle,
    book_id: i64,
    bytes: Vec<u8>,
    ext: String,
) -> Result<String, String> {
    let ext_lc = ext.to_lowercase();
    if !matches!(ext_lc.as_str(), "jpg" | "jpeg" | "png" | "webp") {
        return Err(format!("Unsupported cover extension: {ext}"));
    }
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(err("Could not resolve app data dir"))?;
    let covers_dir = app_data.join("covers");
    std::fs::create_dir_all(&covers_dir).map_err(err("Could not create covers dir"))?;

    let dest = covers_dir.join(format!("{book_id}.{ext_lc}"));
    std::fs::write(&dest, &bytes).map_err(err("Could not write cover"))?;

    dest.to_str()
        .ok_or_else(|| "Cover path is not valid UTF-8".to_string())
        .map(|s| s.to_string())
}

#[tauri::command]
pub fn delete_book_files(
    app: AppHandle,
    book_id: i64,
    file_path: String,
) -> Result<(), String> {
    // Idempotent: ignore NotFound errors.
    let _ = std::fs::remove_file(Path::new(&file_path));

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(err("Could not resolve app data dir"))?;
    let covers_dir = app_data.join("covers");
    if covers_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&covers_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                let prefix = format!("{book_id}.");
                if name_str.starts_with(&prefix) {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
    Ok(())
}
```

Drop the unused `BaseDirectory` import if rustc complains; only included as a marker that the path APIs are in `tauri::path`.

**`src-tauri/src/lib.rs` — register the three commands:**

```rust
use commands::books::{
    app_data_dir_path, copy_uploaded_file, delete_book_files,
    read_book_bytes, reveal_in_file_manager, save_cover_bytes,
};
// ...
.invoke_handler(tauri::generate_handler![
    copy_uploaded_file,
    app_data_dir_path,
    reveal_in_file_manager,
    read_book_bytes,
    save_cover_bytes,
    delete_book_files,
    get_api_key,
    set_api_key,
])
```

**Verify:**
```bash
cd src-tauri && cargo check && cd ..
npm run tauri:dev
```
The app starts without panicking. Manual smoke for these commands happens via Tasks 16+ (the reader uses them).

**Commit:** `Phase 2: Rust IPC commands for reading/saving/deleting book files`

---

### Task 13 — TS IPC wrappers (`src/ipc/files.ts`)

**File:** `src/ipc/files.ts` (extend).

**Append:**

```ts
export async function readBookBytes(path: string): Promise<ArrayBuffer> {
  const bytes = await invoke<number[]>('read_book_bytes', { path });
  // Tauri serializes Vec<u8> as a JS number[]. Convert to a tight ArrayBuffer.
  const view = new Uint8Array(bytes);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

export async function saveCoverBytes(
  bookId: number,
  bytes: ArrayBuffer,
  ext: 'jpg' | 'jpeg' | 'png' | 'webp',
): Promise<string> {
  // The Tauri IPC layer accepts a number[] for Vec<u8>. Convert here.
  const arr = Array.from(new Uint8Array(bytes));
  return invoke<string>('save_cover_bytes', { bookId, bytes: arr, ext });
}

export async function deleteBookFiles(
  bookId: number,
  filePath: string,
): Promise<void> {
  await invoke('delete_book_files', { bookId, filePath });
}
```

**Note on byte transfer:** Tauri 2 with `serde_json`'s default array encoding does send `Vec<u8>` as a JSON array of numbers. For PDFs up to ~50MB this is ~5–10× larger over the wire than binary, but it's still under the 1–2 second budget on modern machines (§16, "Tauri 2 IPC byte-transfer cost"). If profiling reveals this as a real bottleneck, we switch to the asset-protocol B-mode (documented in spec §16); not in scope for Phase 2.

**Verify:** `npm run build` passes. Functions are exercised by Tasks 14, 15, 16.

**Commit:** `Phase 2: TS IPC wrappers for book bytes / covers / deletes`

---

### Task 14 — `llm/dictionary.ts` stub + tests

**Files:** `src/llm/dictionary.ts` (new), `tests/llm/dictionary.test.ts` (new).

**Test first:**

```ts
import { describe, it, expect } from 'vitest';
import { streamWordDefinition } from '../../src/llm/dictionary';

describe('streamWordDefinition', () => {
  it('streams tokens that concatenate to the full string in done', async () => {
    const stream = streamWordDefinition('serendipity');
    let acc = '';
    for await (const t of stream.tokens) acc += t;
    const full = await stream.done;
    expect(full).toBe(acc);
    expect(full).toContain('serendipity');
  });

  it('abort() rejects done and stops yielding', async () => {
    const stream = streamWordDefinition('any');
    setTimeout(() => stream.abort(), 5);
    let err: unknown;
    try {
      for await (const _ of stream.tokens) { /* drain */ }
      await stream.done;
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('aborted');
  });
});
```

**Implementation** (verbatim from spec §10.1):

```ts
export interface DefinitionStream {
  tokens: AsyncIterable<string>;
  done: Promise<string>;
  abort(): void;
}

export function streamWordDefinition(word: string): DefinitionStream {
  const placeholder =
    `Definition coming soon — Phase 3 will fetch a real definition for "${word}" from Anthropic.`;
  const parts = placeholder.split(/(\s+)/);

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

**Verify:** `npm test -- dictionary` — both cases pass.

**Commit:** `Phase 2: streamWordDefinition stub`

---

### Task 15 — Test fixtures (sample EPUBs and PDFs)

**Files:** `tests/fixtures/sample.epub`, `sample-no-cover.epub`, `sample.pdf`, `sample-no-author.pdf`, `cross-page.pdf`.

**Steps:** these are binary fixtures. Two acceptable sources:

1. **Generate at the command line** (preferred — reproducible):
   - Sample PDFs: use `node` with `pdf-lib` (one-shot dev script — DON'T add `pdf-lib` to runtime deps; install with `npm exec --package pdf-lib -- node generate-fixtures.mjs`):

     ```js
     // tools/generate-fixtures.mjs (dev-only, not committed)
     import { PDFDocument, StandardFonts } from 'pdf-lib';
     import { writeFileSync } from 'node:fs';

     async function makePdf({ pages, author, lineLengths, name }) {
       const doc = await PDFDocument.create();
       if (author !== null) doc.setAuthor(author);
       const font = await doc.embedFont(StandardFonts.Helvetica);
       for (let i = 0; i < pages; i++) {
         const p = doc.addPage([612, 792]);
         for (let row = 0; row < (lineLengths[i] ?? 30); row++) {
           p.drawText(`Page ${i + 1} line ${row + 1} lorem ipsum dolor sit amet.`,
             { x: 50, y: 750 - row * 16, size: 11, font });
         }
       }
       writeFileSync(`tests/fixtures/${name}`, await doc.save());
     }
     await makePdf({ pages: 8, author: 'Sample Author', lineLengths: [], name: 'sample.pdf' });
     await makePdf({ pages: 8, author: null,            lineLengths: [], name: 'sample-no-author.pdf' });
     await makePdf({ pages: 2, author: 'Sample Author',
       lineLengths: [40, 40], name: 'cross-page.pdf' });
     ```

   - Sample EPUBs: use `epub-gen-memory` (also dev-only, one-shot):

     ```js
     // tools/generate-epub-fixtures.mjs
     import { EPub } from 'epub-gen-memory';
     import { writeFileSync } from 'node:fs';

     async function makeEpub({ withCover, name }) {
       const opts = {
         title: 'Sample Book',
         author: 'Sample Author',
         ...(withCover ? { cover: 'https://placehold.co/600x900/cdd/000.png' } : {}),
         content: Array.from({ length: 6 }, (_, i) => ({
           title: `Chapter ${i + 1}`,
           content: `<p>${'Lorem ipsum dolor sit amet. '.repeat(40)}</p>`,
         })),
       };
       const buf = await new EPub(opts).genEpub();
       writeFileSync(`tests/fixtures/${name}`, buf);
     }
     await makeEpub({ withCover: true,  name: 'sample.epub' });
     await makeEpub({ withCover: false, name: 'sample-no-cover.epub' });
     ```

   Run once, commit the resulting binaries, delete the generator scripts (or keep under `tools/` if useful).

2. **Hand-craft alternative:** any `.epub` and `.pdf` you legally have, stripped to ~30 pages, will work — adjust the test assertions in Tasks 31–32 to match the fixture's actual title/author values.

**Constraints:** total fixtures < 300 KB. Each fixture < 100 KB except `sample.pdf` < 50 KB.

**Verify:**
```bash
ls -la tests/fixtures/
file tests/fixtures/*.{epub,pdf}
```
All five files exist; `file` reports `EPUB` and `PDF document`.

**Commit:** `Phase 2: test fixtures (sample epub/pdf)`

---

### Task 16 — `lib/epubExtract.ts` + test

**Files:** `src/lib/epubExtract.ts` (new), `tests/lib/epubExtract.test.ts` (new).

**Test first** (jsdom env — default). Uses real fixture; saveCoverBytes is mocked.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('../../src/ipc/files', () => ({
  saveCoverBytes: vi.fn(async (_id: number, _bytes: ArrayBuffer, ext: string) => `/covers/test.${ext}`),
}));

import { extractEpubMetadata } from '../../src/lib/epubExtract';

const SAMPLE = readFileSync(path.resolve(__dirname, '../fixtures/sample.epub'));
const NO_COVER = readFileSync(path.resolve(__dirname, '../fixtures/sample-no-cover.epub'));

beforeEach(() => vi.clearAllMocks());

describe('extractEpubMetadata', () => {
  it('extracts title, author, and cover from sample.epub', async () => {
    const ab = SAMPLE.buffer.slice(SAMPLE.byteOffset, SAMPLE.byteOffset + SAMPLE.byteLength);
    const result = await extractEpubMetadata(ab, 1);
    expect(result.title).toBe('Sample Book');
    expect(result.author).toBe('Sample Author');
    expect(result.cover_image_path).toMatch(/\/covers\/test\./);
  });

  it('returns null cover_image_path when EPUB has no cover', async () => {
    const ab = NO_COVER.buffer.slice(NO_COVER.byteOffset, NO_COVER.byteOffset + NO_COVER.byteLength);
    const result = await extractEpubMetadata(ab, 1);
    expect(result.cover_image_path).toBeNull();
  });
});
```

**Implementation:**

```ts
import ePub from 'epubjs';
import { saveCoverBytes } from '../ipc/files';

export interface EpubMetadataResult {
  title?: string;
  author: string | null;
  cover_image_path: string | null;
}

export async function extractEpubMetadata(
  bytes: ArrayBuffer,
  bookId: number,
): Promise<EpubMetadataResult> {
  const book = ePub(bytes);
  await book.ready;

  const meta = book.packaging.metadata as { title?: string; creator?: string };
  const titleRaw = (meta.title ?? '').trim();
  const authorRaw = (meta.creator ?? '').trim();

  let coverPath: string | null = null;
  try {
    const url = await book.coverUrl();
    if (url) {
      const blob = await (await fetch(url)).blob();
      const ext: 'png' | 'webp' | 'jpg' =
          blob.type === 'image/png'  ? 'png'
        : blob.type === 'image/webp' ? 'webp'
        : 'jpg';
      const buf = await blob.arrayBuffer();
      coverPath = await saveCoverBytes(bookId, buf, ext);
    }
  } catch {
    // Missing/broken cover is common — accepted.
  }

  return {
    ...(titleRaw ? { title: titleRaw } : {}),
    author: authorRaw || null,
    cover_image_path: coverPath,
  };
}
```

**Verify:** `npm test -- epubExtract` — both cases pass.

**Commit:** `Phase 2: epubExtract metadata + cover`

---

### Task 17 — `lib/pdfExtract.ts` + test

**Files:** `src/lib/pdfExtract.ts` (new), `tests/lib/pdfExtract.test.ts` (new).

**Test first** (jsdom env; canvas in jsdom is a no-op shim, but we only assert on `author` here — the cover path is asserted as "either a string or null", since `canvas.toBlob` may not work in jsdom):

```ts
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('../../src/ipc/files', () => ({
  saveCoverBytes: vi.fn(async () => '/covers/1.png'),
}));

import { extractPdfMetadata } from '../../src/lib/pdfExtract';

const SAMPLE = readFileSync(path.resolve(__dirname, '../fixtures/sample.pdf'));
const NO_AUTHOR = readFileSync(path.resolve(__dirname, '../fixtures/sample-no-author.pdf'));

describe('extractPdfMetadata', () => {
  it('extracts author when PDF has /Author', async () => {
    const ab = SAMPLE.buffer.slice(SAMPLE.byteOffset, SAMPLE.byteOffset + SAMPLE.byteLength);
    const result = await extractPdfMetadata(ab, 1);
    expect(result.author).toBe('Sample Author');
  });

  it('returns null author when PDF has no /Author', async () => {
    const ab = NO_AUTHOR.buffer.slice(NO_AUTHOR.byteOffset, NO_AUTHOR.byteOffset + NO_AUTHOR.byteLength);
    const result = await extractPdfMetadata(ab, 1);
    expect(result.author).toBeNull();
  });
});
```

**Implementation:**

```ts
import * as pdfjs from 'pdfjs-dist';
import { initPdfWorker } from './pdfWorker';
import { saveCoverBytes } from '../ipc/files';

export interface PdfMetadataResult {
  author: string | null;
  cover_image_path: string | null;
}

export async function extractPdfMetadata(
  bytes: ArrayBuffer,
  bookId: number,
): Promise<PdfMetadataResult> {
  initPdfWorker();
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;

  const info = ((await pdf.getMetadata()).info ?? {}) as { Author?: string };
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
    const ctx = canvas.getContext('2d');
    if (ctx) {
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png'),
      );
      if (blob) {
        coverPath = await saveCoverBytes(bookId, await blob.arrayBuffer(), 'png');
      }
    }
  } catch {
    // Encrypted/corrupt PDFs — leave cover null.
  }

  return { author, cover_image_path: coverPath };
}
```

`title` deliberately not in the return shape. PDF titles stay as the filename per spec §2 row 6.

**Verify:** `npm test -- pdfExtract` — both author cases pass. (Cover path may or may not populate under jsdom; the test doesn't assert on it.)

**Commit:** `Phase 2: pdfExtract metadata + page-1 cover`

---

### Task 18 — `lib/extractMetadata.ts` orchestration + test

**Files:** `src/lib/extractMetadata.ts` (new), `tests/lib/extractMetadata.test.ts` (new).

**Test first** (mock everything, focus on orchestration):

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeTestDb } from '../helpers/sqlite';
import * as booksDb from '../../src/db/books';
import { runMetadataExtractionPass } from '../../src/lib/extractMetadata';

vi.mock('../../src/ipc/files', () => ({
  readBookBytes: vi.fn(async () => new ArrayBuffer(8)),
}));
vi.mock('../../src/lib/epubExtract', () => ({
  extractEpubMetadata: vi.fn(async () => ({ author: 'A', cover_image_path: '/c.png' })),
}));
vi.mock('../../src/lib/pdfExtract', () => ({
  extractPdfMetadata: vi.fn(async () => ({ author: 'B', cover_image_path: '/d.png' })),
}));

vi.mock('../../src/db/client', () => {
  const { makeTestDb } = require('../helpers/sqlite');
  const shared = makeTestDb();
  return { getDb: vi.fn(async () => shared), _resetDbForTests: vi.fn() };
});

describe('runMetadataExtractionPass', () => {
  beforeEach(() => vi.clearAllMocks());

  it('processes only filename-source rows and stamps extracted', async () => {
    const { getDb } = await import('../../src/db/client');
    const db = await getDb();
    const idA = await booksDb.insertBook(db, { title: 'A', author: null, file_path: '/a.epub', file_type: 'epub' });
    const idB = await booksDb.insertBook(db, { title: 'B', author: null, file_path: '/b.pdf',  file_type: 'pdf'  });
    const idC = await booksDb.insertBook(db, { title: 'C', author: null, file_path: '/c.epub', file_type: 'epub' });
    await booksDb.setExtractedMetadata(db, idC, { author: 'X' });   // already done

    const patches: Array<{ id: number; patch: object }> = [];
    const fakeStore = {
      extractionInFlight: new Set<number>(),
      patchBook: (id: number, patch: object) => patches.push({ id, patch }),
    };

    await runMetadataExtractionPass(fakeStore);

    expect(patches.map((p) => p.id).sort()).toEqual([idA, idB].sort());
    const list = await booksDb.listBooks(db);
    expect(list.find((b) => b.id === idA)!.metadata_source).toBe('extracted');
    expect(list.find((b) => b.id === idB)!.metadata_source).toBe('extracted');
    expect(list.find((b) => b.id === idC)!.author).toBe('X');
  });

  it('skips a book whose id is in extractionInFlight', async () => {
    const { getDb } = await import('../../src/db/client');
    const db = await getDb();
    // (db now has 3 rows from prior test if module-level state persists; isolate by relying on inFlight)
    const inFlight = new Set<number>();
    const list = await booksDb.listBooksNeedingExtraction(db);
    if (list.length > 0) inFlight.add(list[0].id);
    const patches: number[] = [];
    await runMetadataExtractionPass({
      extractionInFlight: inFlight,
      patchBook: (id) => patches.push(id),
    });
    expect(patches).not.toContain(list[0]?.id);
  });

  it('swallows extractor errors without stamping', async () => {
    const epubExtract = await import('../../src/lib/epubExtract');
    (epubExtract.extractEpubMetadata as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('boom'));
    const { getDb } = await import('../../src/db/client');
    const db = await getDb();
    const id = await booksDb.insertBook(db, { title: 'D', author: null, file_path: '/d.epub', file_type: 'epub' });
    await runMetadataExtractionPass({ extractionInFlight: new Set(), patchBook: () => {} });
    const [row] = (await booksDb.listBooks(db)).filter((b) => b.id === id);
    expect(row.metadata_source).toBe('filename');   // unchanged
  });
});
```

**Implementation:**

```ts
import { getDb } from '../db/client';
import * as booksDb from '../db/books';
import { readBookBytes } from '../ipc/files';
import { extractEpubMetadata } from './epubExtract';
import { extractPdfMetadata } from './pdfExtract';
import type { Book } from '../db/types';

interface PassDriver {
  extractionInFlight: Set<number>;
  patchBook(id: number, patch: Partial<Book>): void;
}

export async function runMetadataExtractionPass(driver: PassDriver): Promise<void> {
  const db = await getDb();
  const candidates = await booksDb.listBooksNeedingExtraction(db);

  for (const book of candidates) {
    if (driver.extractionInFlight.has(book.id)) continue;
    driver.extractionInFlight.add(book.id);

    try {
      const bytes = await readBookBytes(book.file_path);
      const result =
        book.file_type === 'epub'
          ? await extractEpubMetadata(bytes, book.id)
          : await extractPdfMetadata(bytes, book.id);

      await booksDb.setExtractedMetadata(db, book.id, result);
      driver.patchBook(book.id, {
        ...result,
        metadata_source: 'extracted',
      });
    } catch (err) {
      console.warn(`Metadata extraction failed for book ${book.id}:`, err);
      // No DB write — book retries next boot.
    } finally {
      driver.extractionInFlight.delete(book.id);
    }
  }
}
```

**Verify:** `npm test -- extractMetadata` — all 3 cases pass.

**Commit:** `Phase 2: extractMetadata orchestration`

---

### Task 19 — Extend store: reader state, openBook/closeBook, reload actions

**File:** `src/store.ts`.

**Replace the store** (changes are additive — keep all Foundation actions). Full file:

```ts
import { create } from 'zustand';
import { getDb } from './db/client';
import * as booksDb from './db/books';
import * as notesDb from './db/notes';
import * as vocabDb from './db/vocabulary';
import * as secretsIpc from './ipc/secrets';
import { runMetadataExtractionPass } from './lib/extractMetadata';
import type { Book, FileType, NoteRow, VocabRow } from './db/types';
import type { Position } from './lib/positionShape';

export type AppView = 'library' | 'settings' | 'reader';

interface AppState {
  view: AppView;
  books: Book[];
  apiKey: string | null;
  apiKeyBannerDismissed: boolean;

  currentBookId: number | null;
  currentBookNotes: NoteRow[];
  currentBookVocab: VocabRow[];
  notesModeActive: boolean;
  extractionInFlight: Set<number>;

  setView: (view: AppView) => void;
  loadBooks: () => Promise<void>;
  insertBook: (input: { title: string; file_path: string; file_type: FileType }) => Promise<Book>;
  updateBookMetadata: (id: number, patch: { title: string; author: string | null }) => Promise<void>;
  deleteBook: (id: number) => Promise<void>;
  loadApiKey: () => Promise<void>;
  saveApiKey: (key: string) => Promise<void>;
  dismissApiKeyBanner: () => void;

  openBook: (id: number) => Promise<void>;
  closeBook: () => void;
  patchBook: (id: number, patch: Partial<Book>) => void;
  setBookDisplayMode: (id: number, mode: 'agent' | 'reader') => Promise<void>;
  setBookCurrentPosition: (id: number, position: Position) => Promise<void>;
  setBookEpubLocations: (id: number, locations: string) => Promise<void>;
  setNotesModeActive: (active: boolean) => void;
  reloadNotesForCurrentBook: () => Promise<void>;
  reloadVocabForCurrentBook: () => Promise<void>;
  insertNoteForCurrentBook: (input: {
    page_or_position: string;
    note_text: string | null;
    quote_text: string | null;
  }) => Promise<void>;
  insertVocabForCurrentBook: (input: { word: string; definition: string }) => Promise<void>;
  deleteNote: (id: number) => Promise<void>;
  deleteVocabulary: (id: number) => Promise<void>;
  runMetadataExtractionPass: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'library',
  books: [],
  apiKey: null,
  apiKeyBannerDismissed: false,

  currentBookId: null,
  currentBookNotes: [],
  currentBookVocab: [],
  notesModeActive: false,
  extractionInFlight: new Set<number>(),

  setView: (view) => set({ view }),

  loadBooks: async () => {
    const db = await getDb();
    set({ books: await booksDb.listBooks(db) });
  },

  insertBook: async (input) => {
    const db = await getDb();
    const id = await booksDb.insertBook(db, {
      title: input.title, author: null,
      file_path: input.file_path, file_type: input.file_type,
    });
    const fresh = await booksDb.listBooks(db);
    set({ books: fresh });
    const inserted = fresh.find((b) => b.id === id);
    if (!inserted) throw new Error('Inserted book missing from listBooks');
    return inserted;
  },

  updateBookMetadata: async (id, patch) => {
    const db = await getDb();
    await booksDb.updateMetadata(db, id, patch);
    set({ books: await booksDb.listBooks(db) });
  },

  deleteBook: async (id) => {
    const db = await getDb();
    await booksDb.deleteBook(db, id);
    set({ books: get().books.filter((b) => b.id !== id) });
  },

  loadApiKey: async () => {
    set({ apiKey: await secretsIpc.getApiKey() });
  },

  saveApiKey: async (key) => {
    await secretsIpc.setApiKey(key);
    set({ apiKey: key === '' ? null : key });
  },

  dismissApiKeyBanner: () => set({ apiKeyBannerDismissed: true }),

  openBook: async (id) => {
    set({
      currentBookId: id,
      view: 'reader',
      notesModeActive: false,
      currentBookNotes: [],
      currentBookVocab: [],
    });
    const db = await getDb();
    void booksDb.setLastOpened(db, id);    // fire-and-forget
    await Promise.all([
      get().reloadNotesForCurrentBook(),
      get().reloadVocabForCurrentBook(),
    ]);
  },

  closeBook: () => set({
    currentBookId: null,
    view: 'library',
    notesModeActive: false,
    currentBookNotes: [],
    currentBookVocab: [],
  }),

  patchBook: (id, patch) => set({
    books: get().books.map((b) => (b.id === id ? { ...b, ...patch } : b)),
  }),

  setBookDisplayMode: async (id, mode) => {
    const db = await getDb();
    await booksDb.setDisplayMode(db, id, mode);
    get().patchBook(id, { display_mode: mode });
  },

  setBookCurrentPosition: async (id, position) => {
    const db = await getDb();
    await booksDb.setCurrentPosition(db, id, position);
    get().patchBook(id, { current_position: JSON.stringify(position) });
  },

  setBookEpubLocations: async (id, locations) => {
    const db = await getDb();
    await booksDb.setEpubLocations(db, id, locations);
    get().patchBook(id, { epub_locations: locations });
  },

  setNotesModeActive: (active) => set({ notesModeActive: active }),

  reloadNotesForCurrentBook: async () => {
    const id = get().currentBookId;
    if (id === null) return;
    const db = await getDb();
    set({ currentBookNotes: await notesDb.listNotesForBook(db, id) });
  },

  reloadVocabForCurrentBook: async () => {
    const id = get().currentBookId;
    if (id === null) return;
    const db = await getDb();
    set({ currentBookVocab: await vocabDb.listVocabularyForBook(db, id) });
  },

  insertNoteForCurrentBook: async (input) => {
    const id = get().currentBookId;
    if (id === null) throw new Error('No current book');
    const db = await getDb();
    await notesDb.insertNote(db, { book_id: id, ...input });
    await get().reloadNotesForCurrentBook();
  },

  insertVocabForCurrentBook: async (input) => {
    const id = get().currentBookId;
    if (id === null) throw new Error('No current book');
    const db = await getDb();
    await vocabDb.insertVocabulary(db, { ...input, book_id: id });
    await get().reloadVocabForCurrentBook();
  },

  deleteNote: async (id) => {
    const db = await getDb();
    await notesDb.deleteNote(db, id);
    await get().reloadNotesForCurrentBook();
  },

  deleteVocabulary: async (id) => {
    const db = await getDb();
    await vocabDb.deleteVocabulary(db, id);
    await get().reloadVocabForCurrentBook();
  },

  runMetadataExtractionPass: async () => {
    const driver = {
      extractionInFlight: get().extractionInFlight,
      patchBook: get().patchBook,
    };
    await runMetadataExtractionPass(driver);
  },
}));
```

**Verify:** `npm run build` (TS compile) passes. Existing Foundation tests still pass (`npm test`).

**Commit:** `Phase 2: store extension for reader, notes, vocab`

---

### Task 20 — Extend `App.tsx` to route `view === 'reader'` and trigger extraction pass

**File:** `src/App.tsx`.

**Replace contents:**

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
  const loadApiKey = useAppStore((s) => s.loadApiKey);
  const runPass = useAppStore((s) => s.runMetadataExtractionPass);

  useEffect(() => {
    void (async () => {
      await Promise.all([loadApiKey(), loadBooks()]);
      void runPass();   // fire-and-forget after books load
    })();
  }, [loadApiKey, loadBooks, runPass]);

  return (
    <>
      {view === 'library'  && <LibraryScreen />}
      {view === 'settings' && <SettingsScreen />}
      {view === 'reader'   && <ReaderScreen />}
      <Toaster richColors closeButton position="bottom-right" />
    </>
  );
}
```

(`ReaderScreen` is created in Task 24 — until then, `npm run tauri:dev` will fail. Acceptable: this task and Task 24 ship in the same dev cycle.)

**Verify:** TS compile fails until Task 24 lands. That's expected.

**Commit:** Squash with Task 24 to keep `main` green.

---

### Task 21 — `BookTile.tsx` opens the reader; `GeneratedCover.tsx` adds progress + crossfade

**Files:**
- `src/screens/Library/BookTile.tsx` (replace `onClick`, pass `progress`)
- `src/screens/Library/GeneratedCover.tsx` (extend props, render bar and stack image+SVG)

**`BookTile.tsx` — replace the `onClick` and pass progress:**

```tsx
import { useAppStore } from '../../store';
import { getProgress } from '../../lib/positionProgress';
// ...existing imports

export function BookTile({ book, onEdit, onDelete }: Props) {
  const openBook = useAppStore((s) => s.openBook);
  const progress = getProgress(book.current_position);

  return (
    <div className="group relative flex flex-col gap-2">
      <button
        type="button"
        className="relative aspect-[2/3] w-full overflow-hidden rounded-md transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-accent-gold"
        onClick={() => { void openBook(book.id); }}
        aria-label={`Open ${book.title}`}
      >
        <GeneratedCover
          title={book.title}
          author={book.author}
          imageSrc={book.cover_image_path ?? undefined}
          progress={progress}
        />
      </button>
      {/* ...existing dropdown unchanged... */}
      <div className="space-y-0.5 px-1">
        <div className="line-clamp-2 font-serif text-sm leading-tight text-ink">{book.title}</div>
        {book.author && <div className="text-xs text-ink-muted">{book.author}</div>}
      </div>
    </div>
  );
}
```

**`GeneratedCover.tsx` — extend props and render structure** (full replacement of `GeneratedCoverImpl`):

```tsx
import { memo, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { fnv1a32 } from '../../lib/hash';
import { pickPalette, pickPattern } from '../../lib/coverPalette';
import { ORANGE } from '../../lib/theme';

interface Props {
  title: string;
  author: string | null;
  imageSrc?: string;
  progress?: number | null;     // NEW: 0..1 or null
}

// PatternFill, autoFitTitleSize, wrapTitle: unchanged

function GeneratedCoverImpl({ title, author, imageSrc, progress }: Props) {
  const [imgLoaded, setImgLoaded] = useState(false);

  const hash = fnv1a32(title);
  const palette = pickPalette(hash);
  const pattern = pickPattern(hash);
  const fontSize = autoFitTitleSize(title);
  const charsPerLine = Math.max(6, Math.floor(180 / (fontSize * 0.55)));
  const lines = wrapTitle(title, charsPerLine);

  return (
    <div className="relative h-full w-full">
      {/* Generated SVG always rendered — acts as placeholder behind the <img> */}
      <svg
        viewBox="0 0 200 300"
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full rounded-md shadow-sm"
        role="img"
        aria-label={`${title} cover`}
      >
        <defs><PatternFill pattern={pattern} color={palette.ink} /></defs>
        <rect width="200" height="300" fill={palette.background} />
        {pattern !== 'plain' && <rect width="200" height="300" fill={`url(#pat-${pattern})`} />}
        <rect x="0" y="28" width="200" height="2" fill={palette.accent} />
        <g
          fontFamily="Iowan Old Style, Palatino Linotype, Georgia, serif"
          fill={palette.ink}
          textAnchor="middle"
        >
          {lines.map((line, i) => (
            <text key={i} x="100" y={90 + i * (fontSize + 4)}
                  fontSize={fontSize} fontWeight={600}>{line}</text>
          ))}
          {author && (
            <text x="100" y="240" fontSize="12" fontStyle="italic" fillOpacity="0.7">
              {author}
            </text>
          )}
        </g>
        <line x1="40" x2="160" y1="270" y2="270" stroke={palette.accent} strokeWidth="1" />
        <line x1="40" x2="160" y1="274" y2="274" stroke={palette.accent} strokeWidth="0.5" />
      </svg>

      {/* Real cover image fades in over SVG when imageSrc is set */}
      {imageSrc && (
        <img
          src={convertFileSrc(imageSrc)}
          alt={`${title} cover`}
          onLoad={() => setImgLoaded(true)}
          className={`absolute inset-0 h-full w-full rounded-md object-cover shadow-sm transition-opacity duration-[250ms] ${
            imgLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          draggable={false}
        />
      )}

      {/* Reading progress bar */}
      {progress != null && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-stone-200/40">
          <div
            className="h-full transition-[width] duration-300 ease-out"
            style={{ width: `${Math.round(progress * 100)}%`, background: ORANGE }}
          />
        </div>
      )}
    </div>
  );
}

export const GeneratedCover = memo(
  GeneratedCoverImpl,
  (a, b) =>
    a.title === b.title &&
    a.author === b.author &&
    a.imageSrc === b.imageSrc &&
    a.progress === b.progress,
);
```

**Asset-protocol scope:** add `<app_data_dir>/covers/**` to allowed asset reads. In `src-tauri/tauri.conf.json`'s `app.security`, add:

```json
"security": {
  "csp": null,
  "assetProtocol": {
    "enable": true,
    "scope": ["$APPDATA/covers/**", "$APPDATA/Scholara/covers/**"]
  }
}
```

`$APPDATA` resolves per-OS via Tauri. Both forms cover macOS (`Scholara`-suffixed) and Linux/Windows (root) variants. Verify at `npm run tauri:dev`: a real cover image renders correctly when `book.cover_image_path` is set.

**Verify:** Existing Foundation Library tests still pass (no Library tile tests existed). Manually verified by Task 24 + the auto-extract pass.

**Commit:** `Phase 2: BookTile opens reader; GeneratedCover progress + crossfade`

---

### Task 22 — `MissingFileScreen.tsx`

**File:** `src/screens/Reader/MissingFileScreen.tsx`.

```tsx
import { useAppStore } from '../../store';
import { Button } from '@/components/ui/button';

export function MissingFileScreen() {
  const closeBook = useAppStore((s) => s.closeBook);
  return (
    <div className="flex h-full w-full items-center justify-center bg-cream">
      <div className="flex flex-col items-center gap-6 text-center">
        <p className="font-serif text-xl text-ink">This book&rsquo;s file is missing.</p>
        <p className="text-sm text-ink-muted">It may have been moved or deleted.</p>
        <Button variant="outline" onClick={closeBook}>← Library</Button>
      </div>
    </div>
  );
}
```

**Verify:** TS compile passes (after Task 24's `Reader/index.tsx` exists or this file's import stays self-contained). Visually verified during step 21 of §14.

**Commit:** `Phase 2: MissingFileScreen`

---

### Task 23 — `ReaderChrome.tsx` and `ModeToggle.tsx`

**Files:** `src/screens/Reader/ReaderChrome.tsx`, `src/screens/Reader/ModeToggle.tsx`.

**`ModeToggle.tsx`:**

```tsx
import { Columns2, BookOpen } from 'lucide-react';
import type { DisplayMode } from '../../db/types';

interface Props {
  value: DisplayMode;
  onChange: (mode: DisplayMode) => void;
}

export function ModeToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-stone-300">
      <button
        type="button"
        aria-label="Agent display"
        aria-pressed={value === 'agent'}
        onClick={() => onChange('agent')}
        className={`px-3 py-1 ${value === 'agent' ? 'bg-stone-200 text-ink' : 'bg-cream text-ink-muted'}`}
      >
        <Columns2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Full reader display"
        aria-pressed={value === 'reader'}
        onClick={() => onChange('reader')}
        className={`px-3 py-1 ${value === 'reader' ? 'bg-stone-200 text-ink' : 'bg-cream text-ink-muted'}`}
      >
        <BookOpen className="h-4 w-4" />
      </button>
    </div>
  );
}
```

**`ReaderChrome.tsx`:**

```tsx
import { useEffect } from 'react';
import { Feather } from 'lucide-react';
import { useAppStore } from '../../store';
import type { Book } from '../../db/types';
import { ModeToggle } from './ModeToggle';
import { ORANGE } from '../../lib/theme';

interface Props {
  book: Book;
  variant: 'split' | 'fullscreen';
}

export function ReaderChrome({ book, variant: _variant }: Props) {
  const closeBook        = useAppStore((s) => s.closeBook);
  const setBookMode      = useAppStore((s) => s.setBookDisplayMode);
  const notesModeActive  = useAppStore((s) => s.notesModeActive);
  const setNotesMode     = useAppStore((s) => s.setNotesModeActive);

  // 'n' toggles notes mode, Esc exits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.matches('input,textarea,[contenteditable="true"]')) return;
      if (e.key === 'n')        setNotesMode(!notesModeActive);
      if (e.key === 'Escape')   setNotesMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notesModeActive, setNotesMode]);

  return (
    <div className="flex items-center justify-between border-b border-stone-200 bg-cream/80 px-4 py-2 backdrop-blur">
      <button
        type="button"
        onClick={closeBook}
        className="font-serif text-sm text-ink hover:underline"
      >
        ← Library
      </button>
      <ModeToggle
        value={book.display_mode}
        onChange={(m) => { void setBookMode(book.id, m); }}
      />
      <button
        type="button"
        aria-label="Take a note (n)"
        title="Take a note (n)"
        onClick={() => setNotesMode(!notesModeActive)}
        className="rounded p-1 transition"
      >
        <Feather
          className="h-5 w-5"
          style={notesModeActive
            ? { color: ORANGE, fill: ORANGE }
            : { color: ORANGE, fill: 'transparent' }}
        />
      </button>
    </div>
  );
}
```

**Verify:** TS compile passes after Task 24. Visual verification: §14 step 9 (quill toggles fill on click and `n` press; `Esc` exits).

**Commit:** `Phase 2: ReaderChrome + ModeToggle`

---

### Task 24 — `ReaderScreen` orchestration (`src/screens/Reader/index.tsx`)

**File:** `src/screens/Reader/index.tsx`.

**Code:**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '../../store';
import { readBookBytes } from '../../ipc/files';
import { AgentDisplay } from './AgentDisplay';
import { FullReaderDisplay } from './FullReaderDisplay';
import { MissingFileScreen } from './MissingFileScreen';

export function ReaderScreen() {
  const currentBookId = useAppStore((s) => s.currentBookId);
  const books         = useAppStore((s) => s.books);
  const book = useMemo(
    () => books.find((b) => b.id === currentBookId) ?? null,
    [books, currentBookId],
  );

  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [missing, setMissing] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    if (!book) {
      setMissing(true);
      return;
    }
    setMissing(false);
    setBytes(null);
    (async () => {
      try {
        const ab = await readBookBytes(book.file_path);
        if (!cancelled.current) setBytes(ab);
      } catch (err) {
        console.warn('Could not read book bytes:', err);
        if (!cancelled.current) setMissing(true);
      }
    })();
    return () => { cancelled.current = true; };
  }, [book?.id, book?.file_path]);

  if (!book || missing) return <MissingFileScreen />;
  if (!bytes) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-cream">
        <p className="text-sm text-ink-muted">Opening…</p>
      </div>
    );
  }

  // Suppress an unused variable warning until we wire toasts elsewhere.
  void toast;

  return book.display_mode === 'reader'
    ? <FullReaderDisplay book={book} bytes={bytes} />
    : <AgentDisplay book={book} bytes={bytes} />;
}
```

**Verify:** `npm run build` (TS compile) passes once `AgentDisplay` and `FullReaderDisplay` exist (next two tasks). Then `npm run tauri:dev` and click a tile: an empty reader screen with the chrome should appear (leaves are stub for now).

**Commit:** Combined with Tasks 25 + 26 below: `Phase 2: ReaderScreen + display shells`.

---

### Task 25 — `AgentDisplay.tsx` shell (no agent panel content yet)

**File:** `src/screens/Reader/AgentDisplay.tsx`.

```tsx
import type { Book } from '../../db/types';
import { ReaderChrome } from './ReaderChrome';
import { ReaderLeaf } from './ReaderLeaf';
import { NotesModeInput } from './NotesModeInput';
import { useAppStore } from '../../store';
import { AgentPanel } from './agentPanel/AgentPanel';

interface Props { book: Book; bytes: ArrayBuffer; }

export function AgentDisplay({ book, bytes }: Props) {
  const notesModeActive = useAppStore((s) => s.notesModeActive);
  return (
    <div className="grid h-full grid-cols-[1fr_22rem]">
      <section className="flex min-w-0 flex-col">
        <ReaderChrome book={book} variant="split" />
        <div className="relative flex-1 min-h-0">
          <ReaderLeaf book={book} bytes={bytes} />
        </div>
        {notesModeActive && (
          <div className="border-t border-stone-200 bg-amber-50/40 p-3">
            <NotesModeInput book={book} fullWidth={false} />
          </div>
        )}
      </section>
      <aside className="flex min-w-0 flex-col border-l border-stone-200 bg-cream/50">
        <AgentPanel book={book} />
      </aside>
    </div>
  );
}
```

**`ReaderLeaf` dispatch helper** — extract once in `src/screens/Reader/ReaderLeaf.tsx`:

```tsx
import type { Book } from '../../db/types';
import { EpubReader } from './EpubReader';
import { PdfReader } from './PdfReader';

interface Props { book: Book; bytes: ArrayBuffer; }

export function ReaderLeaf({ book, bytes }: Props) {
  return book.file_type === 'epub'
    ? <EpubReader book={book} bytes={bytes} />
    : <PdfReader  book={book} bytes={bytes} />;
}
```

**Verify:** Builds once Task 27 (leaves), Task 30 (NotesModeInput), Task 28 (AgentPanel) are in.

**Commit:** Squash with Task 24 + 26.

---

### Task 26 — `FullReaderDisplay.tsx` shell

**File:** `src/screens/Reader/FullReaderDisplay.tsx`.

```tsx
import type { Book } from '../../db/types';
import { ReaderChrome } from './ReaderChrome';
import { ReaderLeaf } from './ReaderLeaf';
import { NotesModeInput } from './NotesModeInput';
import { FloatingLogoInput } from './FloatingLogoInput';
import { useAppStore } from '../../store';

interface Props { book: Book; bytes: ArrayBuffer; }

export function FullReaderDisplay({ book, bytes }: Props) {
  const notesModeActive = useAppStore((s) => s.notesModeActive);
  return (
    <div className="relative flex h-full w-full flex-col">
      <ReaderChrome book={book} variant="fullscreen" />
      <div className="relative flex-1 min-h-0">
        <ReaderLeaf book={book} bytes={bytes} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
        <div className="pointer-events-auto">
          {notesModeActive
            ? <NotesModeInput book={book} fullWidth />
            : <FloatingLogoInput />}
        </div>
      </div>
    </div>
  );
}
```

**Verify:** Builds once leaves + inputs exist. Manually: §14 step 10 (Full Reader notes mode), step 18 (floating input).

**Commit:** Combined with Task 24 + 25 — single squashed commit `Phase 2: ReaderScreen + AgentDisplay + FullReaderDisplay shells`.

---

### Task 27 — `EpubReader.tsx` (leaf)

**File:** `src/screens/Reader/EpubReader.tsx`.

**Approach:** mount epub.js, render to a div ref, wire prev/next + position persistence + selection capture + annotation pass.

```tsx
import { useEffect, useRef } from 'react';
import ePub, { type Book as EpubBook, type Rendition } from 'epubjs';
import { useAppStore } from '../../store';
import { applyEpubAnnotations } from './annotations/EpubAnnotations';
import { serializePosition, type Position, type EpubQuoteRange } from '../../lib/positionShape';
import type { Book } from '../../db/types';

interface Props { book: Book; bytes: ArrayBuffer; }

export function EpubReader({ book, bytes }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const epubBookRef  = useRef<EpubBook | null>(null);

  const notes              = useAppStore((s) => s.currentBookNotes);
  const notesModeActive    = useAppStore((s) => s.notesModeActive);
  const setBookPosition    = useAppStore((s) => s.setBookCurrentPosition);
  const setEpubLocations   = useAppStore((s) => s.setBookEpubLocations);

  // Mount epub.js once per (book, bytes) change.
  useEffect(() => {
    if (!containerRef.current) return;
    const epubBook = ePub(bytes);
    epubBookRef.current = epubBook;

    const rendition = epubBook.renderTo(containerRef.current, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      manager: 'default',
    });
    renditionRef.current = rendition;

    let initialCfi: string | undefined;
    if (book.current_position) {
      try {
        const p = JSON.parse(book.current_position) as Position;
        if (p.type === 'epub') initialCfi = p.locator;
      } catch { /* ignore */ }
    }

    void rendition.display(initialCfi);

    // Generate or reuse Locations.
    void (async () => {
      await epubBook.ready;
      if (book.epub_locations) {
        await epubBook.locations.load(book.epub_locations);
      } else {
        await epubBook.locations.generate(1024);   // 1024 chars per locator
        const locsJson = epubBook.locations.save();
        await setEpubLocations(book.id, locsJson);
      }
    })();

    // Position persistence on relocate (debounced).
    let debounceHandle: ReturnType<typeof setTimeout> | null = null;
    rendition.on('relocated', (location: { start: { cfi: string } }) => {
      if (debounceHandle) clearTimeout(debounceHandle);
      debounceHandle = setTimeout(() => {
        const cfi = location.start.cfi;
        const fraction = epubBook.locations?.percentageFromCfi
          ? epubBook.locations.percentageFromCfi(cfi)
          : 0;
        const pos: Position = {
          type: 'epub',
          locator: cfi,
          fraction: fraction || 0,
          label: getChapterLabel(epubBook, cfi),
        };
        void setBookPosition(book.id, pos);
      }, 500);
    });

    // Keyboard navigation.
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.matches('input,textarea,[contenteditable="true"]')) return;
      if (e.key === 'ArrowRight') void rendition.next();
      if (e.key === 'ArrowLeft')  void rendition.prev();
    };
    window.addEventListener('keydown', onKey);

    // Cleanup.
    return () => {
      if (debounceHandle) clearTimeout(debounceHandle);
      window.removeEventListener('keydown', onKey);
      rendition.destroy();
      epubBook.destroy();
    };
  }, [book.id, bytes, book.current_position, book.epub_locations,
      setBookPosition, setEpubLocations]);

  // Re-apply annotations on note changes.
  useEffect(() => {
    if (!renditionRef.current) return;
    const handle = applyEpubAnnotations(renditionRef.current, notes);
    return () => handle.detach();
  }, [notes]);

  // Selection capture for quote / dictionary.
  useEffect(() => {
    const rendition = renditionRef.current;
    const epubBook  = epubBookRef.current;
    if (!rendition || !epubBook) return;

    const handler = (cfiRange: string, contents: { window: Window }) => {
      const sel = contents.window.getSelection();
      const text = sel?.toString() ?? '';
      if (!text.trim()) return;
      const [startCfi, endCfi] = cfiRange.split(',');
      const range: EpubQuoteRange = {
        start: { type: 'epub', locator: startCfi, fraction: epubBook.locations?.percentageFromCfi(startCfi) ?? 0, label: getChapterLabel(epubBook, startCfi) },
        end:   { type: 'epub', locator: endCfi,   fraction: epubBook.locations?.percentageFromCfi(endCfi)   ?? 0, label: getChapterLabel(epubBook, endCfi) },
      };
      const evt = new CustomEvent('scholara:selection', {
        detail: { kind: text.trim().split(/\s+/).length === 1 ? 'word' : 'range', text: text.trim(), range },
      });
      window.dispatchEvent(evt);
    };
    rendition.on('selected', handler);
    return () => { rendition.off('selected', handler); };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className={`absolute inset-0 ${notesModeActive ? 'bg-amber-50/30' : ''}`}
      />
    </div>
  );
}

function getChapterLabel(epubBook: EpubBook, cfi: string): string {
  try {
    const spineItem = epubBook.spine.get(cfi);
    return spineItem?.idref ?? 'Chapter';
  } catch { return 'Chapter'; }
}
```

**Selection event bus:** the leaf dispatches a `scholara:selection` `CustomEvent` on `window`. Both `SelectionToolbar` (Task 31) and `NotesModeInput` (Task 30) listen for it. Decouples the leaf from UI siblings.

**Verify:**
- TS compiles.
- Manually: open an EPUB, see paginated layout, `→` advances pages, position persists across reload (§14 step 6).

**Commit:** `Phase 2: EpubReader leaf`

---

### Task 28 — `PdfReader.tsx` (leaf — virtualized continuous scroll)

**File:** `src/screens/Reader/PdfReader.tsx`.

**Approach:** render each page on an off-screen canvas only when its container enters the viewport (IntersectionObserver). Page containers are placeholders sized to the page's viewport dimensions until rendered.

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { initPdfWorker } from '../../lib/pdfWorker';
import { useAppStore } from '../../store';
import { applyPdfAnnotations } from './annotations/PdfAnnotations';
import {
  serializePosition, type Position, type PdfQuoteRange,
} from '../../lib/positionShape';
import { viewportRectToPdfRect } from '../../lib/pdfRectTransform';
import type { Book } from '../../db/types';

const RENDER_SCALE = 1.5;

interface Props { book: Book; bytes: ArrayBuffer; }

export function PdfReader({ book, bytes }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs     = useRef<HTMLDivElement[]>([]);
  const [pdf, setPdf]            = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const renderedPages            = useRef<Set<number>>(new Set());

  const notes              = useAppStore((s) => s.currentBookNotes);
  const notesModeActive    = useAppStore((s) => s.notesModeActive);
  const setBookPosition    = useAppStore((s) => s.setBookCurrentPosition);

  // Load PDF.
  useEffect(() => {
    initPdfWorker();
    let cancelled = false;
    (async () => {
      const doc = await pdfjs.getDocument({ data: bytes }).promise;
      if (cancelled) return;
      setPdf(doc);
      setPageCount(doc.numPages);
    })();
    return () => { cancelled = true; };
  }, [bytes]);

  // Initial scroll to saved position.
  useEffect(() => {
    if (!pdf || !containerRef.current) return;
    if (!book.current_position) return;
    try {
      const p = JSON.parse(book.current_position) as Position;
      if (p.type === 'pdf') {
        // Wait for pageRefs to populate.
        requestAnimationFrame(() => {
          const target = pageRefs.current[p.locator - 1];
          target?.scrollIntoView({ block: 'start' });
        });
      }
    } catch { /* ignore */ }
  }, [pdf, book.current_position]);

  // Render pages on visibility.
  useEffect(() => {
    if (!pdf || !containerRef.current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = Number(entry.target.getAttribute('data-page'));
          if (entry.isIntersecting && !renderedPages.current.has(idx)) {
            void renderPage(pdf, idx, pageRefs.current[idx - 1], notes);
            renderedPages.current.add(idx);
          }
        }
      },
      { root: containerRef.current, rootMargin: '500px 0px' },
    );
    pageRefs.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [pdf, notes]);

  // Position persistence on scroll-stop.
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !pdf) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // Find the page whose top is nearest the viewport top.
        let bestIdx = 1;
        let bestDist = Infinity;
        const rootTop = root.getBoundingClientRect().top;
        pageRefs.current.forEach((el, i) => {
          if (!el) return;
          const d = Math.abs(el.getBoundingClientRect().top - rootTop);
          if (d < bestDist) { bestDist = d; bestIdx = i + 1; }
        });
        const pos: Position = {
          type: 'pdf', locator: bestIdx, fraction: bestIdx / pdf.numPages, label: `Page ${bestIdx}`,
        };
        void setBookPosition(book.id, pos);
      }, 500);
    };
    root.addEventListener('scroll', handler);
    return () => {
      root.removeEventListener('scroll', handler);
      if (timer) clearTimeout(timer);
    };
  }, [pdf, book.id, setBookPosition]);

  // Re-run annotations when notes change.
  useEffect(() => {
    if (!pdf) return;
    pageRefs.current.forEach((el, i) => {
      if (!el || !renderedPages.current.has(i + 1)) return;
      void applyAnnotationsForPage(pdf, i + 1, el, notes);
    });
  }, [notes, pdf]);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.matches('input,textarea,[contenteditable="true"]')) return;
      const root = containerRef.current;
      if (!root) return;
      if (e.key === ' ' && !e.shiftKey) { e.preventDefault(); root.scrollBy({ top: root.clientHeight * 0.9 }); }
      if (e.key === ' ' && e.shiftKey)  { e.preventDefault(); root.scrollBy({ top: -root.clientHeight * 0.9 }); }
      if (e.key === 'Home')             { e.preventDefault(); pageRefs.current[0]?.scrollIntoView(); }
      if (e.key === 'End')              { e.preventDefault(); pageRefs.current[pageRefs.current.length - 1]?.scrollIntoView(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Selection capture (multi-page aware) — see §9.4.
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !pdf) return;
    const onMouseUp = async () => {
      const sel = window.getSelection();
      const text = sel?.toString() ?? '';
      if (!text.trim()) return;
      // Build pages[] from each Range's clientRects, mapped per page-container.
      const range = sel!.getRangeAt(0);
      const rects = Array.from(range.getClientRects());
      const perPage = new Map<number, Array<{ x: number; y: number; w: number; h: number }>>();
      for (const r of rects) {
        for (let i = 0; i < pageRefs.current.length; i++) {
          const el = pageRefs.current[i];
          if (!el) continue;
          const elRect = el.getBoundingClientRect();
          if (r.left >= elRect.left && r.right <= elRect.right
              && r.top >= elRect.top - 1 && r.bottom <= elRect.bottom + 1) {
            const page = i + 1;
            const local = { x: r.left - elRect.left, y: r.top - elRect.top, w: r.width, h: r.height };
            const pdfPage = await pdf.getPage(page);
            const vp = pdfPage.getViewport({ scale: RENDER_SCALE });
            const pdfRect = viewportRectToPdfRect(local, vp);
            const arr = perPage.get(page) ?? [];
            arr.push(pdfRect);
            perPage.set(page, arr);
            break;
          }
        }
      }
      if (perPage.size === 0) return;
      const pageNums = Array.from(perPage.keys()).sort((a, b) => a - b);
      const first = pageNums[0];
      const last  = pageNums[pageNums.length - 1];
      const range2: PdfQuoteRange = {
        start: { type: 'pdf', locator: first, fraction: first / pdf.numPages, label: `Page ${first}` },
        end:   { type: 'pdf', locator: last,  fraction: last  / pdf.numPages, label: `Page ${last}`  },
        pages: pageNums.map((p) => ({ page: p, rects: perPage.get(p)! })),
      };
      const evt = new CustomEvent('scholara:selection', {
        detail: {
          kind: text.trim().split(/\s+/).length === 1 ? 'word' : 'range',
          text: text.trim(),
          range: range2,
        },
      });
      window.dispatchEvent(evt);
    };
    root.addEventListener('mouseup', onMouseUp);
    return () => root.removeEventListener('mouseup', onMouseUp);
  }, [pdf]);

  if (!pdf) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-muted">Loading PDF…</div>;
  }

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 overflow-y-auto ${notesModeActive ? 'bg-amber-50/30' : ''}`}
    >
      <div className="mx-auto flex w-fit flex-col gap-4 py-6">
        {Array.from({ length: pageCount }).map((_, i) => (
          <div
            key={i}
            data-page={i + 1}
            ref={(el) => { if (el) pageRefs.current[i] = el; }}
            className="relative bg-white shadow"
          />
        ))}
      </div>
    </div>
  );
}

async function renderPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  container: HTMLElement,
  notes: import('../../db/types').NoteRow[],
) {
  const page: PDFPageProxy = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  container.style.width  = `${viewport.width}px`;
  container.style.height = `${viewport.height}px`;

  const canvas = document.createElement('canvas');
  canvas.width  = viewport.width;
  canvas.height = viewport.height;
  canvas.className = 'absolute inset-0';
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  await page.render({ canvasContext: ctx, viewport }).promise;
  container.innerHTML = '';
  container.appendChild(canvas);

  // Text layer (for selection).
  const textLayer = document.createElement('div');
  textLayer.className = 'absolute inset-0 textLayer';
  textLayer.style.cssText = 'color: transparent; user-select: text; line-height: 1;';
  container.appendChild(textLayer);
  const textContent = await page.getTextContent();
  // pdfjs-dist 4.x: use renderTextLayer
  const taskAny = (pdfjs as unknown as {
    renderTextLayer?: (args: object) => { promise: Promise<void> };
  }).renderTextLayer;
  if (taskAny) {
    await taskAny({ textContentSource: textContent, container: textLayer, viewport, textDivs: [] }).promise;
  }

  await applyAnnotationsForPage(pdf, pageNumber, container, notes);
}

async function applyAnnotationsForPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  container: HTMLElement,
  notes: import('../../db/types').NoteRow[],
) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  applyPdfAnnotations(pageNumber, container, viewport, notes);
}
```

**Notes on the implementation:**
- `RENDER_SCALE = 1.5` is a balance between sharpness and memory. Hard-coded for Phase 2; Phase 4+ may add zoom controls.
- `pdfjs.renderTextLayer` is exported by pdfjs-dist 4.x but its types in some bundles are loose; the `as unknown` cast is intentional and pragmatic.
- The text layer is what enables `window.getSelection()` to return real text on a PDF page.

**Verify:**
- TS compiles.
- Manually: §14 step 7 — open a PDF, see continuous scroll, page indicator updates (Task 29 adds the indicator), saved position persists.

**Commit:** `Phase 2: PdfReader leaf with virtualized rendering`

---

### Task 29 — Page indicator (passive readout, both modes)

**File:** add a small `PageIndicator.tsx` overlay rendered inside both leaves' containers (or as part of `ReaderChrome`).

**Decision:** add to `ReaderChrome.tsx` as a centered subtitle below the chrome row. Simpler than a per-leaf component.

**`ReaderChrome.tsx` patch:** within the existing component, render a second row when the book has a `current_position`:

```tsx
import { getProgress } from '../../lib/positionProgress';

// inside ReaderChrome, after the toolbar row:
{book.current_position && (
  <div className="flex justify-center bg-cream/80 pb-1 text-xs text-ink-muted">
    {readableLabel(book)}
  </div>
)}

// Helper at the bottom of the file:
function readableLabel(book: Book): string {
  try {
    const p = JSON.parse(book.current_position!);
    if (p?.label) return `${p.label}${typeof p.fraction === 'number' ? ` · ${Math.round(p.fraction * 100)}%` : ''}`;
  } catch { /* ignore */ }
  return '';
}
```

The indicator updates on `book.current_position` change (which `setBookCurrentPosition` triggers via `patchBook`).

**Verify:** §14 step 6/7 — flipping pages updates the indicator within ~500ms (the debounce window).

**Commit:** `Phase 2: page indicator in ReaderChrome`

---

### Task 30 — `NotesModeInput.tsx` + selection→draft glue

**File:** `src/screens/Reader/NotesModeInput.tsx`.

```tsx
import { useEffect, useState } from 'react';
import { Feather } from 'lucide-react';
import { toast } from 'sonner';
import type { Book } from '../../db/types';
import { useAppStore } from '../../store';
import { ORANGE } from '../../lib/theme';
import {
  serializePosition,
  serializeQuoteRange,
  type Position,
  type QuoteRange,
} from '../../lib/positionShape';

interface Draft {
  quote: { text: string; range: QuoteRange } | null;
  body: string;
}

interface Props { book: Book; fullWidth: boolean; }

export function NotesModeInput({ book, fullWidth }: Props) {
  const insertNote = useAppStore((s) => s.insertNoteForCurrentBook);
  const setNotesMode = useAppStore((s) => s.setNotesModeActive);
  const [draft, setDraft] = useState<Draft>({ quote: null, body: '' });

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { kind: 'word' | 'range'; text: string; range: QuoteRange };
      setDraft((d) => ({ ...d, quote: { text: detail.text, range: detail.range } }));
    };
    window.addEventListener('scholara:selection', handler);
    return () => window.removeEventListener('scholara:selection', handler);
  }, []);

  // Esc clears mode (chrome handles the listener; clear local draft on unmount).
  useEffect(() => () => setDraft({ quote: null, body: '' }), []);

  const canSave = draft.quote !== null || draft.body.trim() !== '';

  async function onSave() {
    let positionJson: string;
    if (draft.quote) {
      positionJson = serializeQuoteRange(draft.quote.range);
    } else {
      const pos = readCurrentPosition(book);
      if (!pos) { toast.error('Could not detect current position.'); return; }
      positionJson = serializePosition(pos);
    }
    await insertNote({
      page_or_position: positionJson,
      note_text: draft.body.trim() || null,
      quote_text: draft.quote?.text ?? null,
    });
    setDraft({ quote: null, body: '' });
    setNotesMode(false);
    toast.success('Saved');
  }

  return (
    <div className={`flex items-center gap-2 ${fullWidth ? 'w-[80vw] rounded-full border border-white/30 bg-white/40 px-4 py-3 backdrop-blur-md shadow' : 'w-full'}`}>
      {draft.quote && (
        <span className="line-clamp-1 max-w-[40%] text-xs italic text-ink-muted">
          &ldquo;{draft.quote.text}&rdquo;
        </span>
      )}
      <input
        autoFocus
        type="text"
        placeholder="Add a note…"
        value={draft.body}
        onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
        onKeyDown={(e) => { if (e.key === 'Enter' && canSave) void onSave(); }}
        className="flex-1 bg-transparent outline-none placeholder:text-ink-muted"
      />
      <button
        type="button"
        aria-label="Save note"
        disabled={!canSave}
        onClick={() => { void onSave(); }}
        className="rounded p-1 disabled:opacity-30"
      >
        <Feather className="h-4 w-4" style={{ color: ORANGE, fill: ORANGE }} />
      </button>
    </div>
  );
}

function readCurrentPosition(book: Book): Position | null {
  if (!book.current_position) return null;
  try {
    const p = JSON.parse(book.current_position);
    if ((p?.type === 'pdf' || p?.type === 'epub') && typeof p.fraction === 'number') return p as Position;
  } catch { /* ignore */ }
  return null;
}
```

**`getCurrentLeafPosition()` simplification:** rather than register a callback per leaf, the body-only save uses the latest persisted position from `book.current_position`. Since the leaf debounces position writes on every flip / scroll-stop, the worst-case staleness is ~500ms — acceptable for a body-only note.

**Verify:** §14 steps 9, 11, 12.

**Commit:** `Phase 2: NotesModeInput`

---

### Task 31 — `SelectionToolbar.tsx`

**File:** `src/screens/Reader/SelectionToolbar.tsx`.

**Wiring:** mounted inside `AgentDisplay` and `FullReaderDisplay` (or, simpler: rendered once globally inside `ReaderScreen`). Place inside `ReaderScreen` after the leaf:

```tsx
// In src/screens/Reader/index.tsx (modify Task 24 to include SelectionToolbar):
return (
  <>
    {book.display_mode === 'reader'
      ? <FullReaderDisplay book={book} bytes={bytes} />
      : <AgentDisplay book={book} bytes={bytes} />}
    <SelectionToolbar book={book} />
    <DictionaryModal />
  </>
);
```

**`SelectionToolbar.tsx`:**

```tsx
import { useEffect, useState } from 'react';
import { useAppStore } from '../../store';
import type { Book } from '../../db/types';
import type { QuoteRange } from '../../lib/positionShape';
import { dispatchOpenDictionary } from './DictionaryModal';

interface Pending {
  kind: 'word' | 'range';
  text: string;
  range: QuoteRange;
  rect: { x: number; y: number };
}

interface Props { book: Book; }

export function SelectionToolbar({ book: _book }: Props) {
  const notesModeActive = useAppStore((s) => s.notesModeActive);
  const setNotesMode    = useAppStore((s) => s.setNotesModeActive);
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    const onSel = (e: Event) => {
      const d = (e as CustomEvent).detail as { kind: 'word' | 'range'; text: string; range: QuoteRange };
      const sel = window.getSelection();
      let rect = { x: window.innerWidth / 2, y: 100 };
      if (sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        rect = { x: r.left, y: r.bottom + 8 };
      }
      setPending({ ...d, rect });
    };
    const dismiss = () => setPending(null);
    window.addEventListener('scholara:selection', onSel);
    window.addEventListener('mousedown', dismiss);
    return () => {
      window.removeEventListener('scholara:selection', onSel);
      window.removeEventListener('mousedown', dismiss);
    };
  }, []);

  if (!pending) return null;

  // Decide which buttons to show per spec §8.5.
  const isWord = pending.kind === 'word';
  const showAddToDictionary  = !notesModeActive && isWord;
  const showHighlightAsQuote =  notesModeActive;
  const showTakeNoteOnThis   = !notesModeActive && !isWord;

  return (
    <div
      className="fixed z-50 flex gap-2 rounded-md border border-stone-200 bg-cream px-2 py-1 shadow"
      style={{ left: pending.rect.x, top: pending.rect.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {showAddToDictionary && (
        <button
          type="button"
          className="text-sm text-ink hover:underline"
          onClick={() => {
            const cleaned = sanitizeWord(pending.text);
            if (!cleaned) return;
            dispatchOpenDictionary(cleaned);
            setPending(null);
            window.getSelection()?.removeAllRanges();
          }}
        >Add to Dictionary</button>
      )}
      {showHighlightAsQuote && (
        <button
          type="button"
          className="text-sm text-ink hover:underline"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('scholara:set-quote', {
              detail: { text: pending.text, range: pending.range },
            }));
            setPending(null);
          }}
        >Highlight as Quote</button>
      )}
      {showTakeNoteOnThis && (
        <button
          type="button"
          className="text-sm text-ink hover:underline"
          onClick={() => {
            setNotesMode(true);
            // NotesModeInput already listens to scholara:selection; replay it.
            queueMicrotask(() => {
              window.dispatchEvent(new CustomEvent('scholara:selection', {
                detail: { kind: pending.kind, text: pending.text, range: pending.range },
              }));
            });
            setPending(null);
          }}
        >Take a note on this</button>
      )}
    </div>
  );
}

function sanitizeWord(text: string): string {
  const trimmed = text.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (/\s/.test(trimmed)) return '';
  return trimmed;
}
```

**Update `NotesModeInput.tsx`** to also listen for `scholara:set-quote` (the explicit "Highlight as Quote" path):

```tsx
useEffect(() => {
  const handler = (e: Event) => {
    const d = (e as CustomEvent).detail as { text: string; range: QuoteRange };
    setDraft((draft) => ({ ...draft, quote: { text: d.text, range: d.range } }));
  };
  window.addEventListener('scholara:set-quote', handler);
  return () => window.removeEventListener('scholara:set-quote', handler);
}, []);
```

**Verify:** §14 step 15 — the four selection-toolbar combinations behave as specified.

**Commit:** `Phase 2: SelectionToolbar with mode-aware actions`

---

### Task 32 — `DictionaryModal.tsx`

**File:** `src/screens/Reader/DictionaryModal.tsx`.

```tsx
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useAppStore } from '../../store';
import { streamWordDefinition, type DefinitionStream } from '../../llm/dictionary';

const OPEN_EVENT = 'scholara:open-dictionary';

export function dispatchOpenDictionary(word: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: word }));
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'streaming'; word: string; partial: string }
  | { kind: 'done'; word: string; full: string }
  | { kind: 'aborted' };

export function DictionaryModal() {
  const insertVocab = useAppStore((s) => s.insertVocabForCurrentBook);
  const currentBookId = useAppStore((s) => s.currentBookId);
  const [state, setState] = useState<Phase>({ kind: 'idle' });
  const streamRef = useRef<DefinitionStream | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const word = (e as CustomEvent).detail as string;
      if (!currentBookId) return;
      streamRef.current?.abort();
      const s = streamWordDefinition(word);
      streamRef.current = s;
      setState({ kind: 'streaming', word, partial: '' });

      (async () => {
        try {
          for await (const tok of s.tokens) {
            setState((cur) =>
              cur.kind === 'streaming' && cur.word === word
                ? { ...cur, partial: cur.partial + tok }
                : cur,
            );
          }
          const full = await s.done;
          setState({ kind: 'done', word, full });
          try {
            await insertVocab({ word, definition: full });
          } catch (err) {
            console.warn('insertVocab failed:', err);
            toast.error('Could not save to dictionary.');
          }
        } catch (err) {
          if ((err as Error).message === 'aborted') {
            setState({ kind: 'aborted' });
          } else {
            console.error(err);
            setState({ kind: 'aborted' });
          }
        }
      })();
    };

    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [currentBookId, insertVocab]);

  function dismiss() {
    if (state.kind === 'streaming') {
      streamRef.current?.abort();
      setState({ kind: 'aborted' });
    } else {
      setState({ kind: 'idle' });
    }
  }

  // After 'aborted' or 'done' fades, return to idle.
  useEffect(() => {
    if (state.kind === 'aborted' || state.kind === 'done') {
      const t = setTimeout(() => setState({ kind: 'idle' }), 350);
      return () => clearTimeout(t);
    }
  }, [state.kind]);

  const visible = state.kind === 'streaming' || state.kind === 'done';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="dict-modal"
          role="dialog"
          aria-label="Dictionary"
          className="fixed left-1/2 top-8 z-50 max-w-[560px] -translate-x-1/2 rounded-lg border border-amber-100 bg-white/70 p-6 shadow-lg backdrop-blur-md"
          initial={{ opacity: 0, y: -40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={dismiss}
        >
          <p className="font-serif text-[22px] text-ink">
            {state.kind === 'streaming' ? state.word : state.kind === 'done' ? state.word : ''}
          </p>
          <hr className="my-2 border-stone-200" />
          <p className="text-base text-ink/80">
            {state.kind === 'streaming' ? state.partial : state.kind === 'done' ? state.full : ''}
            {state.kind === 'streaming' && <span className="animate-pulse">▌</span>}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

**Mounted from `ReaderScreen`** (already wired in Task 31's edit).

**Verify:** §14 steps 13, 14.

**Commit:** `Phase 2: DictionaryModal`

---

### Task 33 — `FloatingLogoInput.tsx`

**File:** `src/screens/Reader/FloatingLogoInput.tsx`.

```tsx
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { Feather } from 'lucide-react';

export function FloatingLogoInput() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  const onSubmit = () => {
    setText('');
    setOpen(false);
    toast.message('AI features arriving in Phase 3.');
  };

  return (
    <AnimatePresence mode="wait">
      {!open ? (
        <motion.button
          key="circle"
          layoutId="floating-logo"
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-cream shadow-lg"
          aria-label="Ask Scholara"
        >
          <Feather className="h-5 w-5 text-ink" />
        </motion.button>
      ) : (
        <motion.div
          key="input"
          layoutId="floating-logo"
          className="flex h-14 w-[80vw] items-center rounded-full border border-white/30 bg-white/40 px-5 backdrop-blur-md shadow-lg"
        >
          <input
            autoFocus
            type="text"
            value={text}
            placeholder="Ask anything…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmit();
              if (e.key === 'Escape') { setText(''); setOpen(false); }
            }}
            onBlur={() => setOpen(false)}
            className="w-full bg-transparent text-base outline-none placeholder:text-ink-muted"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

**Verify:** §14 step 18.

**Commit:** `Phase 2: FloatingLogoInput`

---

### Task 34 — Annotation modules

**Files:** `src/screens/Reader/annotations/EpubAnnotations.ts`, `src/screens/Reader/annotations/PdfAnnotations.ts`.

**`EpubAnnotations.ts`:**

```ts
import type { Rendition } from 'epubjs';
import type { NoteRow } from '../../../db/types';
import { ORANGE, ANNOTATION_UNDERLINE_PX } from '../../../lib/theme';
import { isQuoteRange } from '../../../lib/positionShape';

export function applyEpubAnnotations(
  rendition: Rendition,
  notes: NoteRow[],
): { detach(): void } {
  // epub.js doesn't expose a direct "clear all" of underlines added programmatically,
  // so we track our own ids and remove them on detach.
  const cfis: string[] = [];

  for (const note of notes) {
    if (!note.quote_text) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(note.page_or_position); } catch { continue; }
    if (!isQuoteRange(parsed)) continue;
    const range = parsed as { start: { type: string; locator: string }; end: { locator: string } };
    if (range.start.type !== 'epub') continue;
    const cfi = `${range.start.locator},${range.end.locator}`;
    cfis.push(cfi);

    rendition.annotations.add(
      'underline',
      cfi,
      { noteId: note.id },
      undefined,
      'scholara-quote-underline',
      {
        'text-decoration-color': ORANGE,
        'text-decoration-thickness': `${ANNOTATION_UNDERLINE_PX}px`,
      },
    );
  }

  // Subscript counts at chapter granularity for position-only notes — Phase 2 omits
  // the in-spine <sup> injection (epub.js doesn't expose a clean injection point
  // mid-rendered-content). We surface position-only note counts via the Notes tab
  // instead. The visible spec contract for EPUB position-only notes is satisfied
  // by the agent panel's Notes tab — which lists every note with its label.

  return {
    detach: () => {
      for (const cfi of cfis) {
        try { rendition.annotations.remove(cfi, 'underline'); } catch { /* ignore */ }
      }
    },
  };
}
```

**Note:** the spec (§9.2) describes a final-word `<sup>` for EPUB. epub.js's annotation callback runs after each iframe render and can inject DOM into the contents document — implementing it correctly requires per-iframe contentDocument access. Phase 2 ships **without** the EPUB final-word subscript (the underline alone is the visible quote indicator); the Notes tab provides the count UX. This is a deliberate scope trim — call out in the verify note for §14 step 9.

**`PdfAnnotations.ts`:**

```ts
import type { NoteRow } from '../../../db/types';
import { ORANGE, ANNOTATION_UNDERLINE_PX, SUBSCRIPT_INLINE_STYLE } from '../../../lib/theme';
import { pdfRectToViewportRect, type ViewportLike } from '../../../lib/pdfRectTransform';
import { isQuoteRange } from '../../../lib/positionShape';

export function applyPdfAnnotations(
  pageNumber: number,
  pageContainer: HTMLElement,
  pageViewport: ViewportLike & { width: number; height: number },
  notes: NoteRow[],
): void {
  pageContainer.querySelectorAll('.scholara-annotation').forEach((n) => n.remove());

  let positionNoteCount = 0;
  let lastQuoteRectOnThisPage: { x: number; y: number; w: number; h: number } | null = null;
  let lastQuoteIsFinalPage = false;

  for (const note of notes) {
    let parsed: unknown;
    try { parsed = JSON.parse(note.page_or_position); } catch { continue; }

    if (note.quote_text && isQuoteRange(parsed)) {
      const range = parsed as { start: { type: string; locator: number };
                                end:   { locator: number };
                                pages: Array<{ page: number; rects: Array<{ x: number; y: number; w: number; h: number }> }> };
      if (range.start.type !== 'pdf') continue;
      const onThisPage = range.pages.find((p) => p.page === pageNumber);
      if (!onThisPage) continue;

      for (const r of onThisPage.rects) {
        const view = pdfRectToViewportRect(r, pageViewport);
        const underline = document.createElement('div');
        underline.className = 'scholara-annotation scholara-quote-underline';
        underline.style.cssText = [
          'position: absolute',
          `left: ${view.x}px`,
          `top: ${view.y + view.h - ANNOTATION_UNDERLINE_PX}px`,
          `width: ${view.w}px`,
          `height: ${ANNOTATION_UNDERLINE_PX}px`,
          `background: ${ORANGE}`,
          'pointer-events: auto',
          'cursor: pointer',
        ].join(';');
        underline.dataset.noteId = String(note.id);
        pageContainer.appendChild(underline);

        if (onThisPage === range.pages[range.pages.length - 1]) {
          lastQuoteRectOnThisPage = view;
          lastQuoteIsFinalPage = true;
        }
      }
    } else if (!note.quote_text && parsed && typeof parsed === 'object'
               && (parsed as { type?: string }).type === 'pdf'
               && (parsed as { locator?: number }).locator === pageNumber) {
      positionNoteCount += 1;
    }
  }

  if (lastQuoteRectOnThisPage && lastQuoteIsFinalPage) {
    const sup = document.createElement('span');
    sup.className = 'scholara-annotation';
    Object.assign(sup.style, {
      position: 'absolute',
      left: `${lastQuoteRectOnThisPage.x + lastQuoteRectOnThisPage.w + 2}px`,
      top:  `${lastQuoteRectOnThisPage.y - 2}px`,
      ...SUBSCRIPT_INLINE_STYLE,
    });
    sup.textContent = '1';
    pageContainer.appendChild(sup);
  }

  if (positionNoteCount > 0) {
    const sup = document.createElement('span');
    sup.className = 'scholara-annotation';
    Object.assign(sup.style, {
      position: 'absolute',
      right: '8px',
      top:   '8px',
      ...SUBSCRIPT_INLINE_STYLE,
    });
    sup.textContent = String(positionNoteCount);
    pageContainer.appendChild(sup);
  }
}
```

**Verify:** §14 step 9 (orange underline appears after save), step 11 (subscript count for body-only notes), step 23 (cross-page quote — Playwright covers this).

**Commit:** `Phase 2: annotation modules for EPUB and PDF`

---

### Task 35 — Agent panel tabs

**Files:**
- `src/screens/Reader/agentPanel/AgentPanel.tsx`
- `src/screens/Reader/agentPanel/AiChatTab.tsx`
- `src/screens/Reader/agentPanel/NotesTab.tsx`
- `src/screens/Reader/agentPanel/HighlightsTab.tsx`
- `src/screens/Reader/agentPanel/DictionaryTab.tsx`

**`AgentPanel.tsx`:**

```tsx
import { useState } from 'react';
import type { Book } from '../../../db/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AiChatTab } from './AiChatTab';
import { NotesTab } from './NotesTab';
import { HighlightsTab } from './HighlightsTab';
import { DictionaryTab } from './DictionaryTab';

interface Props { book: Book; }

export function AgentPanel({ book }: Props) {
  const [tab, setTab] = useState('chat');
  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col">
      <TabsList className="m-2">
        <TabsTrigger value="chat">AI Chat</TabsTrigger>
        <TabsTrigger value="notes">Notes</TabsTrigger>
        <TabsTrigger value="highlights">Highlights</TabsTrigger>
        <TabsTrigger value="dictionary">Dictionary</TabsTrigger>
      </TabsList>
      <TabsContent value="chat"       className="flex-1 overflow-y-auto p-4"><AiChatTab /></TabsContent>
      <TabsContent value="notes"      className="flex-1 overflow-y-auto p-4"><NotesTab book={book} /></TabsContent>
      <TabsContent value="highlights" className="flex-1 overflow-y-auto p-4"><HighlightsTab book={book} /></TabsContent>
      <TabsContent value="dictionary" className="flex-1 overflow-y-auto p-4"><DictionaryTab book={book} /></TabsContent>
    </Tabs>
  );
}
```

If the project's shadcn install doesn't yet include `Tabs`, add it: `npx shadcn@latest add tabs`. Confirm by reading [components.json](components.json) and [src/components/ui/](src/components/ui/) before assuming. If not present, run the command before this task.

**`AiChatTab.tsx`:**

```tsx
export function AiChatTab() {
  return (
    <div className="flex h-full items-center justify-center text-center">
      <p className="font-serif text-lg text-ink-muted">AI mentor coming soon.</p>
    </div>
  );
}
```

**`NotesTab.tsx`:**

```tsx
import { Trash2 } from 'lucide-react';
import { useAppStore } from '../../../store';
import type { Book } from '../../../db/types';

interface Props { book: Book; }

export function NotesTab({ book: _book }: Props) {
  const notes = useAppStore((s) => s.currentBookNotes);
  const del   = useAppStore((s) => s.deleteNote);
  if (notes.length === 0) {
    return <p className="text-sm text-ink-muted">No notes yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {notes.map((n) => {
        let label = '';
        try { label = (JSON.parse(n.page_or_position).label as string) ?? ''; } catch { /* ignore */ }
        if (!label) {
          try {
            const parsed = JSON.parse(n.page_or_position);
            if (parsed?.start?.label) label = parsed.start.label;
          } catch { /* ignore */ }
        }
        return (
          <li key={n.id} className="rounded border border-stone-200 bg-cream p-3">
            {n.quote_text && <p className="mb-2 text-sm italic text-ink/80">&ldquo;{n.quote_text}&rdquo;</p>}
            {n.note_text  && <p className="text-sm text-ink">{n.note_text}</p>}
            <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
              <span>{label}</span>
              <button type="button" aria-label="Delete note" onClick={() => void del(n.id)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
```

**`HighlightsTab.tsx`:** identical to `NotesTab` but filter notes to `n.quote_text !== null`. Extract the rendering as a shared subcomponent if you want; YAGNI says copy three lines:

```tsx
import { useAppStore } from '../../../store';
import type { Book } from '../../../db/types';
import { NotesTab } from './NotesTab';

export function HighlightsTab({ book }: { book: Book }) {
  const notes = useAppStore((s) => s.currentBookNotes).filter((n) => n.quote_text !== null);
  if (notes.length === 0) {
    return <p className="text-sm text-ink-muted">No highlights yet.</p>;
  }
  // Reuse NotesTab visual via a temporary store override is overkill — duplicate the list
  // rendering inline. For brevity, keep it simple:
  return (
    <ul className="flex flex-col gap-3">
      {notes.map((n) => (
        <li key={n.id} className="rounded border border-stone-200 bg-cream p-3">
          <p className="text-sm italic text-ink/80">&ldquo;{n.quote_text}&rdquo;</p>
          {n.note_text && <p className="mt-2 text-sm text-ink">{n.note_text}</p>}
        </li>
      ))}
    </ul>
  );
}
```

**`DictionaryTab.tsx`:**

```tsx
import { Trash2 } from 'lucide-react';
import { useAppStore } from '../../../store';

export function DictionaryTab({ book: _book }: { book: import('../../../db/types').Book }) {
  const vocab = useAppStore((s) => s.currentBookVocab);
  const del   = useAppStore((s) => s.deleteVocabulary);
  if (vocab.length === 0) {
    return <p className="text-sm text-ink-muted">No saved words yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {vocab.map((v) => (
        <li key={v.id} className="rounded border border-stone-200 bg-cream p-3">
          <div className="flex items-center justify-between">
            <p className="font-serif text-base text-ink">{v.word}</p>
            <button type="button" aria-label="Delete word" onClick={() => void del(v.id)}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1 text-sm text-ink/80">{v.definition}</p>
        </li>
      ))}
    </ul>
  );
}
```

**Verify:** §14 steps 9–14, 16, 17.

**Commit:** `Phase 2: agent panel tabs`

---

### Task 36 — Wire `DeleteBookDialog` to also call `deleteBookFiles`

**File:** `src/screens/Library/DeleteBookDialog.tsx`.

**Replace `handleDelete`:**

```tsx
import { deleteBookFiles } from '../../ipc/files';

const handleDelete = async () => {
  try {
    try {
      await deleteBookFiles(book.id, book.file_path);
    } catch (err) {
      console.warn('deleteBookFiles failed (continuing):', err);
      toast.warning('Could not remove files from disk; database row will still be deleted.');
    }
    await deleteBook(book.id);
    toast.success('Deleted.');
    onClose();
  } catch (err) {
    toast.error(`Could not delete: ${(err as Error).message}`);
  }
};
```

**Verify:** §14 step 22 — deleting a book removes the row, the file, the cover.

**Commit:** `Phase 2: DeleteBookDialog calls deleteBookFiles`

---

### Task 37 — Trigger extraction pass on upload

**File:** `src/screens/Library/index.tsx`.

**Add to the drag-drop handler** (inside the `for (const p of paths)` loop, after `insertBook`):

```tsx
const runPass = useAppStore((s) => s.runMetadataExtractionPass);
// ...
const book = await insertBook({ title, file_path: storedPath, file_type: fileType });
toast.success(`Added "${book.title}"`, {
  action: { label: 'Edit', onClick: () => setEditing(book) },
});
void runPass();   // fire-and-forget — newly inserted book is filename-source.
```

If `AddBookButton.tsx` also has a click-to-add path, mirror the call there. Read [src/screens/Library/AddBookButton.tsx](src/screens/Library/AddBookButton.tsx) before editing.

**Verify:** §14 step 5 — drop an EPUB, see the cover crossfade and author appear within 1–2 seconds.

**Commit:** `Phase 2: trigger extraction after upload`

---

### Task 38 — Playwright config + IPC mock

**Files:** `playwright.config.ts` (new), `tests/playwright/mocks/ipc.ts` (new), `tests/playwright/mocks/db.ts` (new), `package.json` (add `test:e2e` scripts).

**`playwright.config.ts`:**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/playwright',
  timeout: 30_000,
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

**Important:** `npm run preview` only works after `npm run build`. The Playwright `webServer` block runs `preview`; we need a separate `prebuild` step. Update `package.json`:

```json
"scripts": {
  "test:e2e": "npm run build && playwright test",
  "test:e2e:ui": "npm run build && playwright test --ui",
  "test:all": "vitest run && npm run test:e2e"
}
```

**`tests/playwright/mocks/ipc.ts`:**

```ts
// Injected into the page before app code runs. Patches @tauri-apps/api/core's invoke.
export const IPC_INIT_SCRIPT = `
  (() => {
    const fixtures = window.__SCHOLARA_FIXTURES__ ?? {};
    const handlers = {
      read_book_bytes: ({ path }) => Array.from(new Uint8Array(fixtures[path] ?? [])),
      save_cover_bytes: () => '/mock/cover.png',
      delete_book_files: () => null,
      copy_uploaded_file: ({ sourcePath }) => ({
        stored_path: sourcePath,
        file_type: sourcePath.endsWith('.epub') ? 'epub' : 'pdf',
      }),
      app_data_dir_path: () => '/mock/app-data',
      reveal_in_file_manager: () => null,
      get_api_key: () => null,
      set_api_key: () => null,
    };
    // Tauri 2 invoke goes through a global postMessage; the simplest reliable
    // mock is to patch the module loader once @tauri-apps/api/core is imported.
    const realImport = window.__import || ((s) => import(s));
    window.__import = async (s) => {
      const mod = await realImport(s);
      if (s.includes('@tauri-apps/api/core')) {
        return new Proxy(mod, {
          get(t, p) {
            if (p === 'invoke') {
              return async (cmd, args) => {
                const h = handlers[cmd];
                if (!h) throw new Error('Unhandled mock IPC: ' + cmd);
                return h(args ?? {});
              };
            }
            if (p === 'convertFileSrc') {
              return (path) => 'file://' + path;
            }
            return Reflect.get(t, p);
          },
        });
      }
      return mod;
    };
  })();
`;
```

**Reality check on the mock:** Tauri's `invoke` is bundled, and Vite's preview build replaces the import path. The Proxy-on-`__import` approach above is illustrative but fragile. The pragmatic alternative is to **build a test-only entry point** in `src/main.test.tsx` that imports a stub `invoke` from `tests/playwright/mocks/tauriCore.ts`, and have `vite.config.ts` alias `@tauri-apps/api/core` to the stub when an env var is set.

**Concrete mock plan** (replaces the script-injection approach):

1. `vite.config.ts` — read `process.env.VITE_E2E === '1'` and alias `@tauri-apps/api/core` to a stub:

   ```ts
   resolve: {
     alias: {
       '@': path.resolve(__dirname, './src'),
       ...(process.env.VITE_E2E === '1'
         ? { '@tauri-apps/api/core': path.resolve(__dirname, './tests/playwright/mocks/tauriCore.ts') }
         : {}),
     },
   },
   ```

2. `tests/playwright/mocks/tauriCore.ts`:

   ```ts
   const fixtures: Record<string, ArrayBuffer> = (globalThis as any).__SCHOLARA_FIXTURES__ ?? {};

   const handlers: Record<string, (args: any) => any> = {
     read_book_bytes:        ({ path }) => Array.from(new Uint8Array(fixtures[path] ?? new ArrayBuffer(0))),
     save_cover_bytes:       () => '/mock/cover.png',
     delete_book_files:      () => null,
     copy_uploaded_file:     ({ sourcePath }) => ({
       stored_path: sourcePath,
       file_type: sourcePath.endsWith('.epub') ? 'epub' : 'pdf',
     }),
     app_data_dir_path:      () => '/mock/app-data',
     reveal_in_file_manager: () => null,
     get_api_key:            () => null,
     set_api_key:            () => null,
   };

   export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
     const h = handlers[cmd];
     if (!h) throw new Error('Unhandled mock IPC: ' + cmd);
     return h(args ?? {}) as T;
   }
   export function convertFileSrc(p: string): string { return 'file://' + p; }
   ```

3. `tests/playwright/mocks/db.ts` — alias `@tauri-apps/plugin-sql` similarly to a stub backed by `better-sqlite3`. The stub exports a `default` class with `load`, `execute`, `select`. Phase 2 only exercises read/write paths already covered by Vitest, so a minimal implementation is fine.

4. `playwright.config.ts` — set the env:

   ```ts
   webServer: {
     command: 'VITE_E2E=1 npm run preview -- --port 4173 --strictPort',
     // ...
   },
   ```

**Verify:** `npm run test:e2e` boots a preview server, but no tests yet. The next tasks add specs.

**Commit:** `Phase 2: Playwright config + IPC/DB mocks`

---

### Task 39 — Playwright spec: `epub-reader.spec.ts`

**File:** `tests/playwright/epub-reader.spec.ts`.

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const EPUB = readFileSync(path.resolve(__dirname, '../fixtures/sample.epub'));

test.beforeEach(async ({ page }) => {
  await page.addInitScript((bytes) => {
    (window as any).__SCHOLARA_FIXTURES__ = { '/mock/sample.epub': bytes };
  }, Array.from(EPUB));
  await page.goto('/');
  // Insert a fake book row via test hook (see Task 41 — exposes window.__appTestHooks).
  await page.evaluate(() =>
    (window as any).__appTestHooks.seedBook({
      title: 'Sample Book', file_path: '/mock/sample.epub', file_type: 'epub',
    }),
  );
});

test('opens an EPUB and renders pages', async ({ page }) => {
  await page.getByRole('button', { name: /Open Sample Book/ }).click();
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 10_000 });
});

test('right arrow advances pages and persists position', async ({ page }) => {
  await page.getByRole('button', { name: /Open Sample Book/ }).click();
  await page.locator('iframe').first().waitFor();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(700);   // exceed 500ms debounce
  const pos = await page.evaluate(() =>
    (window as any).__appTestHooks.getCurrentPosition(),
  );
  expect(pos).toBeTruthy();
  expect(JSON.parse(pos).type).toBe('epub');
  expect(JSON.parse(pos).fraction).toBeGreaterThan(0);
});
```

**Test hook plan** (Task 41 below): expose a `__appTestHooks` global in the production bundle when `VITE_E2E === '1'`, with helpers `seedBook`, `getCurrentPosition`, `seedNote`, `getVocabulary`, etc.

**Verify:** `npm run test:e2e -- epub-reader` — both tests pass.

**Commit:** `Phase 2: Playwright epub-reader spec`

---

### Task 40 — Playwright spec: `pdf-reader.spec.ts`, `notes-mode.spec.ts`, `annotations.spec.ts`, `dictionary-modal.spec.ts`

These specs follow the same pattern as Task 39. Full code per spec is verbose; condensed structure:

**`pdf-reader.spec.ts`** — seed sample.pdf, open, expect at least two `<canvas>` elements. Scroll to a known offset, wait 700ms, assert `getCurrentPosition()` returns `{type: 'pdf', locator: <expected>}`.

**`notes-mode.spec.ts`** — seed sample.epub, open, press `n`, expect quill to have `fill: ORANGE`. Use `page.evaluate` to programmatically set a selection inside the EPUB iframe (epub.js's selection event is what we listen to; tests can dispatch a synthetic `scholara:set-quote` event to bypass the iframe selection complexity). Type into the note input, click save, then assert via `__appTestHooks.listNotes()` that a row exists.

**`annotations.spec.ts`** — seed an EPUB *with a pre-saved note* (`__appTestHooks.seedNote`), open the book, expect a `.scholara-quote-underline` with the orange `text-decoration-color` style. For PDF, expect a `div.scholara-quote-underline` with `background: rgb(200, 112, 44)`. Cross-page case: use `cross-page.pdf` fixture, seed a quote spanning pages 1–2, scroll to each page, assert per-page underlines, assert the `<sup>` is present only on page 2.

**`dictionary-modal.spec.ts`** — seed an EPUB, open, dispatch `scholara:open-dictionary` via `page.evaluate` to bypass the toolbar. Wait for the modal `[role="dialog"][aria-label="Dictionary"]` and assert its text grows over consecutive samples. Wait for stream completion, click the modal, expect it to disappear, then assert `__appTestHooks.listVocabulary()` contains the word. Mid-stream click test: dispatch open, wait 100ms, click, assert vocab list is empty.

**Each spec lives in its own file** so individual failures isolate. Commit after each spec passes.

**Commits (one per spec):**
- `Phase 2: Playwright pdf-reader spec`
- `Phase 2: Playwright notes-mode spec`
- `Phase 2: Playwright annotations spec`
- `Phase 2: Playwright dictionary-modal spec`

---

### Task 41 — `__appTestHooks` global for Playwright

**File:** `src/main.tsx` (extend) or new `src/testHooks.ts` imported only when `import.meta.env.VITE_E2E === '1'`.

**`src/testHooks.ts`:**

```ts
import { useAppStore } from './store';
import { getDb } from './db/client';
import * as booksDb from './db/books';
import * as notesDb from './db/notes';
import * as vocabDb from './db/vocabulary';

export function installTestHooks() {
  if (!(import.meta as ImportMeta).env.VITE_E2E) return;

  (window as unknown as { __appTestHooks: object }).__appTestHooks = {
    async seedBook(input: { title: string; file_path: string; file_type: 'epub' | 'pdf' }) {
      const db = await getDb();
      await booksDb.insertBook(db, { ...input, author: null });
      await useAppStore.getState().loadBooks();
    },
    async seedNote(input: { book_id: number; page_or_position: string; note_text: string | null; quote_text: string | null }) {
      const db = await getDb();
      await notesDb.insertNote(db, input);
      await useAppStore.getState().reloadNotesForCurrentBook();
    },
    getCurrentPosition() {
      const id = useAppStore.getState().currentBookId;
      const book = useAppStore.getState().books.find((b) => b.id === id);
      return book?.current_position ?? null;
    },
    async listNotes(bookId: number) {
      const db = await getDb();
      return notesDb.listNotesForBook(db, bookId);
    },
    async listVocabulary() {
      const db = await getDb();
      return vocabDb.listAllVocabulary(db);
    },
  };
}
```

**`src/main.tsx`** — call `installTestHooks()` once on boot:

```tsx
import { installTestHooks } from './testHooks';
installTestHooks();
```

**Verify:** Tasks 39, 40 specs pass.

**Commit:** `Phase 2: install test hooks under VITE_E2E flag`

---

### Task 42 — Final verification pass

**Steps:**

1. **Lint:**
   ```bash
   npm run lint
   ```
   Zero errors. Warnings acceptable only if pre-existing in Foundation.

2. **Type-check + production build:**
   ```bash
   npm run build
   ```
   Compiles cleanly.

3. **Vitest:**
   ```bash
   npm test
   ```
   All Foundation + Phase 2 unit/DB tests pass.

4. **Playwright:**
   ```bash
   npm run test:e2e
   ```
   All five specs pass.

5. **Combined:**
   ```bash
   npm run test:all
   ```
   Both runners green.

6. **Manual smoke** — work through every numbered item in spec §14 (1–24) on `npm run tauri:dev`. Pay especially close attention to:
   - **§14 step 3:** `tauri:dev` launches into Library; no migration error in the dev console.
   - **§14 step 4:** existing books backfill covers + authors with crossfade.
   - **§14 step 6, 7:** open EPUB / PDF, navigate, position persists across reopen.
   - **§14 step 9, 11:** orange annotations and subscript counts render correctly.
   - **§14 step 13:** dictionary modal streams placeholder, auto-saves, item appears in Dictionary tab.
   - **§14 step 15:** all four selection-toolbar cases.
   - **§14 step 23:** cross-page PDF quote — both pages show the underline; subscript only on page 2.

7. **Tauri build smoke:**
   ```bash
   npm run tauri:build
   ```
   Produces an installable bundle. On a clean install (or by removing `~/Library/Application Support/com.scholara.app` on macOS), launching the bundle:
   - Runs migrations 1 and 2 cleanly.
   - Library renders empty.
   - Adding a book and walking through verification steps 1–23 succeeds.

**Commit:** `Phase 2: complete verification` (or no commit if all green).

---

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-05-reader-implementation.md`.**

**1. Subagent-Driven Development** — dispatch a fresh subagent per task, review between tasks, fast iteration.
