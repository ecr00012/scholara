# AGENT.md

This file provides guidance to Codex when working with code in this repository.

## What Is Scholara

Scholara is an offline-first desktop reading and study app — Google NotebookLM for long-term, deep reading. Users upload a PDF or EPUB once and return to it at any time with their notes, vocabulary, and a streaming AI study mentor. Target audience: readers working through complex, dense, or historical texts.

## Hard Constraints — Never Violate

- **Stack:** Tauri + TypeScript + React. No deviations.
- **Styling:** shadcn/ui + Tailwind CSS. Light mode only — no dark mode.
- **Database:** SQLite via `tauri-plugin-sql` exclusively.
- **File system:** All FS operations go through Tauri IPC (`invoke`). No direct Node.js or browser FS access.
- **LLM:** LangChain (TypeScript) wrapping the Anthropic API. Model: `claude-sonnet-4-20250514` only.
- **Streaming:** Every LLM response streams token-by-token.
- **Auth:** No accounts, no authentication, no online backend.
- **API key:** User-provided Anthropic API key stored locally (SQLite or Tauri secure store). Never hardcode.
- **Platform:** Cross-platform (macOS, Windows, Linux). All IPC and file paths must be cross-platform.
- **No SSR.**

## Build & Dev Commands

```
npm run tauri dev      # development
npm run tauri build    # production build
npm test               # tests
npm run lint           # lint
```


## Database Schema

Tables initialized on first launch:

- **books** — `id, title, author, cover_image_path, file_path, file_type (pdf|epub), last_opened, current_position, display_mode (agent|reader)`
- **vocabulary** — `id, word, definition, book_id, created_at`
- **notes** — `id, book_id, page_or_position, note_text, quote_text (nullable), created_at`
- **conversations** — `id, book_id, role (user|assistant), content, created_at`

## Architecture

### Screen 1 — Library (Home)

Apple Libraries–inspired grid of book tiles. Key layout details:
- **Top-right:** placeholder `div` for the deferred WebGL brain animation —
- **Right panel (~20%):** circularly scrolling vocabulary/notes/quotes strip (recency-ordered, looping). Clicking opens a Global Dictionary & Notes modal with a Dictionary tab (all books) and a Notes & Quotes tab (per book).
- **Add Book:** Tauri `dialog` plugin file picker → copy file to app data dir via IPC → write to `books` table.

### Screen 2 — Book Overlay (two modes, persisted per book)

**Agent Display** — 80% e-reader left, 20% agent panel right (tabs: AI Chat, Notes, Highlights, Dictionary).

**Full Reader Display** — full-screen reader. A hovering circle (logo) at bottom-center expands on click into a full-width frosted-glass (`backdrop-filter: blur`) text input. Streaming LLM response appears as an overlay in the top 30% of the screen and fades on click.

Both modes share:
- **Orange quill icon** → Notes Mode: selected text appends as a quote; a text input appears for the note body. Notes and quotes are independent (valid: quote only, note only, quote+note).
- **Annotations:** orange subscript count for notes at a position; thin orange underline + orange subscript on final word for saved quotes.
- **Word selection** → "Add to Dictionary" → top-of-screen modal with LLM-streamed definition → tap to fade/dismiss → saved to `vocabulary` table.

### AI Agent Logic

Built with LangChain (TypeScript) + `claude-sonnet-4-20250514`, streaming enabled.
(switch to haiku for implementation)

Three tools:
1. **RAG over read content** — passages up to user's current position.
2. **RAG over full text** — entire book; only after spoiler evaluation clears it.
3. **Web search** — LangChain web search tool; fallback when text can't answer the question.

**Spoiler evaluation** (run before every response): assess question type (interpretive/factual/forward-looking?), content type (fiction = higher risk), and user intent. If spoiler risk → restrict to read content. If no risk → full-text RAG allowed. If neither strategy suffices → web search.

System prompt always includes: current book + position, user's notes for this book, user's vocabulary for this book.

### Settings Screen

Accessible from Library. Allows user to enter/save their Anthropic API key and view the app's internal documents directory path.

### Offline Behavior

Core reading, notes, and vocabulary work fully offline. LLM features attempted while offline show a non-blocking toast: *"Connect to the internet to use AI features."*

## Deferred Features (Out of Scope)

- Brain particle animation (WebGL/Three.js) — reserve the top-right space with a placeholder div.
- Daily AI insights / push notifications.

## Tech Decisions Left Open

- PDF and EPUB rendering library — choose the most mature, actively maintained option that integrates cleanly with React + Tauri. Document the choice with a brief comment in code.


