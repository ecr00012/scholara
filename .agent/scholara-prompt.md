# Scholara — Vibe-Coding Session Prompt

## What You Are Building

**Scholara** is an offline-first desktop reading and study app — think Google NotebookLM, but purpose-built for long-term, deep reading. Users upload a book once and can return to it at any time with their notes, vocabulary, and full AI study mentor in tow. The primary audience is readers working through complex, dense, or historical texts.
---

## Hard Constraints (Never Violate These)

- **Stack:** Tauri + TypeScript + React. Do not deviate.
- **Styling:** shadcn/ui + Tailwind CSS. Light mode only. No dark mode.
- **Database:** SQLite via `tauri-plugin-sql`. No other storage layer.
- **File system access:** All file system operations must go through Tauri IPC commands (`invoke`). No direct Node.js or browser FS access.
- **LLM orchestration:** LangChain (TypeScript) wrapping the Anthropic API.
- **Model:** claude haiku only. No other model.
- **Streaming:** All LLM responses must stream in real time (token by token).
- **Auth:** No accounts, no authentication, no online backend of any kind.
- **API key:** User provides their own Anthropic API key. Store it locally (SQLite or secure Tauri store). Never hardcode it.
- **Platforms:** macOS, Windows, and Linux. All Tauri IPC and file path logic must be cross-platform.
- **No SSR.**

---

## Deferred — Do Not Build in This Session

- Graphic/animation on the home screen. Reserve the top-right space with a placeholder div.
- Daily AI insights / push notifications (future feature).

---

## Tech Decisions Left to You

- PDF and EPUB rendering library. Choose whichever is most mature, actively maintained, and integrates cleanly with React + Tauri. Document your choice with a brief comment.

---

## Database Schema

Design and initialize the following tables in SQLite on first launch:

- **books** — id, title, author, cover_image_path, file_path, file_type (pdf | epub), last_opened, current_position, display_mode (agent | reader)
- **vocabulary** — id, word, definition, book_id, created_at
- **notes** — id, book_id, page_or_position, note_text, quote_text (nullable), created_at
- **conversations** — id, book_id, role (user | assistant), content, created_at

---

## App Structure

### 1. Library (Home Screen)

The main landing page. Apple Libraries–inspired aesthetic — clean, professional, light.

**Layout:**
- Main content area: a grid of book tiles with cover art. Each tile is clickable and opens the book overlay.
- Top-right: a reserved placeholder `div` 
- Right panel (rightmost ~20%, below the placeholder): a circularly scrolling **Vocabulary / Notes / Quotes** strip.
  - Displays saved vocabulary words (with definition) and quotes, ordered by recency, looping continuously.
  - Clicking this panel opens a **Global Dictionary & Notes** modal:
    - **Dictionary tab:** all vocabulary words across all books.
    - **Notes & Quotes tab:** notes and quotes organized per book.

**Book upload:**
- A button (e.g., "Add Book") allows the user to select a PDF or EPUB from their file system via Tauri's file dialog (`dialog` plugin).
- The selected file is copied into the app's internal documents directory (Tauri app data dir) via IPC.
- Metadata (title, file path, cover if extractable) is written to the `books` table.

---

### 2. Book Overlay

Clicking a book tile opens the book overlay. The app persists which display mode (`agent` or `reader`) each book was last left in and restores it on open.

---

#### 2a. Agent Display Mode

**Layout:**
- Left 80%: full Apple-style e-reader panel.
- Right 20%: agent/info panel, switchable between four tabs:
  - **AI Chat** (default)
  - **Notes**
  - **Highlights**
  - **Dictionary** (vocabulary saved for this book)

**Reader panel behavior:**
- Renders the book content section-by-section (chapters for EPUB, scrollable pages for PDF). Not one large undivided scroll block.
- Word highlight → shows "Add to Dictionary" option → fetches definition via LLM → opens a top-of-screen modal displaying the definition. Tapping the modal fades it away.

**AI Chat panel behavior:**
- Full streaming chat interface. The conversation history for this book is persisted in the `conversations` table and reloaded on open.
- The agent has access to: the book text up to the user's current position, the user's notes for this book, and the user's vocabulary for this book.
- See **AI Agent Logic** section below for retrieval behavior.

**Notes Mode (Agent Display):**
- Activated by an **orange quill icon button** in the top-right of the agent panel.
- While active:
  - Text swiped/selected in the reader is appended to the current note as a **quote**.
  - A highlighted quote becomes the context focus of the AI chat agent.
  - A text input (styled consistently with the LLM input box) appears below the reader content for typing the note body.
  - Saving the note writes to the `notes` table and exits Notes Mode.
- Notes and quotes are independent — valid combinations: quote only, note only, quote + note.

**Annotations in reader:**
- When a note exists for a page/position, an **orange subscript number** is attached to that location (equal to the count of notes at that position).
- A saved quote is rendered with a **thin orange underline** across the entire quote span, with an **orange subscript** on the final word.

---

#### 2b. Full Reader Display Mode

**Layout:**
- Full-screen Apple-style e-reader. No side panel.

**Floating input (bottom-center):**
- A hovering circle at the bottom-center of the screen displays the Scholara logo.
- Clicking it expands horizontally into a full-width, rounded, transparent **"liquid glass"** text input (frosted glass effect using `backdrop-filter: blur`).
- The user types a question or command and submits.
- The streaming LLM response materializes in the **top 30% of the screen** as an overlay.
- Clicking anywhere on the response overlay fades it away.

**Notes Mode (Full Reader Display):**
- Activated by an **orange quill icon button** in the top-right of the screen.
- While active:
  - Text swiped/selected in the reader is appended to the current note as a **quote**.
  - A full-width liquid-glass text input (same style as the LLM input) appears for typing the note body.
  - Saving exits Notes Mode and writes to the `notes` table.

**Annotations:** same behavior as Agent Display — orange subscript numbers for notes, orange underline + subscript for quotes.

**Mode toggle:** a control is available in both displays to switch between Agent Display and Full Reader Display. The chosen mode is persisted per book in the `books` table.

---

## AI Agent Logic

The agent is built with LangChain (TypeScript) and uses `claude-sonnet-4-20250514` with streaming enabled.

### Tools available to the agent:

1. **RAG over read content** — retrieve relevant passages from the book up to the user's current reading position. Do not expose content beyond this position unless spoiler evaluation clears it (see below).
2. **RAG over full text** — retrieve from the entire book. Only invoked after spoiler evaluation determines it is safe.
3. **Web search** — invoked only when the question cannot be answered from the text. Use LangChain's web search tool integration.

### Spoiler evaluation logic:

Before responding, the agent must reason about whether the user's question risks exposing unread content. Evaluate based on:
- The nature of the question (interpretive, factual, confused, forward-looking?).
- The content type (fiction vs. non-fiction — fiction carries higher spoiler risk).
- The user's apparent intent.

If spoiler risk is present → restrict retrieval to content up to current position. Assist with interpretation, remind of earlier context, but do not reveal future plot or information.

If spoiler risk is absent → full-text RAG is permitted.

If neither RAG strategy can answer the question appropriately → invoke web search.

### Context always injected into agent system prompt:
- User's current book and position.
- User's notes for this book.
- User's vocabulary/dictionary for this book.

---

## Vocabulary / Dictionary Feature

- Selecting/highlighting a word in the reader surfaces an **"Add to Dictionary"** option.
- Triggering it opens a top-of-screen modal with the word's definition (fetched via LLM, streamed).
- The user can tap/click the modal to dismiss it with a fade-out animation.
- The word + definition is saved to the `vocabulary` table, associated with the current book.
- The Global Dictionary (accessible from the home screen panel) shows vocabulary across all books.
- This is not an LLM feature. This feature needs to use a popular english npm package or similar implementation.

---

## Settings Screen

A minimal settings panel (accessible from the Library screen) where the user can:
- Enter and save their Anthropic API key.
- View the app's internal documents directory path.

---

## Offline Behavior

- All core reading, notes, and vocabulary features work fully offline.
- If an LLM feature is attempted while offline, display a non-blocking toast/banner: *"Connect to the internet to use AI features."*

---

## What "Done" Looks Like for This Session

A working Tauri app where a user can:
1. Launch the app and see the Library screen.
2. Upload a PDF or EPUB — it appears as a tile.
3. Click the tile and read the book in both Agent Display and Full Reader Display.
4. Ask the AI agent a question and see a streaming response.
5. Save a note, save a quote, and save a vocabulary word.
6. Return to the Library and see saved vocabulary in the scrolling side panel.
7. Enter their Anthropic API key in Settings and have it persist.

