# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is Scholara

Scholara is an offline-first desktop reading and study app — Google NotebookLM for long-term, deep reading. Users upload a PDF or EPUB once and return to it at any time with their notes, vocabulary, and a streaming AI study mentor. Target audience: readers working through complex, dense, or historical texts.

## Hard Constraints — Never Violate

- **Stack:** Tauri + TypeScript + React. No deviations.
- **Styling:** shadcn/ui + Tailwind CSS. Light mode only — no dark mode.
- **Database:** SQLite via `tauri-plugin-sql` exclusively.
- **File system:** All FS operations go through Tauri IPC (`invoke`). No direct Node.js or browser FS access.
- **LLM:** OpenRouter via the Rust `chat_stream` / `chat_oneshot` Tauri commands, hitting OpenRouter's OpenAI-compatible `/v1/chat/completions` endpoint. Default model is a curated free tool-capable model (see `src/agent/models.ts`); user-selectable in Settings → AI Mentor. Streaming enabled.
- **Streaming:** Every LLM response streams token-by-token.
- **Auth:** No accounts, no authentication, no online backend.
- **API key:** User-provided OpenRouter API key stored in the OS keychain via `getSecret('openrouter')` / `setSecret('openrouter')`. The renderer never holds the raw key — all OpenRouter HTTP traffic goes through Rust. Any pre-existing `anthropic_api_key` entry from earlier builds is no longer addressable from the app and is left orphaned in the OS keychain by design.
- **Secrets:** All keychain-backed secrets go through `getSecret(name)` / `setSecret(name)`. Service is `"scholara"`; account is the `name` argument.
- **Platform:** Cross-platform (macOS, Windows, Linux). All IPC and file paths must be cross-platform.
- **No SSR.**

## Build & Dev Commands

```
npm run tauri dev      # development
npm run tauri build    # production build
npm test               # tests
npm run lint           # lint
```

## Development Conventions

When a user requests new features: If large, involves a complex/complicated implementation, or more than one new feature, separate the work into smaller tasks implement using subagent-driven development.

Act as main orchestrator and reviewer. You must have your own understanding of the relevant files and expected final state.
Require subagents to identify the functionality that causes current behavior and then present a very concise implementation plan for your review.

Codex MUST pause before implementation and state that this requires subagent-driven development.

Codex should then ask for explicit approval to use subagents if the current environment requires user permission for delegation.

Required sequence:

1. Main agent reads relevant files and forms its own understanding.
2. Main agent decomposes the work into small, independent tasks.
3. Subagents inspect assigned areas and return:
   - current behavior/root cause,
   - concise implementation plan,
   - files likely affected.
4. Main agent reviews the plans.
5. Only after approval, orchestrator orders subagents to begin implementation.
6. Main agent reviews and approves results.

## Debugging Rules

- When tasked with fixing, recognizing, or finding a bug, you MUST present the issue, consider the root cause of the bug symptom, and present the issue + plan.
- Only after a plan is approved can you move on to implementing fixes.
- When a request includes both bug fixes and feature work, the subagent gate runs first.
  The debugging issue/root-cause/plan requirement is satisfied through the main agent’s reviewed plan after subagents report back.

## Version Control

- Always commit when:

* bug fix complete
* significant plan/spec written
* new feature implemented
* significant task/set of tasks completed in a large feature implementation

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

The Reader Agent (AI Chat tab) is a streaming, per-book study mentor. It runs OpenRouter's OpenAI-compatible Chat Completions API via the Rust `chat_stream` / `chat_oneshot` Tauri commands (default model is the first entry of `src/agent/models.ts`, user-selectable). Implementation details:

- **Embeddings:** the bundled `Xenova/all-MiniLM-L6-v2` ONNX model runs locally via transformers.js. No embedding traffic leaves the device.
- **RAG store:** `book_chunks` (SQLite) — text + 384-dim embeddings indexed once per book on first AI Chat open. Index lifecycle is tracked in `book_index_state` (`pending` / `indexing` / `ready` / `error`).
- **Tools exposed to the model:** `search_book` (semantic + keyword retrieval over the current book) and `search_notes` (the user's own notes/quotes for this book). Web search is deferred.
- **Spoiler Mode:** per-thread toggle. When enabled, `search_book` is capped at the user's current reading position (PDF: page ≤ current; EPUB: spine ordinal ≤ current) — the spoiler guard filters chunks by ordinal before retrieval.
- **Background updaters:** `autoTitle` names threads after the first assistant turn; `profileUpdater` maintains a per-book and global "reader profile" used in subsequent system prompts.
- **Persistence:** multi-thread per book in `threads` and `messages`. The renderer never sees the API key — Rust holds it via the OS keychain.

System prompt always includes: current book + position, current page text, user's notes and vocabulary for this book, reader preferences, and the global + per-book reader profile.

Reference: `docs/superpowers/specs/2026-05-08-ai-chat-design.md`.

### Settings Screen

Accessible from Library. Allows user to enter/save their OpenRouter API key and view the app's internal documents directory path.

### Offline Behavior

Core reading, notes, and vocabulary work fully offline. LLM features attempted while offline show a non-blocking toast: _"Connect to the internet to use AI features."_

## Deferred Features (Out of Scope)

- Brain particle animation (WebGL/Three.js) — reserve the top-right space with a placeholder div.
- Daily AI insights / push notifications.

## Tech Decisions Left Open

- PDF and EPUB rendering library — choose the most mature, actively maintained option that integrates cleanly with React + Tauri. Document the choice with a brief comment in code.
