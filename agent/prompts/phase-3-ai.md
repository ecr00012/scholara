You are continuing work on Scholara, an offline-first Tauri + React + TypeScript desktop reading app.

Project root: /Users/creekrichmond/Documents/projects/scholara

Read first:
- Hard constraints (model, LangChain, streaming) and schema: CLAUDE.md lines 9–42
- AI logic spec: .claude/scholara-prompt.md lines 135–162; offline behavior: lines 183–187
- Visual inspo (liquid-glass input, top-screen overlay): .claude/inspo/
- Foundation spec: docs/superpowers/specs/2026-05-04-foundation-design.md
- Reader spec: docs/superpowers/specs/<reader-date>-reader-design.md — REQUIRED reading. It defines the position JSON shape per file_type, the AI Chat tab placeholder, the Full Reader floating-input shell, and the Add-to-Dictionary modal shell with the stubbed `streamWordDefinition(word)` function whose body you will replace.

You are starting **Phase 3: AI**. Scope: streaming agent built with LangChain (TypeScript) over Anthropic `claude-sonnet-4-20250514`; three retrieval tools (RAG over read content, RAG over full text gated by spoiler evaluation, web search fallback); persisted Agent-Display AI Chat tab using the existing `conversations` table; Full Reader Display floating-input → top-30% streaming overlay; real LLM-streamed dictionary definitions (replacing the Phase 2 stub); offline detection that surfaces a non-blocking toast and never throws.

Hard constraints unique to this phase:
- Model: claude-sonnet-4-20250514 ONLY.
- LangChain TypeScript wrapping Anthropic. Token-by-token streaming required everywhere.
- API key already in OS keychain — read via getApiKey() from src/ipc/secrets.ts.
- Always inject into the system prompt: current book + position, user's notes for this book, user's vocabulary for this book.

Open decisions to resolve in brainstorming (with explicit tradeoffs):
- RAG strategy — naive read-so-far context-stuffing vs. local embeddings (sqlite-vec / transformers.js) vs. external embeddings API (adds a second key, conflicts with offline-first for the reading path itself).
- Web search provider — Tavily / SerpAPI / Brave. Whichever you pick, the user supplies the key in Settings; never hardcode.
- Spoiler evaluation — separate pre-call LLM check vs. single tool-using call. Latency/cost vs. correctness.
- Streaming transport — LangChain streaming primitives vs. direct Anthropic SDK. Cross-platform Tauri considerations.

Inherited contracts (do not change without approval):
- conversations table schema, db/ + ipc/ + store boundaries.
- The streamWordDefinition signature from Phase 2 — replace the body, keep call sites unchanged.
- The Reader's AI Chat tab and floating-input shell — fill in, do not rebuild.
- Settings screen — add a second optional API key field for the web search provider rather than building a new settings surface.

Use today's date for the YYYY-MM-DD filename prefix.

Run the brainstorming skill, then writing-plans. Save outputs to:
- docs/superpowers/specs/<today>-ai-design.md
- docs/superpowers/plans/<today>-ai-implementation.md

Do not write application code in this session — spec + plan only.
