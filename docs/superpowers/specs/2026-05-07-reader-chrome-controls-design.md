# Scholara - Reader Chrome Controls Design

**Date:** 2026-05-07
**Status:** Approved for design; pending implementation plan

---

## 1. Goal & Scope

Add four Reader Chrome features with precise placement and modal/popover design:

- Chapter-aware filtering for the Agent panel's Notes and Highlights tabs.
- A chapter/book index opened from the header chapter/progress area, with a Cover entry included.
- Reading text preferences opened from an `Aa` button near the display-mode toggle.
- A book search tool opened from a looking-glass button near the text preferences button.

The feature should preserve the existing two display modes: Agent Display (`1fr 22rem`) and Full Reader Display. The chrome should become explicit and stable rather than relying on `justify-between` spacing.

Out of scope:

- Persistent per-book typography sync across devices.
- OCR for scanned PDFs.
- PDF support for these new reader-chrome features. Chapter index, notes/highlights chapter filtering, text preferences, and text search are EPUB-only for this iteration.
- Text size/font modification for PDFs. The text preferences modal applies only to EPUB content for this iteration.
- Full search result highlighting across every renderer. Initial navigation to the match source is required; transient match emphasis is optional if it can be implemented without destabilizing selection/annotation behavior.

---

## 2. Approved Layout

### 2.1 Reader Chrome

Use an explicit three-zone layout:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Library  [☰] Chapter 4 · 37%                [split][book]  [Aa] [⌕] [✒]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Left zone:** `← Library`, then chapter-index trigger, then current chapter/progress text.
- **Center zone:** display-mode toggle. It must remain visually centered in the reader pane.
- **Right zone:** text preferences (`Aa`), search (`Search` icon), note mode (`Feather`).
- Long labels truncate in the left zone and never push the center or right controls.
- `ReaderChrome` should use its existing `variant` prop if split/fullscreen require small spacing differences.

### 2.2 Chapter Index Popover

Opened by the three-line icon next to the header chapter/progress label.

```text
┌───────────────────────────────┐
│ Contents                      │
├───────────────────────────────┤
│ ▣ Cover                       │
│ 01  Preface                   │
│ 02  Chapter 1                 │
│ 03  Chapter 2            18%  │
│ 04  Chapter 3            31%  │
│ 05  Chapter 4     current 37% │
└───────────────────────────────┘
```

Behavior:

- EPUB index is spine-first so cover/frontmatter can appear even if the EPUB TOC omits it. TOC labels are overlaid when available; otherwise use readable fallbacks.
- PDF index support is deferred. For PDFs, the chapter-index button should be hidden or disabled with a clear tooltip; do not build PDF page index behavior in this iteration.
- Clicking an item dispatches navigation through the existing `scholara:go-to-source` pattern.
- The header label should use the same position formatting path as notes, including EPUB page estimation when locations exist.

### 2.3 Notes/Highlights Chapter Scope

Visible only in Agent Display, and only when the Agent panel tab is `Notes` or `Highlights`.

```text
┌────────────────────────────────────┐
│ [AI Chat][Notes][Highlights][Dict] │
│                                    │
├────────────────────────────────────┤
│ ☰ All Notes                        │
│ note / highlight list              │
└────────────────────────────────────┘
```

Scope menu:

```text
┌───────────────────────────────┐
│ All Notes                 ✓   │
│ Cover                         │
│ Preface                       │
│ Chapter 1                     │
│ Chapter 2                     │
│ Chapter 3                     │
│ Chapter 4                     │
└───────────────────────────────┘
```

Behavior:

- The word `Filter` does not appear in the UI.
- The three-line icon sits directly to the left of the active scope label.
- The scope control sits in its own row below the tab header, left-aligned with the note/highlight list.
- Default scope is `All Notes`, displayed as `☰ All Notes`.
- A chapter scope is displayed as `☰ Chapter Twenty-One` or the chapter label supplied by the EPUB index.
- Selecting a chapter filters Notes and Highlights to the same reading bucket.
- Notes/highlights chapter filtering is EPUB-only for this iteration.
- EPUB bucket: spine/CFI section when available, with normalized label fallback.
- For PDFs, do not show the notes/highlights chapter scope control; PDF notes/highlights remain unfiltered.
- Highlights still apply their existing `quote_text !== null` filter before/after the chapter filter.
- Malformed note positions should not crash the panel; they remain visible under `All Notes` and are excluded from specific chapter scopes.

### 2.4 Text Preferences Modal

Opened from the `Aa` button in Reader Chrome.

```text
┌───────────────────────────────┐
│ Reading Text                  │
├───────────────────────────────┤
│ Size                          │
│  A-   [ 100% ]   A+           │
│                               │
│ Font                          │
│ [ Original ]                  │
│ [ Arial    ] [ Georgia ]      │
│ [ Iowan    ]                  │
└───────────────────────────────┘
```

Behavior:

- Size starts at `100%`. Controls should support at least a small range around the original size, such as `85%` to `130%`.
- Fonts: `Original`, `Arial`, `Georgia`, `Iowan`.
- EPUB applies size and font to the rendered book content through epub.js themes/content CSS.
- PDF text size/font modification is deferred. For PDFs, the `Aa` control should be hidden or disabled with a clear tooltip; do not implement PDF zoom/scale changes as part of this feature.
- Preferences may be global for the reader in this feature. Per-book persistence can be added later if needed.

### 2.5 Search Tool

Opened from the looking-glass button in Reader Chrome. Use a frosted/glass input style consistent with the Full Reader Display AI input.

```text
                 ┌──────────────────────────────────┐
                 │ ⌕  Search this book...           │
                 └──────────────────────────────────┘
                 ┌──────────────────────────────────┐
                 │ 1. Chapter 2 · ...matching text  │
                 │ 2. Chapter 4 · ...matching text  │
                 │ 3. Chapter 7 · ...matching text  │
                 └──────────────────────────────────┘
```

Behavior:

- Search is scoped to the current book.
- Search is EPUB-only for this iteration.
- Search runs against an in-memory EPUB index built while the book is open.
- Results are debounced and capped to keep the UI quick.
- Clicking a result navigates to the source using the existing navigation event where possible.
- Empty input shows no results. No matches shows a quiet empty state.
- For PDFs, the search control should be hidden or disabled with a clear tooltip; do not build PDF text search in this iteration.

---

## 3. Architecture

### 3.1 Shared Models

Add small shared types rather than binding chrome to EPUB/PDF internals:

```ts
interface ReaderNavItem {
  id: string;
  label: string;
  position: Position;
  kind: 'cover' | 'chapter';
  level?: number;
  progress?: number;
}

interface ReaderSearchResult {
  id: string;
  label: string;
  snippet: string;
  position: Position;
}

interface ReaderPreferences {
  fontScale: number;
  fontFamily: 'original' | 'arial' | 'georgia' | 'iowan';
}
```

The final implementation may adjust exact field names, but the boundary should remain: chrome consumes shared items and dispatches shared positions; renderers construct format-specific data.

### 3.2 Data Flow

- `ReaderChrome` renders controls and opens popovers/modals.
- `EpubReader` builds EPUB navigation/search data from spine/TOC/text and applies EPUB typography.
- `PdfReader` is not changed for navigation index, search, or text preferences in this iteration.
- A small store slice or event bridge exposes current navigation/search data to chrome. Use the least invasive option that stays testable.
- Existing `scholara:go-to-source` remains the navigation mechanism unless search match highlighting requires an additional event.

### 3.3 Notes Scope Data Flow

- `AgentPanel` owns the active tab and selected note filter.
- `NotesTab` and `HighlightsTab` receive or read the selected filter.
- `positionShape` grows helpers for reading bucket comparison:
  - Parse `book.current_position` safely.
  - Parse note `page_or_position` safely.
  - Extract the source position from a single position or quote range.
  - Compare EPUB CFI/spine section.

---

## 4. Implementation Decomposition

This requires subagent-driven development per `AGENT.md`.

Recommended task split:

1. **Reader Chrome controls and popover shell**
   - `ReaderChrome`, `ModeToggle`, new popover/modal components.
   - No renderer internals beyond consuming shared props/store.

2. **Navigation index**
   - Shared `ReaderNavItem` model.
   - EPUB spine-first index with Cover entry.
   - PDF index explicitly deferred.
   - Header label formatting update.

3. **Notes/Highlights chapter filtering**
   - Position comparison helpers.
   - Agent panel filter menu.
   - Notes and Highlights filtering.
   - PDF support explicitly deferred.

4. **Text preferences**
   - Preference state.
   - EPUB theme/font application.
   - PDF support explicitly deferred.

5. **Search**
   - EPUB text extraction and search helpers.
   - PDF search explicitly deferred.
   - Search overlay UI.
   - Result navigation.

Each subagent must first present current behavior/root cause, concise implementation plan, and likely affected files before editing. The orchestrator reviews plans before implementation starts.

---

## 5. Testing

Add focused unit tests for:

- `positionShape` bucket comparison for EPUB same section, quote ranges, malformed JSON.
- Search helper behavior for simple EPUB fixtures.

Add Playwright coverage for:

- Reader Chrome placement does not shift with a long chapter label.
- Chapter index opens, includes Cover, and jumps for EPUB.
- Notes/Highlights scope defaults to `All Notes`, omits the word `Filter`, and filters to a selected EPUB chapter.
- Text preferences modal opens and changes EPUB text size/font.
- Search opens, returns results, and clicking a result navigates.
- PDF reader does not show or does clearly disable the deferred EPUB-only controls, including the notes/highlights chapter scope control.

Manual verification:

- Agent Display and Full Reader Display both retain stable chrome placement.
- Existing notes mode, selection toolbar, dictionary modal, and EPUB page arrows still work.

---

## 6. Risks & Decisions

- **PDF deferral:** Do not implement chapter index, notes/highlights chapter filtering, search, or text size/font modification for PDFs in this iteration. PDF controls should be hidden or clearly disabled.
- **EPUB cover detection:** Some EPUBs represent cover/frontmatter differently. The index should always provide a first `Cover`/start entry even when the source file lacks an obvious cover chapter.
- **Search cost:** Full-book indexing should be in-memory and scoped to the open book. Debounce search and cap results.
- **Toolbar crowding:** Icon buttons must use stable dimensions and tooltips. Text truncation must be constrained to the left label area.
- **Navigation consistency:** Reuse `scholara:go-to-source` as the default jump path so notes, index, and search share behavior.

---

## 7. Spec Self-Review

- No unresolved placeholder fields remain.
- "Chapter" is explicitly defined for EPUB spine/CFI section; PDF support for all new reader-chrome features is deferred.
- PDF deferral is explicit.
- Default notes/highlights scope is explicit: `All Notes`.
- Cover entry behavior is explicit for EPUB; PDF index behavior is deferred.
- Implementation remains scoped to Reader Chrome and reader support data, with no unrelated database or backend changes required.
