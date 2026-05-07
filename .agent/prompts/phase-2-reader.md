You are continuing work on Scholara, an offline-first Tauri + React + TypeScript desktop reading app.

Project root: /Users/creekrichmond/Documents/projects/scholara

Read first:
- Hard constraints, schema, architecture: CLAUDE.md lines 9–83
- Product spec for this phase: .claude/scholara-prompt.md lines 70–131 (Book Overlay, both modes) and lines 165–173 (Vocabulary / Dictionary)
- Open tech decision this phase must resolve: CLAUDE.md line 92 (PDF and EPUB rendering library)
- Visual inspo: .claude/inspo/ (Apple-Libraries / e-reader aesthetic)
- Foundation spec (Phase 1, complete): docs/superpowers/specs/2026-05-04-foundation-design.md
- Foundation plan: docs/superpowers/plans/2026-05-04-foundation-implementation.md — read §8 carefully, since the BookTile click currently no-ops with a "Reader coming next phase" toast that this phase wires into the Book Overlay.

You are starting **Phase 2: Reader**. Scope: PDF/EPUB rendering inside both Agent Display (80/20 split, with a placeholder AI Chat tab that Phase 3 fills) and Full Reader Display modes; per-book mode persistence via books.display_mode; Notes Mode (orange quill toggle, selection→quote, note text input); the orange annotation system (subscript counts for notes, thin underline + subscript on final word for quotes); word-selection → Add to Dictionary modal **shell** (Phase 3 supplies the streaming definition — define and stub a `streamWordDefinition(word)` function so Phase 3 can replace its body without touching call sites); auto-extract pass that populates `cover_image_path` and `author` for rows where metadata_source = 'filename', stamping metadata_source = 'extracted'.

Inherited contracts from Foundation (do not change without explicit approval):
- books.current_position and notes.page_or_position are TEXT holding opaque JSON — this phase defines the JSON shape per file_type for the first time.
- All FS through Rust IPC; never call @tauri-apps/api directly from components.
- Module boundaries: components → store → db/ + ipc/ → Tauri.
- The existing `<GeneratedCover imageSrc={...} />` prop is the integration point for real covers.

Change from foundation: 
- If available, populate cover image for book on the home library (via rendering library)

Use today's date for the YYYY-MM-DD filename prefix.

Run the brainstorming skill, then writing-plans. Save outputs to:
- docs/superpowers/specs/<today>-reader-design.md
- docs/superpowers/plans/<today>-reader-implementation.md

Do not invoke any skill between brainstorming and writing-plans. Do not write application code in this session — spec + plan documents only.
