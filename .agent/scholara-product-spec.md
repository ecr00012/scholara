# Scholara — Product Specification

## Pitch / Use Case

Google NotebookLM, but for consistent, long-term study and reading. Upload once, access the book or text and your notes at any time. Focused towards readers tackling complex, dense, or historical books — with a study mentor at the click of a button as the core feature.

Users can upload a book as a PDF or EPUB.

---

## Core Features

### Text Parsing & Display
- Uploaded text is parsed and indexed into a section-by-section (or chapter-by-chapter) readable format — not a single scroll block.
- PDFs render as a scrollable format; EPUBs render in a paginated format.

### Info Retrieval & AI Agent
The agent combines multiple retrieval strategies:

- **RAG over read content** — context-aware responses based on the user's current progress.
- **Spoiler evaluation** — if a user is confused, the agent will inform, assist with interpretation, and remind — but will NOT provide spoilers if that is a concern. Spoiler risk is evaluated based on the question, source content type, and user intention. If spoilers are not a concern, the agent may RAG over the entire text.
- **Web search** — triggered when the question cannot be appropriately answered from the text alone.

### Vocabulary / Dictionary
- Highlighting a word surfaces an option to **Add to Dictionary**.
- This opens a modal at the top of the screen (styled consistently with the LLM response overlay in full reader mode) displaying the word's definition.
- Tapping the modal fades it away.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri |
| Frontend | TypeScript + React (Three.js for animation) |
| LLM | Anthropic API (via LangChain) |

---

## Frontend Design

### Library (Home)

The main home screen is a modern, Apple Libraries–inspired **Library page**.

- Books are displayed as tiles with cover art, which are clickable and open the book overlay.
- **Top right** — A brain animation rendered via WebGL / Three.js or Particles.js:
  - Pink dot particles slowly shift, shaped like a brain.
  - On cursor hover, particles gradient-light up around the nearest dot.
  - Nearest dots immediately connect via small outreaching lines (simulating neuron firing).
- **Right panel** (rightmost ~20%, below the brain animation) — A circularly scrolling vocabulary / notes / quotes window:
  - Displays saved quotes and vocabulary words with definitions, ordered by recency.
  - Clicking the panel opens a dedicated component showing:
    - **Dictionary** — global across all books.
    - **Quotes & Notes** — organized per book.

---

### Book Overlay

The book overlay has two display modes. The app remembers which mode a book was last left in.

---

#### Agent Display

- The e-reader occupies **80% of the screen** on the left — full Apple-style reader.
- An agent chat panel occupies the **remaining 20%** on the right, switchable between:
  - AI agent chat
  - User's notes
  - Highlights
  - Saved vocabulary (Dictionary)

**Notes Mode (Agent Display)**
- A small **orange quill icon** in the top right of the chat panel activates Notes Mode.
- In Notes Mode:
  - Text swiped in the reader is appended to the note as a **quote**.
  - A highlighted quote becomes the focus of the chat agent.
  - A text box (styled like the LLM full-width text box) appears below the reader text for typing notes.
  - Saving a note exits Notes Mode.
- Notes and quotes can be attached to each other, or submitted independently:
  - Quote with no note ✓
  - Note with no quote ✓
  - Quote + note ✓

---

#### Full Reader Display

- Full-screen Apple-style e-reader.
- A **hovering circle** in the bottom-center (bottom ~10% of the reader) holds the app logo.
  - Clicking the circle expands it horizontally into a beautiful, rounded, transparent **liquid glass** text input — full-width, slight height increase.
  - The user types a question or command.
  - The LLM response materializes in the **top 30% of the screen** and fades away on click.

**Notes Mode (Full Reader Display)**
- A small **orange quill icon** in the top right activates Notes Mode.
- In Notes Mode:
  - A full-width text box (same liquid glass style as the LLM input) appears for typing notes.
  - Saving the note exits Notes Mode.
  - Text swiped in the reader is appended as a **quote**.

**Annotations**
- When a note is made, a small **orange subscript number** is attached to the page (equal to the note count on that page).
- When a quote is highlighted:
  - An **orange subscript** is attached to the final word of the quote.
  - The entire quote is **underlined in orange** (thin).

---

## Storage & Offline-First Architecture

The app is **offline-first**. All uploaded books are automatically moved into the app's referenceable documents folder.

An internal database stores:

- Paths to uploaded books
- Dictionary (vocabulary) — per book
- Notes & quotes — per book
- LLM conversation history — per book

---

## Accounts & Authentication

- No accounts or authentication at this time.
- No online backend.

---

## LLM Configuration

- Users provide their own **Anthropic API key**.
- When offline and an LLM feature is attempted, a message is displayed prompting the user to connect to the internet.

---

## Future Work

- **Daily AI Insights** — An LLM with access to the user's current reading progress and notes sends a daily note, quote, insight, or idea to reflect on. This is generated **only from already-read content**.
