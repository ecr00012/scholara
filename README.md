# Scholara

Scholara is a local-first desktop reading app for PDF and EPUB books. It combines a focused reader, notes and highlights, dictionary lookup, public-domain discovery through Gutendex and Project Gutenberg, and an AI reading assistant powered by OpenRouter.

The app is built as a Tauri desktop application: your library files, notes, preferences, conversation history, and search indexes live on your machine, while chat completions are sent to OpenRouter only when you use AI features.
<img width="1103" height="883" alt="Screenshot 2026-05-11 at 11 01 50 PM" src="https://github.com/user-attachments/assets/abdc6c1a-a003-4eb5-8dcb-beefd1f932a6" />
<img width="1469" height="892" alt="Screenshot 2026-05-10 at 11 15 15 PM" src="https://github.com/user-attachments/assets/119f86eb-301b-4808-b716-d3dcf8823887" />


## Features

- Import PDF and EPUB books by file picker or drag and drop.
- Read books in a full desktop reader with PDF and EPUB support.
- Highlight passages, write notes, and review saved annotations.
- Use a local WordNet-backed dictionary lookup flow.
- Browse popular public-domain books from Gutendex.
- Download EPUB files from Project Gutenberg into the local Scholara library.
- Chat with an AI reading assistant about the active book.
- Search book text and notes through assistant tools.
- Index books locally for retrieval-augmented responses.
- Choose between curated OpenRouter models from settings.
- Store the OpenRouter API key in the operating system keychain.

## Tech Stack

Scholara uses a Rust desktop shell with a modern React front end.

| Area                         | Technology                                                   |
| ---------------------------- | ------------------------------------------------------------ |
| Desktop runtime              | Tauri 2                                                      |
| Native backend               | Rust, Tokio, reqwest, rusqlite                               |
| Front end                    | React 19, TypeScript, Vite                                   |
| Styling                      | Tailwind CSS, shadcn-style components, Base UI, lucide-react |
| State                        | Zustand                                                      |
| Database                     | SQLite via `@tauri-apps/plugin-sql`                          |
| PDF rendering and extraction | `pdfjs-dist`                                                 |
| EPUB reading and extraction  | `epubjs`                                                     |
| Local embeddings             | `@xenova/transformers` with ONNX                             |
| AI chat                      | OpenRouter Chat Completions API                              |
| Testing                      | Vitest, Testing Library, Playwright                          |

## AI and OpenRouter

Scholara uses [OpenRouter](https://openrouter.ai/) for model access. The Rust backend calls:

```text
https://openrouter.ai/api/v1/chat/completions
```

The app supports both streaming and non-streaming chat completion requests. Streaming responses are parsed in the renderer from OpenAI-compatible server-sent events, including tool-call deltas.

OpenRouter requests include:

- `Authorization: Bearer <your key>`
- `HTTP-Referer: https://scholara.app`
- `X-Title: Scholara`

The OpenRouter API key is not stored in source files or browser storage. It is saved through the native keyring under the `scholara` service with the `openrouter_api_key` account.

### Supported Models

The in-app model picker is intentionally curated to models that support tool calling.

Current model IDs:

- `meta-llama/llama-3.3-70b-instruct:free` default
- `openai/gpt-oss-120b:free`
- `anthropic/claude-haiku-4.5`
- `anthropic/claude-sonnet-4.6`
- `openai/gpt-4o-mini`
- `google/gemini-2.0-flash-001`

Model availability, pricing, and exact capabilities are controlled by OpenRouter and may change over time. If a model starts failing, update `src/agent/models.ts`.

## Local Embeddings

Scholara indexes book text locally for retrieval-augmented chat. It uses:

```text
Xenova/all-MiniLM-L6-v2
```

Important details:

- The embedding model runs locally through `@xenova/transformers`.
- Remote model downloads are disabled at runtime.
- Model assets are bundled from `src-tauri/resources/models/Xenova/all-MiniLM-L6-v2`.
- The quantized ONNX model is used.
- Embeddings are 384-dimensional.
- Text is embedded with mean pooling and normalization.
- Book chunks are stored in SQLite as base64-encoded `Float32Array` values.
- The embedding index ID is `Xenova/all-MiniLM-L6-v2:base64-embeddings-v1`.

Books are indexed when opened. The indexer extracts text from PDF or EPUB files, chunks it into roughly 1,500-character passages with 200 characters of overlap, embeds in small batches, and stores chunk text plus vectors in the local database. If the file hash and embedding index ID have not changed, Scholara reuses the existing index.

The settings screen includes a "Re-embed all books on next open" action for refreshing stale or incompatible indexes.

## Gutendex and Project Gutenberg

Scholara uses [Gutendex](https://gutendex.com/) to discover public-domain books from Project Gutenberg.

The Gutendex panel fetches popular books from:

```text
https://gutendex.com/books?sort=popular&page=<page>
```

For each book, Scholara keeps a small normalized subset of metadata:

- Gutenberg ID
- title
- authors
- subjects
- bookshelves
- download count
- cover image URL

When you download a book, Scholara fetches the EPUB directly from Project Gutenberg. It first tries the image EPUB and then falls back to the no-image EPUB:

```text
https://www.gutenberg.org/ebooks/<id>.epub.images
https://www.gutenberg.org/ebooks/<id>.epub.noimages
```

Downloaded Gutenberg books are copied into the app data directory and added to the same local library as manually imported files.

## Local Data

Scholara is local-first. The app stores user data in the platform app data directory.

Local data includes:

- `scholara.db`, the SQLite database
- imported and downloaded book files
- generated or extracted covers
- notes, highlights, preferences, vocabulary, threads, and messages
- book chunk indexes and embedding state

The settings screen shows the exact local data directory and includes a button to reveal it in your file manager.

## Getting Started

### Prerequisites

Install:

- Node.js and npm
- Rust and Cargo
- Tauri 2 system dependencies for your operating system

For platform-specific Tauri prerequisites, see the Tauri documentation for Linux, macOS, or Windows.

### Install Dependencies

```sh
npm install
```

### Run the Desktop App

```sh
npm run tauri:dev
```

This starts Vite and launches the Tauri desktop shell.

### Configure OpenRouter

1. Create an API key in OpenRouter.
2. Open Scholara.
3. Go to Settings.
4. Paste the key into the OpenRouter API key field.
5. Save it.

The key is saved in the native keychain. You do not need a `.env` file for normal use.

## Scripts

| Command                 | Description                                |
| ----------------------- | ------------------------------------------ |
| `npm run dev`           | Start the Vite dev server only             |
| `npm run tauri:dev`     | Start the full Tauri desktop app           |
| `npm run build`         | Type-check and build the web assets        |
| `npm run tauri:build`   | Build a distributable desktop app          |
| `npm run test`          | Run Vitest unit tests                      |
| `npm run test:watch`    | Run Vitest in watch mode                   |
| `npm run test:e2e`      | Build the e2e app and run Playwright tests |
| `npm run test:e2e:ui`   | Run Playwright with the UI                 |
| `npm run test:all`      | Run unit and e2e tests                     |
| `npm run build:wordnet` | Build the bundled WordNet SQLite resource  |
| `npm run lint`          | Run ESLint                                 |
| `npm run format`        | Format the repository with Prettier        |

## Project Structure

```text
src/
  agent/              OpenRouter client, prompts, session handling, tools
  components/ui/      Shared UI primitives
  db/                 SQLite access helpers and table-specific modules
  dictionary/         Dictionary lookup logic
  ipc/                Renderer-side Tauri command wrappers
  lib/                Shared utilities and extraction helpers
  rag/                Text extraction, chunking, embedding, and indexing
  screens/            Library, reader, Gutenberg, and settings UI

src-tauri/
  migrations/         SQLite schema migrations
  resources/          Bundled WordNet and embedding model assets
  src/commands/       Rust Tauri commands for files, AI, secrets, Gutenberg
  tauri.conf.json     Tauri application configuration

tests/
  agent/              AI, prompts, token budget, and tool tests
  components/         Component tests
  db/                 Database tests
  lib/                Utility and parser tests
  playwright/         End-to-end reader and UI tests
  rag/                Retrieval and embedding pipeline tests
```

## Architecture Notes

The React renderer owns the user interface, local state, reading experience, and most client-side indexing orchestration. Tauri commands provide native capabilities that the browser sandbox cannot handle directly: filesystem access, app data paths, SQLite setup, keychain access, network calls that need stable native behavior, and Project Gutenberg downloads.

AI chat is intentionally split across layers. The Rust side owns the authenticated OpenRouter transport and redacts API keys from error strings. The TypeScript side owns message assembly, streamed tool-call parsing, retrieval context, and assistant interaction state.

Retrieval is also local-first. Scholara extracts text from the active book, chunks it, embeds it with the bundled MiniLM model, and stores both chunk text and vectors locally. Assistant tools can then search the current book or notes without sending an entire book to the model.

## Privacy

Scholara stores your library and reading data locally. Imported books, downloaded Gutenberg EPUBs, notes, highlights, SQLite data, covers, and embedding vectors remain on your machine.

When AI chat is used, the selected messages and any relevant retrieved context are sent to OpenRouter for completion. Your OpenRouter key is read from the operating system keychain by the Tauri backend and is never committed to the repository.

## Development Notes

- The app expects the local embedding model assets to be present under `src-tauri/resources/models`.
- `env.allowRemoteModels` is disabled for embeddings, so missing model files will break local indexing rather than downloading at runtime.
- SQLite migrations live in `src-tauri/migrations`.
- The Tauri bundle includes `resources/wordnet.sqlite` and `resources/models/**/*`.
- The app supports PDF and EPUB imports; other dropped file types are rejected.

## License

Scholara is licensed under the MIT License. See [LICENSE](LICENSE) for details.
