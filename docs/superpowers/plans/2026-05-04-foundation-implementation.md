# Scholara Foundation Implementation Plan

**Goal:** Scaffold a production-ready Tauri + React + TypeScript app with SQLite, OS-keychain API-key storage, an Apple-Libraries-style Library screen (with quill-and-inkwell Add Book affordance and stylized generated covers), and a Settings screen — providing the shell that the Reader, AI, and Animation phases will build into.

**Architecture:** Tauri 2.x desktop app with React 18 + TypeScript front-end (Vite). All filesystem and secret operations go through narrow Rust IPC commands. SQLite via `tauri-plugin-sql` for app data; OS keychain via Rust `keyring` crate for the Anthropic API key. Zustand for app state with no router (conditional view switch). Strict module boundaries: components → store → `db/`/`ipc/` → Tauri.

**Tech Stack:** Tauri 2.x, React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, Zustand, framer-motion, `tauri-plugin-sql`, `tauri-plugin-dialog`, `tauri-plugin-opener`, Rust `keyring` crate, Vitest, `better-sqlite3` (test-only), ESLint, Prettier.

**Reference spec:** [`docs/superpowers/specs/2026-05-04-foundation-design.md`](../specs/2026-05-04-foundation-design.md)

---

## Conventions used in this plan

- All file paths are absolute from the repo root: `/Users/creekrichmond/Documents/projects/scholara/`. In commands, run from the repo root unless noted.
- "Repo root" = `/Users/creekrichmond/Documents/projects/scholara`.
- Commit after each task. Commit messages use imperative present tense.
- TDD where the unit is testable in isolation (pure functions, DB query layer). UI and IPC are smoke-tested manually per spec §11.3.

---

## Task 1: Scaffold Tauri + React-TS into the existing repo

**Goal:** Bring in a working Tauri scaffold without losing the existing `CLAUDE.md`, `docs/`, `.claude/`, `.git`, or `.gitignore`.

**Files:**
- Create (via scaffold): `package.json`, `package-lock.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `src/main.tsx`, `src/App.tsx`, `src/App.css`, `src/index.css`, `src/vite-env.d.ts`, `public/*`, `src-tauri/**`
- Modify (merge): `.gitignore`

- [ ] **Step 1: Verify clean working tree**

Run: `git status`
Expected output:
```
On branch main
Your branch is up to date with 'origin/main'.
nothing to commit, working tree clean
```
If not clean, commit or stash before proceeding.

- [ ] **Step 2: Back up the existing `.gitignore`**

Run: `cp /Users/creekrichmond/Documents/projects/scholara/.gitignore /tmp/scholara-orig.gitignore`

Expected: file exists with our 3 entries (`.DS_Store`, `**/.DS_Store`, `.claude/`).

- [ ] **Step 3: Scaffold into a temp directory**

Run:
```bash
rm -rf /tmp/scholara-scaffold
npm create tauri-app@latest scholara-scaffold -- --template react-ts --identifier com.scholara.app --manager npm
```

Run from: `/tmp`.

If interactive prompts appear (older `create-tauri-app` versions ignore some flags), answer:
- App name: `scholara`
- Identifier: `com.scholara.app`
- Frontend language: `TypeScript / JavaScript`
- Package manager: `npm`
- UI template: `React`
- UI flavor: `TypeScript`

Expected: `/tmp/scholara-scaffold/` contains `package.json`, `index.html`, `src/`, `src-tauri/`, etc.

- [ ] **Step 4: Move scaffold files into the repo root**

Run from repo root:
```bash
rsync -a --exclude='.git' --exclude='README.md' /tmp/scholara-scaffold/ ./
```

Expected: `package.json`, `index.html`, `src/`, `src-tauri/`, `vite.config.ts`, `tsconfig.json`, `public/` all present in the repo root. `CLAUDE.md` and `docs/` still present.

- [ ] **Step 5: Merge our `.gitignore` entries into the scaffold's `.gitignore`**

Run from repo root:
```bash
cat /tmp/scholara-orig.gitignore >> .gitignore
awk '!seen[$0]++' .gitignore > .gitignore.tmp && mv .gitignore.tmp .gitignore
rm /tmp/scholara-orig.gitignore
rm -rf /tmp/scholara-scaffold
```

Expected: `.gitignore` contains both Tauri/Node entries (`node_modules`, `dist`, `target/`, etc.) AND our originals (`.DS_Store`, `**/.DS_Store`, `.claude/`), with no duplicates.

- [ ] **Step 6: Set the package name to `scholara`**

Open `/Users/creekrichmond/Documents/projects/scholara/package.json` and change the `"name"` field to `"scholara"`. Leave version/scripts as scaffolded.

- [ ] **Step 7: Install npm dependencies and verify Rust builds**

Run from repo root:
```bash
npm install
cd src-tauri && cargo check && cd ..
```

Expected: `npm install` finishes with no errors; `cargo check` finishes with `Finished` and no errors.

- [ ] **Step 8: Smoke-test the scaffold**

Run from repo root: `npm run tauri dev`

Expected: a window opens displaying the default Tauri+React greeting with a "Click me!" interaction. Close the window.

If this fails, do **not** proceed — fix scaffolding errors first.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Scaffold Tauri + React + TypeScript app

Generated via create-tauri-app with the react-ts template. Identifier
com.scholara.app. Existing CLAUDE.md, docs/, and .claude/ preserved;
.gitignore merged."
```

---

## Task 2: Install front-end dependencies

**Goal:** Add every npm dependency needed by Foundation.

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install runtime dependencies**

Run from repo root:
```bash
npm install zustand framer-motion class-variance-authority clsx tailwind-merge lucide-react
npm install @tauri-apps/plugin-sql @tauri-apps/plugin-dialog @tauri-apps/plugin-opener
```

Expected: each install completes with no `ERR!` lines.

- [ ] **Step 2: Install dev dependencies**

Run from repo root:
```bash
npm install -D tailwindcss@3 postcss autoprefixer @types/node prettier vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom better-sqlite3 @types/better-sqlite3
```

Note: pinned `tailwindcss@3` because shadcn/ui's CLI generates v3-compatible config.

Expected: each install completes with no `ERR!` lines.

- [ ] **Step 3: Verify install integrity**

Run: `npm ls --depth=0`

Expected: lists all installed packages with no `UNMET DEPENDENCY` warnings.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "Install Foundation front-end dependencies

Adds zustand, framer-motion, shadcn/ui peers, three Tauri plugins,
Tailwind v3, Vitest, jsdom, Testing Library, better-sqlite3, and
Prettier."
```

---

## Task 3: Add Rust dependencies

**Goal:** Add `tauri-plugin-sql`, `tauri-plugin-dialog`, `tauri-plugin-opener`, `keyring`, and `uuid` to the Tauri Rust crate.

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the dependency block**

Open `/Users/creekrichmond/Documents/projects/scholara/src-tauri/Cargo.toml`. In the `[dependencies]` section (just below the existing `tauri = ...` line and `tauri-build` build-deps line), add:

```toml
tauri-plugin-sql    = { version = "2", features = ["sqlite"] }
tauri-plugin-dialog = "2"
tauri-plugin-opener = "2"
keyring             = "3"
uuid                = { version = "1", features = ["v4"] }
serde_json          = "1"
```

Leave the existing `serde` and `tauri` lines alone. The scaffold already includes `serde` with the `derive` feature.

- [ ] **Step 2: Verify Rust compiles**

Run: `cd /Users/creekrichmond/Documents/projects/scholara/src-tauri && cargo check`

Expected: `Finished` with no errors. (Compilation will take a few minutes the first time.)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "Add Rust dependencies for SQL, dialog, opener, keychain, uuid"
```

---

## Task 4: Configure scripts, Prettier, and Vitest

**Goal:** Match spec §11.4 scripts, configure Prettier, configure Vitest.

**Files:**
- Modify: `package.json`
- Create: `.prettierrc.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Update `package.json` scripts**

Open `/Users/creekrichmond/Documents/projects/scholara/package.json`. Replace the `"scripts"` object with:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "tauri": "tauri",
  "tauri:dev": "tauri dev",
  "tauri:build": "tauri build",
  "test": "vitest run",
  "test:watch": "vitest",
  "lint": "eslint . --ext .ts,.tsx",
  "format": "prettier --write ."
}
```

- [ ] **Step 2: Create `.prettierrc.json`**

Create `/Users/creekrichmond/Documents/projects/scholara/.prettierrc.json`:

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "semi": true,
  "tabWidth": 2,
  "arrowParens": "always"
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

Create `/Users/creekrichmond/Documents/projects/scholara/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 4: Add the `@/*` path alias to `tsconfig.json`**

Open `/Users/creekrichmond/Documents/projects/scholara/tsconfig.json`. Inside `"compilerOptions"`, add (or update):

```json
"baseUrl": ".",
"paths": {
  "@/*": ["./src/*"]
}
```

- [ ] **Step 5: Verify Vitest runs (with no tests yet, this should report no test files found)**

Run: `npm test`

Expected output contains `No test files found` (this is fine — we have no tests yet) OR `Test Files  0 passed`. Exit code may be non-zero on "no tests"; that's OK at this stage.

- [ ] **Step 6: Commit**

```bash
git add package.json .prettierrc.json vitest.config.ts tsconfig.json
git commit -m "Configure scripts, Prettier, Vitest, and @/* path alias"
```

---

## Task 5: Initialize Tailwind CSS with light-mode lock

**Goal:** Tailwind v3 set up with the dark-mode escape hatch present but never engaged.

**Files:**
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`
- Modify: `src/index.css`

- [ ] **Step 1: Generate the Tailwind config**

Run from repo root: `npx tailwindcss init -p`

Expected: creates `tailwind.config.js` and `postcss.config.js`.

- [ ] **Step 2: Replace `tailwind.config.js` with a `.ts` config**

Delete the generated `tailwind.config.js`. Create `/Users/creekrichmond/Documents/projects/scholara/tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#FAFAF7',
        ink: {
          DEFAULT: '#1F1B16',
          muted: 'rgba(31, 27, 22, 0.7)',
        },
        accent: {
          amber: '#C9892F',
          gold: '#D4A24C',
        },
      },
      fontFamily: {
        serif: ['"Iowan Old Style"', '"Palatino Linotype"', 'Georgia', 'serif'],
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      keyframes: {
        'banner-in': {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'banner-in': 'banner-in 200ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 3: Confirm `postcss.config.js` content**

Open `/Users/creekrichmond/Documents/projects/scholara/postcss.config.js`. It should look like:

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

If different, replace with the above.

- [ ] **Step 4: Replace `src/index.css` with Tailwind directives + base styles**

Replace contents of `/Users/creekrichmond/Documents/projects/scholara/src/index.css` with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: light only;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  background-color: theme('colors.cream');
  color: theme('colors.ink.DEFAULT');
  font-family: theme('fontFamily.sans');
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

- [ ] **Step 5: Delete the unused `src/App.css`**

Run: `rm /Users/creekrichmond/Documents/projects/scholara/src/App.css`

- [ ] **Step 6: Remove the App.css import from `src/App.tsx`**

Open `/Users/creekrichmond/Documents/projects/scholara/src/App.tsx`. Delete the line `import "./App.css";` (or `import './App.css';`). Leave the rest of the scaffold's App component in place — we'll replace it entirely in a later task.

- [ ] **Step 7: Verify Tailwind compiles**

Run: `npm run tauri dev`

Expected: app window still opens; the cream background should be visible behind the scaffold's content. Close the window.

- [ ] **Step 8: Commit**

```bash
git add tailwind.config.ts postcss.config.js src/index.css src/App.tsx
git rm src/App.css
git commit -m "Configure Tailwind v3 with light-only theme tokens"
```

---

## Task 6: Initialize shadcn/ui and add base components

**Goal:** Install shadcn/ui and pull in the components we'll use in Foundation.

**Files:**
- Create: `components.json`
- Create: `src/components/ui/button.tsx`, `dialog.tsx`, `input.tsx`, `dropdown-menu.tsx`, `sonner.tsx`, `label.tsx`
- Create: `src/lib/utils.ts` (shadcn's default `cn` location — we'll redirect to ours)

- [ ] **Step 1: Initialize shadcn/ui**

Run from repo root: `npx shadcn@latest init`

Answer prompts:
- Style: `New York` (more refined than `Default`)
- Base color: `Stone`
- CSS variables: `Yes`
- Tailwind config path: `tailwind.config.ts`
- Tailwind CSS file: `src/index.css`
- Components alias: `@/components`
- Utils alias: `@/lib/utils`
- React Server Components: `No`

If asked about overwriting `tailwind.config.ts` or `src/index.css`, say **No** to both — shadcn's defaults override our config; we'll integrate the CSS variables manually in the next step.

Expected: creates `components.json` and `src/lib/utils.ts`. May leave `tailwind.config.ts` and `src/index.css` unchanged because we declined.

- [ ] **Step 2: Add the shadcn CSS variables to `src/index.css`**

Open `/Users/creekrichmond/Documents/projects/scholara/src/index.css`. Replace its contents with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 60 6% 97%;
    --foreground: 28 18% 11%;
    --card: 60 6% 97%;
    --card-foreground: 28 18% 11%;
    --popover: 60 6% 97%;
    --popover-foreground: 28 18% 11%;
    --primary: 28 18% 11%;
    --primary-foreground: 60 6% 97%;
    --secondary: 30 15% 92%;
    --secondary-foreground: 28 18% 11%;
    --muted: 30 15% 92%;
    --muted-foreground: 28 10% 40%;
    --accent: 30 15% 92%;
    --accent-foreground: 28 18% 11%;
    --destructive: 0 70% 45%;
    --destructive-foreground: 60 6% 97%;
    --border: 30 15% 88%;
    --input: 30 15% 88%;
    --ring: 28 18% 11%;
    --radius: 0.5rem;
  }
}

:root {
  color-scheme: light only;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  background-color: theme('colors.cream');
  color: theme('colors.ink.DEFAULT');
  font-family: theme('fontFamily.sans');
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

- [ ] **Step 3: Confirm `src/lib/utils.ts` content**

Open `/Users/creekrichmond/Documents/projects/scholara/src/lib/utils.ts`. It should contain:

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

If different, replace with the above.

- [ ] **Step 4: Add base shadcn components**

Run from repo root:
```bash
npx shadcn@latest add button dialog input dropdown-menu sonner label
```

Answer "yes" to any overwrite prompts.

Expected: creates `src/components/ui/button.tsx`, `dialog.tsx`, `input.tsx`, `dropdown-menu.tsx`, `sonner.tsx`, `label.tsx`.

- [ ] **Step 5: Verify the app still compiles**

Run: `npm run tauri dev`

Expected: app window opens with cream background; no console errors. Close the window.

- [ ] **Step 6: Commit**

```bash
git add components.json src/index.css src/lib/utils.ts src/components/ui/
git commit -m "Initialize shadcn/ui with stone base and add core components

Components: button, dialog, input, dropdown-menu, sonner (toasts),
label. Light-only color scheme; cream background; shadcn variables
restricted to :root."
```

---

## Task 7: Configure Tauri capabilities for plugins

**Goal:** Allow the front-end to invoke SQL, dialog, opener, and our custom commands.

**Files:**
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/tauri.conf.json` (productName)

- [ ] **Step 1: Update `tauri.conf.json` product name**

Open `/Users/creekrichmond/Documents/projects/scholara/src-tauri/tauri.conf.json`. Set:

```json
"productName": "Scholara",
```

Set the window title to `"Scholara"` as well:

```json
"app": {
  "windows": [
    {
      "title": "Scholara",
      "width": 1280,
      "height": 800,
      "minWidth": 960,
      "minHeight": 600,
      "resizable": true
    }
  ],
  ...
}
```

(Replace the existing single window entry; preserve other top-level keys like `security` and `withGlobalTauri`.)

- [ ] **Step 2: Update `src-tauri/capabilities/default.json`**

Open `/Users/creekrichmond/Documents/projects/scholara/src-tauri/capabilities/default.json`. Replace the `"permissions"` array with:

```json
"permissions": [
  "core:default",
  "dialog:default",
  "dialog:allow-open",
  "opener:default",
  "opener:allow-reveal-item-in-dir",
  "sql:default",
  "sql:allow-load",
  "sql:allow-execute",
  "sql:allow-select",
  "sql:allow-close"
]
```

Custom commands defined under `tauri::generate_handler!` are exposed via `core:default` and do not need explicit allow-list entries.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "Set Scholara product name and grant plugin permissions"
```

---

## Task 8: Write the SQLite migration

**Goal:** Single migration creating all four tables exactly as in spec §5.1.

**Files:**
- Create: `src-tauri/migrations/0001_init.sql`

- [ ] **Step 1: Create the migrations directory and file**

Create `/Users/creekrichmond/Documents/projects/scholara/src-tauri/migrations/0001_init.sql` with:

```sql
CREATE TABLE books (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT    NOT NULL,
  author            TEXT,
  cover_image_path  TEXT,
  file_path         TEXT    NOT NULL UNIQUE,
  file_type         TEXT    NOT NULL CHECK (file_type IN ('pdf','epub')),
  last_opened       TEXT,
  current_position  TEXT,
  display_mode      TEXT    NOT NULL DEFAULT 'agent' CHECK (display_mode IN ('agent','reader')),
  metadata_source   TEXT    NOT NULL DEFAULT 'filename' CHECK (metadata_source IN ('filename','user','extracted')),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE vocabulary (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  word        TEXT    NOT NULL,
  definition  TEXT    NOT NULL,
  book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vocab_book ON vocabulary(book_id);
CREATE INDEX idx_vocab_recent ON vocabulary(created_at DESC);

CREATE TABLE notes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id           INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  page_or_position  TEXT    NOT NULL,
  note_text         TEXT,
  quote_text        TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (note_text IS NOT NULL OR quote_text IS NOT NULL)
);
CREATE INDEX idx_notes_book ON notes(book_id);

CREATE TABLE conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  role        TEXT    NOT NULL CHECK (role IN ('user','assistant')),
  content     TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_conv_book_time ON conversations(book_id, created_at);
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/migrations/0001_init.sql
git commit -m "Add 0001_init SQL migration with books, vocabulary, notes, conversations"
```

---

## Task 9: Register `tauri-plugin-sql` with the migration in Rust

**Goal:** Wire the SQL plugin into the Tauri builder so the migration runs on first launch.

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Replace `src-tauri/src/lib.rs` with the plugin-registered version**

Open `/Users/creekrichmond/Documents/projects/scholara/src-tauri/src/lib.rs`. Replace its contents with:

```rust
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "init schema",
        sql: include_str!("../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:scholara.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

This intentionally leaves `invoke_handler!` empty for now; we'll add commands in Tasks 16–17.

- [ ] **Step 2: Verify Rust compiles**

Run: `cd /Users/creekrichmond/Documents/projects/scholara/src-tauri && cargo check`

Expected: `Finished` with no errors.

- [ ] **Step 3: Smoke-test the migration runs**

Run from repo root: `npm run tauri dev`

Expected: app window opens; in a new terminal:
```bash
ls "$HOME/Library/Application Support/com.scholara.app/" 2>/dev/null || ls "$HOME/.local/share/com.scholara.app/" 2>/dev/null
```
Expected: `scholara.db` is present (filesize > 0). Close the window.

If the file isn't there yet, the lazy-load may not have triggered — that's OK; we'll trigger it when `getDb()` is first called from the front-end.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "Register tauri-plugin-sql with the 0001 migration"
```

---

## Task 10: Define DB types and the `SqlExecutor` interface

**Goal:** Single source of truth for `Book`/`Note`/`Vocab`/`Conversation` shapes plus a thin abstraction usable by both `tauri-plugin-sql` (production) and `better-sqlite3` (tests).

**Files:**
- Create: `src/db/types.ts`

- [ ] **Step 1: Create `src/db/types.ts`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/db/types.ts`:

```ts
export type FileType = 'pdf' | 'epub';
export type DisplayMode = 'agent' | 'reader';
export type MetadataSource = 'filename' | 'user' | 'extracted';
export type ConversationRole = 'user' | 'assistant';

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
  created_at: string;
}

export interface NoteRow {
  id: number;
  book_id: number;
  page_or_position: string;
  note_text: string | null;
  quote_text: string | null;
  created_at: string;
}

export interface VocabRow {
  id: number;
  word: string;
  definition: string;
  book_id: number;
  created_at: string;
}

export interface ConversationRow {
  id: number;
  book_id: number;
  role: ConversationRole;
  content: string;
  created_at: string;
}

/**
 * Minimal SQL surface shared by tauri-plugin-sql (production) and the
 * better-sqlite3 test wrapper. Query functions in db/ accept an instance
 * of this so they're trivially unit-testable.
 */
export interface SqlExecutor {
  execute(
    sql: string,
    params?: unknown[],
  ): Promise<{ lastInsertId: number; rowsAffected: number }>;
  select<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/db/types.ts
git commit -m "Add DB row types and SqlExecutor interface"
```

---

## Task 11: Create the production `db/client.ts` singleton

**Goal:** Lazy `getDb()` that loads `tauri-plugin-sql`, runs `PRAGMA foreign_keys = ON`, and adapts to `SqlExecutor`.

**Files:**
- Create: `src/db/client.ts`

- [ ] **Step 1: Create `src/db/client.ts`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/db/client.ts`:

```ts
import Database from '@tauri-apps/plugin-sql';
import type { SqlExecutor } from './types';

let cached: Promise<SqlExecutor> | null = null;

export function getDb(): Promise<SqlExecutor> {
  if (cached) return cached;
  cached = (async () => {
    const db = await Database.load('sqlite:scholara.db');
    await db.execute('PRAGMA foreign_keys = ON;');
    return {
      async execute(sql, params = []) {
        const result = await db.execute(sql, params);
        return {
          lastInsertId: typeof result.lastInsertId === 'number' ? result.lastInsertId : 0,
          rowsAffected: result.rowsAffected,
        };
      },
      async select<T>(sql: string, params: unknown[] = []) {
        return (await db.select<T[]>(sql, params)) as T[];
      },
    };
  })();
  return cached;
}

/** Test-only: reset the cached promise. Do not call from app code. */
export function _resetDbForTests() {
  cached = null;
}
```

- [ ] **Step 2: Type-check the file**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/db/client.ts
git commit -m "Add lazy getDb() singleton with foreign_keys pragma"
```

---

## Task 12: Create the better-sqlite3 test helper

**Goal:** A `SqlExecutor` backed by `better-sqlite3` that loads the same migration as production, for use in unit tests.

**Files:**
- Create: `tests/helpers/sqlite.ts`

- [ ] **Step 1: Create `tests/helpers/sqlite.ts`**

Create `/Users/creekrichmond/Documents/projects/scholara/tests/helpers/sqlite.ts`:

```ts
import BetterSqlite3 from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SqlExecutor } from '../../src/db/types';

const MIGRATION_PATH = path.resolve(
  __dirname,
  '../../src-tauri/migrations/0001_init.sql',
);

/**
 * Returns a SqlExecutor backed by an in-memory better-sqlite3 instance with
 * the production schema migration applied and foreign keys enabled.
 */
export function makeTestDb(): SqlExecutor {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  const sql = readFileSync(MIGRATION_PATH, 'utf-8');
  db.exec(sql);

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

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/sqlite.ts
git commit -m "Add better-sqlite3 test helper that loads production schema"
```

---

## Task 13: TDD `db/books.ts`

**Goal:** Pure functions `listBooks`, `insertBook`, `updateMetadata`, `deleteBook`, all taking a `SqlExecutor`.

**Files:**
- Create: `tests/db/books.test.ts`
- Create: `src/db/books.ts`

- [ ] **Step 1: Write the failing test file**

Create `/Users/creekrichmond/Documents/projects/scholara/tests/db/books.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeTestDb } from '../helpers/sqlite';
import {
  listBooks,
  insertBook,
  updateMetadata,
  deleteBook,
} from '../../src/db/books';

describe('db/books', () => {
  it('inserts a book with filename metadata source by default', async () => {
    const db = makeTestDb();
    const id = await insertBook(db, {
      title: 'War And Peace',
      author: null,
      file_path: '/data/wp.pdf',
      file_type: 'pdf',
    });
    expect(id).toBeGreaterThan(0);

    const rows = await listBooks(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      title: 'War And Peace',
      author: null,
      file_path: '/data/wp.pdf',
      file_type: 'pdf',
      display_mode: 'agent',
      metadata_source: 'filename',
    });
    expect(rows[0].created_at).toBeTruthy();
  });

  it('lists books most-recent-first', async () => {
    const db = makeTestDb();
    await insertBook(db, {
      title: 'Older',
      author: null,
      file_path: '/a.pdf',
      file_type: 'pdf',
    });
    await new Promise((r) => setTimeout(r, 1100)); // ensure created_at differs (sec-level granularity)
    await insertBook(db, {
      title: 'Newer',
      author: null,
      file_path: '/b.pdf',
      file_type: 'pdf',
    });

    const rows = await listBooks(db);
    expect(rows.map((r) => r.title)).toEqual(['Newer', 'Older']);
  });

  it('updates title/author and stamps metadata_source = user', async () => {
    const db = makeTestDb();
    const id = await insertBook(db, {
      title: 'Old Title',
      author: null,
      file_path: '/c.pdf',
      file_type: 'pdf',
    });

    await updateMetadata(db, id, { title: 'New Title', author: 'Jane Doe' });

    const rows = await listBooks(db);
    expect(rows[0]).toMatchObject({
      title: 'New Title',
      author: 'Jane Doe',
      metadata_source: 'user',
    });
  });

  it('deletes a book by id', async () => {
    const db = makeTestDb();
    const id = await insertBook(db, {
      title: 'Delete Me',
      author: null,
      file_path: '/d.pdf',
      file_type: 'pdf',
    });

    await deleteBook(db, id);

    const rows = await listBooks(db);
    expect(rows).toHaveLength(0);
  });

  it('rejects duplicate file_path', async () => {
    const db = makeTestDb();
    await insertBook(db, {
      title: 'A',
      author: null,
      file_path: '/same.pdf',
      file_type: 'pdf',
    });
    await expect(
      insertBook(db, {
        title: 'B',
        author: null,
        file_path: '/same.pdf',
        file_type: 'pdf',
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- tests/db/books.test.ts`

Expected: tests fail with "Cannot find module '../../src/db/books'" (or similar).

- [ ] **Step 3: Implement `src/db/books.ts`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/db/books.ts`:

```ts
import type { Book, FileType, SqlExecutor } from './types';

export interface InsertBookInput {
  title: string;
  author: string | null;
  file_path: string;
  file_type: FileType;
}

export interface UpdateMetadataInput {
  title: string;
  author: string | null;
}

export async function listBooks(db: SqlExecutor): Promise<Book[]> {
  return db.select<Book>(
    `SELECT id, title, author, cover_image_path, file_path, file_type,
            last_opened, current_position, display_mode, metadata_source,
            created_at
     FROM books
     ORDER BY datetime(created_at) DESC, id DESC`,
  );
}

export async function insertBook(
  db: SqlExecutor,
  input: InsertBookInput,
): Promise<number> {
  const result = await db.execute(
    `INSERT INTO books (title, author, file_path, file_type, metadata_source)
     VALUES (?, ?, ?, ?, 'filename')`,
    [input.title, input.author, input.file_path, input.file_type],
  );
  return result.lastInsertId;
}

export async function updateMetadata(
  db: SqlExecutor,
  id: number,
  patch: UpdateMetadataInput,
): Promise<void> {
  await db.execute(
    `UPDATE books
     SET title = ?, author = ?, metadata_source = 'user'
     WHERE id = ?`,
    [patch.title, patch.author, id],
  );
}

export async function deleteBook(db: SqlExecutor, id: number): Promise<void> {
  await db.execute(`DELETE FROM books WHERE id = ?`, [id]);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- tests/db/books.test.ts`

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/db/books.test.ts src/db/books.ts
git commit -m "Implement db/books.ts CRUD (TDD)"
```

---

## Task 14: Stub `db/vocabulary.ts`, `db/notes.ts`, `db/conversations.ts`

**Goal:** Empty modules that re-export the row types so future imports don't fail.

**Files:**
- Create: `src/db/vocabulary.ts`
- Create: `src/db/notes.ts`
- Create: `src/db/conversations.ts`

- [ ] **Step 1: Create `src/db/vocabulary.ts`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/db/vocabulary.ts`:

```ts
export type { VocabRow } from './types';

// Phase 3 will add: listVocab, insertVocab, listVocabForBook, etc.
```

- [ ] **Step 2: Create `src/db/notes.ts`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/db/notes.ts`:

```ts
export type { NoteRow } from './types';

// Phase 2 will add: listNotesForBook, insertNote, deleteNote, etc.
```

- [ ] **Step 3: Create `src/db/conversations.ts`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/db/conversations.ts`:

```ts
export type { ConversationRow } from './types';

// Phase 3 will add: listConversation, appendMessage, etc.
```

- [ ] **Step 4: Commit**

```bash
git add src/db/vocabulary.ts src/db/notes.ts src/db/conversations.ts
git commit -m "Stub db modules for vocabulary, notes, conversations"
```

---

## Task 15: Implement Rust IPC commands — `commands/books.rs`

**Goal:** `copy_uploaded_file`, `app_data_dir_path`, `reveal_in_file_manager` Rust commands per spec §6.3.

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/books.rs`

- [ ] **Step 1: Create `src-tauri/src/commands/mod.rs`**

Create `/Users/creekrichmond/Documents/projects/scholara/src-tauri/src/commands/mod.rs`:

```rust
pub mod books;
pub mod secrets;
```

- [ ] **Step 2: Create `src-tauri/src/commands/books.rs`**

Create `/Users/creekrichmond/Documents/projects/scholara/src-tauri/src/commands/books.rs`:

```rust
use std::path::{Path, PathBuf};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

#[derive(Serialize)]
pub struct CopyResult {
    pub stored_path: String,
    pub file_type: String,
}

fn err<E: std::fmt::Display>(prefix: &str) -> impl Fn(E) -> String + '_ {
    move |e| format!("{prefix}: {e}")
}

#[tauri::command]
pub fn copy_uploaded_file(
    app: AppHandle,
    source_path: String,
) -> Result<CopyResult, String> {
    let source = Path::new(&source_path);
    if !source.exists() {
        return Err("Source file does not exist".into());
    }

    let extension = source
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .ok_or_else(|| "File has no extension".to_string())?;

    let file_type = match extension.as_str() {
        "pdf" => "pdf",
        "epub" => "epub",
        other => return Err(format!("Unsupported file type: .{other}")),
    };

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(err("Could not resolve app data dir"))?;

    let books_dir = app_data.join("books");
    std::fs::create_dir_all(&books_dir).map_err(err("Could not create books dir"))?;

    let mut dest: PathBuf;
    loop {
        let filename = format!("{}.{}", Uuid::new_v4(), extension);
        dest = books_dir.join(&filename);
        if !dest.exists() {
            break;
        }
    }

    std::fs::copy(source, &dest).map_err(err("Could not save book"))?;

    Ok(CopyResult {
        stored_path: dest
            .to_str()
            .ok_or_else(|| "Destination path is not valid UTF-8".to_string())?
            .to_string(),
        file_type: file_type.into(),
    })
}

#[tauri::command]
pub fn app_data_dir_path(app: AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(err("Could not resolve app data dir"))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn reveal_in_file_manager(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(err("Could not reveal in file manager"))
}
```

- [ ] **Step 3: Verify Rust compiles**

Run: `cd /Users/creekrichmond/Documents/projects/scholara/src-tauri && cargo check`

Expected: `Finished` with no errors. (You may see warnings about unused code until commands are wired in Task 17.)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/
git commit -m "Implement Rust IPC commands: copy_uploaded_file, app_data_dir_path, reveal_in_file_manager"
```

---

## Task 16: Implement Rust IPC commands — `commands/secrets.rs`

**Goal:** `get_api_key` and `set_api_key` backed by the `keyring` crate.

**Files:**
- Create: `src-tauri/src/commands/secrets.rs`

- [ ] **Step 1: Create `src-tauri/src/commands/secrets.rs`**

Create `/Users/creekrichmond/Documents/projects/scholara/src-tauri/src/commands/secrets.rs`:

```rust
use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "scholara";
const ACCOUNT: &str = "anthropic_api_key";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Could not access keychain: {e}"))
}

#[tauri::command]
pub fn get_api_key() -> Result<Option<String>, String> {
    let e = entry()?;
    match e.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(format!("Could not access keychain: {err}")),
    }
}

#[tauri::command]
pub fn set_api_key(key: String) -> Result<(), String> {
    let e = entry()?;
    if key.is_empty() {
        match e.delete_credential() {
            Ok(()) => Ok(()),
            Err(KeyringError::NoEntry) => Ok(()),
            Err(err) => Err(format!("Could not clear keychain entry: {err}")),
        }
    } else {
        e.set_password(&key)
            .map_err(|err| format!("Could not save API key: {err}"))
    }
}
```

- [ ] **Step 2: Verify Rust compiles**

Run: `cd /Users/creekrichmond/Documents/projects/scholara/src-tauri && cargo check`

Expected: `Finished` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/secrets.rs
git commit -m "Implement get_api_key and set_api_key via OS keychain"
```

---

## Task 17: Wire commands into `lib.rs`

**Goal:** Register all five custom commands in `tauri::generate_handler!`.

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Update `src-tauri/src/lib.rs`**

Replace contents of `/Users/creekrichmond/Documents/projects/scholara/src-tauri/src/lib.rs` with:

```rust
mod commands;

use commands::books::{app_data_dir_path, copy_uploaded_file, reveal_in_file_manager};
use commands::secrets::{get_api_key, set_api_key};
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "init schema",
        sql: include_str!("../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:scholara.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            copy_uploaded_file,
            app_data_dir_path,
            reveal_in_file_manager,
            get_api_key,
            set_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 2: Verify Rust compiles**

Run: `cd /Users/creekrichmond/Documents/projects/scholara/src-tauri && cargo check`

Expected: `Finished` with no errors and no `unused` warnings on the command functions.

- [ ] **Step 3: Smoke test the app still launches**

Run from repo root: `npm run tauri dev`

Expected: window opens normally; close it.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "Register all five custom commands in tauri invoke_handler"
```

---

## Task 18: TS IPC wrappers (`ipc/files.ts`, `ipc/secrets.ts`)

**Goal:** Typed `invoke()` wrappers — the only place in the front-end that imports `@tauri-apps/api`.

**Files:**
- Create: `src/ipc/files.ts`
- Create: `src/ipc/secrets.ts`

- [ ] **Step 1: Create `src/ipc/files.ts`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/ipc/files.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import type { FileType } from '../db/types';

interface CopyResult {
  stored_path: string;
  file_type: FileType;
}

export async function copyUploadedFile(
  sourcePath: string,
): Promise<{ storedPath: string; fileType: FileType }> {
  const result = await invoke<CopyResult>('copy_uploaded_file', {
    sourcePath,
  });
  return { storedPath: result.stored_path, fileType: result.file_type };
}

export async function appDataDirPath(): Promise<string> {
  return invoke<string>('app_data_dir_path');
}

export async function revealInFileManager(path: string): Promise<void> {
  await invoke('reveal_in_file_manager', { path });
}
```

- [ ] **Step 2: Create `src/ipc/secrets.ts`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/ipc/secrets.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';

export async function getApiKey(): Promise<string | null> {
  return invoke<string | null>('get_api_key');
}

export async function setApiKey(key: string): Promise<void> {
  await invoke('set_api_key', { key });
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/ipc/
git commit -m "Add typed TS wrappers for Rust IPC commands"
```

---

## Task 19: TDD `lib/hash.ts` (FNV-1a 32-bit)

**Goal:** Deterministic 32-bit hash used by the cover-palette selector.

**Files:**
- Create: `tests/lib/hash.test.ts`
- Create: `src/lib/hash.ts`

- [ ] **Step 1: Write failing tests**

Create `/Users/creekrichmond/Documents/projects/scholara/tests/lib/hash.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fnv1a32 } from '../../src/lib/hash';

describe('fnv1a32', () => {
  it('returns the FNV-1a 32-bit reference value for empty string', () => {
    // FNV offset basis
    expect(fnv1a32('')).toBe(0x811c9dc5);
  });

  it('returns the documented FNV-1a value for "a"', () => {
    expect(fnv1a32('a')).toBe(0xe40c292c);
  });

  it('is deterministic across repeated calls', () => {
    const a = fnv1a32('War and Peace');
    const b = fnv1a32('War and Peace');
    expect(a).toBe(b);
  });

  it('produces different hashes for different inputs', () => {
    expect(fnv1a32('foo')).not.toBe(fnv1a32('bar'));
  });

  it('returns an unsigned 32-bit value', () => {
    const h = fnv1a32('some long input ----------------');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});
```

- [ ] **Step 2: Run, verify failing**

Run: `npm test -- tests/lib/hash.test.ts`

Expected: fails with "Cannot find module".

- [ ] **Step 3: Implement `src/lib/hash.ts`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/lib/hash.ts`:

```ts
/**
 * FNV-1a 32-bit hash. Used to deterministically select a cover palette
 * and pattern from a book title. Not cryptographic.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
```

- [ ] **Step 4: Run, verify passing**

Run: `npm test -- tests/lib/hash.test.ts`

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/lib/hash.test.ts src/lib/hash.ts
git commit -m "Add FNV-1a 32-bit hash (TDD)"
```

---

## Task 20: TDD `lib/titleCase.ts`

**Goal:** Convert a filename like `war_and_peace-tolstoy.pdf` into "War and Peace Tolstoy" (with smart lowercase function words).

**Files:**
- Create: `tests/lib/titleCase.test.ts`
- Create: `src/lib/titleCase.ts`

- [ ] **Step 1: Write failing tests**

Create `/Users/creekrichmond/Documents/projects/scholara/tests/lib/titleCase.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { titleFromFilename } from '../../src/lib/titleCase';

describe('titleFromFilename', () => {
  it('strips the extension', () => {
    expect(titleFromFilename('war_and_peace.pdf')).toBe('War and Peace');
  });

  it('replaces underscores and dashes with spaces', () => {
    expect(titleFromFilename('the-brothers-karamazov.epub')).toBe(
      'The Brothers Karamazov',
    );
  });

  it('keeps function words lowercase except as the first word', () => {
    expect(titleFromFilename('the_lord_of_the_rings.pdf')).toBe(
      'The Lord of the Rings',
    );
  });

  it('capitalizes the first word even when it is a function word', () => {
    expect(titleFromFilename('a_brief_history_of_time.pdf')).toBe(
      'A Brief History of Time',
    );
  });

  it('collapses multiple separators', () => {
    expect(titleFromFilename('foo___bar--baz.epub')).toBe('Foo Bar Baz');
  });

  it('handles paths by taking only the basename', () => {
    expect(titleFromFilename('/Users/me/Documents/some_book.pdf')).toBe(
      'Some Book',
    );
  });

  it('falls back to "Untitled" for empty / unparseable input', () => {
    expect(titleFromFilename('.pdf')).toBe('Untitled');
    expect(titleFromFilename('')).toBe('Untitled');
  });
});
```

- [ ] **Step 2: Run, verify failing**

Run: `npm test -- tests/lib/titleCase.test.ts`

Expected: fails (module not found).

- [ ] **Step 3: Implement `src/lib/titleCase.ts`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/lib/titleCase.ts`:

```ts
const LOWERCASE_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'in',
  'on',
  'at',
  'by',
  'for',
  'and',
  'or',
  'to',
  'with',
  'from',
  'as',
  'but',
  'nor',
  'is',
]);

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function capitalize(word: string): string {
  if (word.length === 0) return word;
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

export function titleFromFilename(input: string): string {
  if (!input) return 'Untitled';

  const stem = stripExtension(basename(input));
  const cleaned = stem
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length === 0) return 'Untitled';

  const words = cleaned.split(' ');
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i !== 0 && LOWERCASE_WORDS.has(lower)) return lower;
      return capitalize(w);
    })
    .join(' ');
}
```

- [ ] **Step 4: Run, verify passing**

Run: `npm test -- tests/lib/titleCase.test.ts`

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/lib/titleCase.test.ts src/lib/titleCase.ts
git commit -m "Add titleFromFilename with smart function-word casing (TDD)"
```

---

## Task 21: TDD `lib/coverPalette.ts`

**Goal:** Deterministic palette + pattern selection from a title hash.

**Files:**
- Create: `tests/lib/coverPalette.test.ts`
- Create: `src/lib/coverPalette.ts`

- [ ] **Step 1: Write failing tests**

Create `/Users/creekrichmond/Documents/projects/scholara/tests/lib/coverPalette.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  pickPalette,
  pickPattern,
  PALETTES,
  PATTERNS,
} from '../../src/lib/coverPalette';

describe('coverPalette', () => {
  it('exposes 12 palettes and 6 patterns', () => {
    expect(PALETTES).toHaveLength(12);
    expect(PATTERNS).toHaveLength(6);
  });

  it('every palette defines background, accent, ink colors', () => {
    for (const p of PALETTES) {
      expect(p.background).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(p.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(p.ink).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('pickPalette is deterministic for a given hash', () => {
    expect(pickPalette(0xdeadbeef)).toBe(pickPalette(0xdeadbeef));
  });

  it('pickPalette covers the full range modulo 12', () => {
    const seen = new Set<number>();
    for (let h = 0; h < 12 * 100; h++) {
      seen.add(PALETTES.indexOf(pickPalette(h)));
    }
    expect(seen.size).toBe(12);
  });

  it('pickPattern uses the upper bits so titles with same low-bits diverge', () => {
    // Two hashes that share low 8 bits but differ in upper bits.
    const a = 0x000000ff;
    const b = 0x0000ffff;
    expect(pickPattern(a)).not.toBe(pickPattern(b));
  });
});
```

- [ ] **Step 2: Run, verify failing**

Run: `npm test -- tests/lib/coverPalette.test.ts`

Expected: fails (module not found).

- [ ] **Step 3: Implement `src/lib/coverPalette.ts`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/lib/coverPalette.ts`:

```ts
export interface Palette {
  background: string;
  accent: string;
  ink: string;
}

export type Pattern =
  | 'plain'
  | 'paper-grain'
  | 'rule-lines'
  | 'monogram-S'
  | 'marbled'
  | 'dotted-grid';

export const PALETTES: Palette[] = [
  { background: '#F4ECD8', accent: '#B45A2B', ink: '#3A2A1A' }, // parchment + burnt orange
  { background: '#E6E6DC', accent: '#7A8C5E', ink: '#2A2E1F' }, // soft moss
  { background: '#EAE3D2', accent: '#3D5A6C', ink: '#1F2A33' }, // faded sky + ink navy
  { background: '#F2E6D2', accent: '#9C3D2E', ink: '#3B1F1B' }, // cream + brick
  { background: '#E9E2D0', accent: '#7C5B3F', ink: '#2D2118' }, // warm tan
  { background: '#E1E5DC', accent: '#5C7C8A', ink: '#1F2A30' }, // sage + steel blue
  { background: '#F0E2C8', accent: '#7A4E2D', ink: '#3A271A' }, // wheat + sepia
  { background: '#E6DFD2', accent: '#46624A', ink: '#1F2A22' }, // linen + forest
  { background: '#EDE0D4', accent: '#A45A52', ink: '#3A1F1C' }, // bone + rose-clay
  { background: '#E8E3D2', accent: '#6E5B8A', ink: '#28223A' }, // ivory + plum
  { background: '#F0E8D4', accent: '#3A6E6E', ink: '#1F2D2D' }, // pale cream + teal
  { background: '#E5DFCE', accent: '#94733E', ink: '#2D2418' }, // greige + ochre
];

export const PATTERNS: Pattern[] = [
  'plain',
  'paper-grain',
  'rule-lines',
  'monogram-S',
  'marbled',
  'dotted-grid',
];

export function pickPalette(hash: number): Palette {
  const idx = (hash >>> 0) % PALETTES.length;
  return PALETTES[idx];
}

export function pickPattern(hash: number): Pattern {
  const idx = ((hash >>> 0) >>> 8) % PATTERNS.length;
  return PATTERNS[idx];
}
```

- [ ] **Step 4: Run, verify passing**

Run: `npm test -- tests/lib/coverPalette.test.ts`

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/lib/coverPalette.test.ts src/lib/coverPalette.ts
git commit -m "Add curated palette and pattern selection (TDD)"
```

---

## Task 22: Add `lib/cn.ts` and `lib/platform.ts`

**Goal:** Two no-test helpers — one re-exports shadcn's `cn`; the other detects the OS for the Reveal-button label.

**Files:**
- Create: `src/lib/cn.ts`
- Create: `src/lib/platform.ts`

- [ ] **Step 1: Create `src/lib/cn.ts`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/lib/cn.ts`:

```ts
// Re-export so internal modules can import { cn } from '@/lib/cn'.
// shadcn-generated components import from '@/lib/utils'; both point at the
// same function.
export { cn } from './utils';
```

- [ ] **Step 2: Create `src/lib/platform.ts`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/lib/platform.ts`:

```ts
export type Platform = 'macos' | 'windows' | 'linux' | 'unknown';

let cached: Platform | null = null;

export function detectPlatform(): Platform {
  if (cached) return cached;
  if (typeof navigator === 'undefined') {
    cached = 'unknown';
    return cached;
  }
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) cached = 'macos';
  else if (ua.includes('win')) cached = 'windows';
  else if (ua.includes('linux')) cached = 'linux';
  else cached = 'unknown';
  return cached;
}

export function revealLabel(): string {
  switch (detectPlatform()) {
    case 'macos':
      return 'Reveal in Finder';
    case 'windows':
      return 'Show in Explorer';
    case 'linux':
      return 'Open in Files';
    default:
      return 'Open folder';
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/cn.ts src/lib/platform.ts
git commit -m "Add cn re-export and platform-aware reveal label"
```

---

## Task 23: Create the Zustand store

**Goal:** `useAppStore` with `view`, `books`, `apiKey`, `apiKeyBannerDismissed`, and async actions per spec §4.3.

**Files:**
- Create: `src/store.ts`

- [ ] **Step 1: Create `src/store.ts`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/store.ts`:

```ts
import { create } from 'zustand';
import { getDb } from './db/client';
import * as booksDb from './db/books';
import * as secretsIpc from './ipc/secrets';
import type { Book, FileType } from './db/types';

export type AppView = 'library' | 'settings';

interface AppState {
  view: AppView;
  books: Book[];
  apiKey: string | null;
  apiKeyBannerDismissed: boolean;

  setView: (view: AppView) => void;
  loadBooks: () => Promise<void>;
  insertBook: (input: {
    title: string;
    file_path: string;
    file_type: FileType;
  }) => Promise<Book>;
  updateBookMetadata: (
    id: number,
    patch: { title: string; author: string | null },
  ) => Promise<void>;
  deleteBook: (id: number) => Promise<void>;
  loadApiKey: () => Promise<void>;
  saveApiKey: (key: string) => Promise<void>;
  dismissApiKeyBanner: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'library',
  books: [],
  apiKey: null,
  apiKeyBannerDismissed: false,

  setView: (view) => set({ view }),

  loadBooks: async () => {
    const db = await getDb();
    const books = await booksDb.listBooks(db);
    set({ books });
  },

  insertBook: async (input) => {
    const db = await getDb();
    const id = await booksDb.insertBook(db, {
      title: input.title,
      author: null,
      file_path: input.file_path,
      file_type: input.file_type,
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
    const fresh = await booksDb.listBooks(db);
    set({ books: fresh });
  },

  deleteBook: async (id) => {
    const db = await getDb();
    await booksDb.deleteBook(db, id);
    set({ books: get().books.filter((b) => b.id !== id) });
  },

  loadApiKey: async () => {
    const apiKey = await secretsIpc.getApiKey();
    set({ apiKey });
  },

  saveApiKey: async (key) => {
    await secretsIpc.setApiKey(key);
    set({ apiKey: key === '' ? null : key });
  },

  dismissApiKeyBanner: () => set({ apiKeyBannerDismissed: true }),
}));
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/store.ts
git commit -m "Add Zustand app store with view, books, and API-key actions"
```

---

## Task 24: App shell — `App.tsx` + `main.tsx`

**Goal:** Top-level view switch + boot sequence (`loadApiKey` and `loadBooks` in parallel) + the sonner Toaster.

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace `src/App.tsx`**

Replace contents of `/Users/creekrichmond/Documents/projects/scholara/src/App.tsx` with:

```tsx
import { useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { useAppStore } from './store';
import { LibraryScreen } from './screens/Library';
import { SettingsScreen } from './screens/Settings';

export default function App() {
  const view = useAppStore((s) => s.view);
  const loadBooks = useAppStore((s) => s.loadBooks);
  const loadApiKey = useAppStore((s) => s.loadApiKey);

  useEffect(() => {
    void Promise.all([loadApiKey(), loadBooks()]);
  }, [loadApiKey, loadBooks]);

  return (
    <>
      {view === 'library' ? <LibraryScreen /> : <SettingsScreen />}
      <Toaster richColors closeButton position="bottom-right" />
    </>
  );
}
```

This imports `LibraryScreen` and `SettingsScreen` from screens/ — they don't exist yet, so this file will not compile until later tasks. That is intentional; we'll create both before testing the build.

- [ ] **Step 2: Confirm `src/main.tsx`**

Open `/Users/creekrichmond/Documents/projects/scholara/src/main.tsx`. Ensure it looks like:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

If different, replace with the above.

- [ ] **Step 3: Stage but do not commit yet**

The app won't compile until the Library and Settings screens exist (next tasks). Don't run `tauri dev` yet. Don't commit yet — hold these changes until Task 32.

---

## Task 25: `Library/Header.tsx`

**Goal:** "Scholara" wordmark + Settings gear, with a thin divider beneath.

**Files:**
- Create: `src/screens/Library/Header.tsx`

- [ ] **Step 1: Create `src/screens/Library/Header.tsx`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/screens/Library/Header.tsx`:

```tsx
import { Settings as SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '../../store';

export function Header() {
  const setView = useAppStore((s) => s.setView);
  return (
    <header className="flex items-baseline justify-between border-b border-stone-200 pb-4">
      <h1 className="font-serif text-3xl tracking-tight text-ink">Scholara</h1>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Settings"
        onClick={() => setView('settings')}
      >
        <SettingsIcon className="h-5 w-5" />
      </Button>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/Library/Header.tsx
git commit -m "Add Library header with Scholara wordmark and Settings gear"
```

---

## Task 26: `Library/ApiKeyBanner.tsx`

**Goal:** Amber banner shown only when API key is null and not dismissed for the session.

**Files:**
- Create: `src/screens/Library/ApiKeyBanner.tsx`

- [ ] **Step 1: Create `src/screens/Library/ApiKeyBanner.tsx`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/screens/Library/ApiKeyBanner.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import { useAppStore } from '../../store';

export function ApiKeyBanner() {
  const apiKey = useAppStore((s) => s.apiKey);
  const dismissed = useAppStore((s) => s.apiKeyBannerDismissed);
  const setView = useAppStore((s) => s.setView);
  const dismiss = useAppStore((s) => s.dismissApiKeyBanner);

  if (apiKey !== null || dismissed) return null;

  return (
    <div
      role="status"
      className="animate-banner-in flex items-center justify-between gap-4 rounded-md border border-accent-amber/40 bg-accent-amber/10 px-4 py-2 text-sm text-ink"
    >
      <span>Add your Anthropic API key to unlock the AI study mentor.</span>
      <div className="flex gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={() => setView('settings')}
        >
          Set up
        </Button>
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Later
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/Library/ApiKeyBanner.tsx
git commit -m "Add API-key banner with Set up / Later actions"
```

---

## Task 27: `Library/GeneratedCover.tsx`

**Goal:** Inline SVG cover that takes either an explicit `imageSrc` or generates from `(title, author)`.

**Files:**
- Create: `src/screens/Library/GeneratedCover.tsx`

- [ ] **Step 1: Create `src/screens/Library/GeneratedCover.tsx`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/screens/Library/GeneratedCover.tsx`:

```tsx
import { memo } from 'react';
import { fnv1a32 } from '../../lib/hash';
import { pickPalette, pickPattern } from '../../lib/coverPalette';

interface Props {
  title: string;
  author: string | null;
  imageSrc?: string;
}

function autoFitTitleSize(title: string): number {
  if (title.length <= 14) return 24;
  if (title.length <= 24) return 20;
  if (title.length <= 36) return 16;
  return 14;
}

function PatternFill({ pattern, color }: { pattern: string; color: string }) {
  switch (pattern) {
    case 'paper-grain':
      return (
        <pattern
          id={`pat-${pattern}`}
          patternUnits="userSpaceOnUse"
          width="4"
          height="4"
        >
          <circle cx="1" cy="1" r="0.3" fill={color} fillOpacity="0.06" />
          <circle cx="3" cy="3" r="0.3" fill={color} fillOpacity="0.06" />
        </pattern>
      );
    case 'rule-lines':
      return (
        <pattern
          id={`pat-${pattern}`}
          patternUnits="userSpaceOnUse"
          width="100"
          height="14"
        >
          <line
            x1="0"
            x2="100"
            y1="13"
            y2="13"
            stroke={color}
            strokeOpacity="0.06"
            strokeWidth="0.5"
          />
        </pattern>
      );
    case 'dotted-grid':
      return (
        <pattern
          id={`pat-${pattern}`}
          patternUnits="userSpaceOnUse"
          width="8"
          height="8"
        >
          <circle cx="1" cy="1" r="0.6" fill={color} fillOpacity="0.07" />
        </pattern>
      );
    case 'marbled':
      return (
        <pattern
          id={`pat-${pattern}`}
          patternUnits="userSpaceOnUse"
          width="40"
          height="40"
        >
          <path
            d="M0 20 Q10 10 20 20 T40 20"
            stroke={color}
            strokeOpacity="0.05"
            strokeWidth="0.6"
            fill="none"
          />
        </pattern>
      );
    case 'monogram-S':
      return (
        <pattern
          id={`pat-${pattern}`}
          patternUnits="userSpaceOnUse"
          width="200"
          height="300"
        >
          <text
            x="100"
            y="170"
            textAnchor="middle"
            fontFamily="Iowan Old Style, Georgia, serif"
            fontSize="120"
            fill={color}
            fillOpacity="0.05"
          >
            S
          </text>
        </pattern>
      );
    default:
      return null;
  }
}

function wrapTitle(title: string, maxCharsPerLine: number): string[] {
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (candidate.length > maxCharsPerLine && line) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
    if (lines.length === 2 && line.length > maxCharsPerLine) {
      // truncate third+ line as ellipsis on previous final
      const ell = line.slice(0, maxCharsPerLine - 1) + '…';
      lines.push(ell);
      return lines.slice(0, 3);
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function GeneratedCoverImpl({ title, author, imageSrc }: Props) {
  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={`${title} cover`}
        className="h-full w-full rounded-md object-cover shadow-sm"
        draggable={false}
      />
    );
  }

  const hash = fnv1a32(title);
  const palette = pickPalette(hash);
  const pattern = pickPattern(hash);
  const fontSize = autoFitTitleSize(title);
  const charsPerLine = Math.max(6, Math.floor(180 / (fontSize * 0.55)));
  const lines = wrapTitle(title, charsPerLine);

  return (
    <svg
      viewBox="0 0 200 300"
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full rounded-md shadow-sm"
      role="img"
      aria-label={`${title} cover`}
    >
      <defs>
        <PatternFill pattern={pattern} color={palette.ink} />
      </defs>
      <rect width="200" height="300" fill={palette.background} />
      {pattern !== 'plain' && (
        <rect width="200" height="300" fill={`url(#pat-${pattern})`} />
      )}
      <rect x="0" y="28" width="200" height="2" fill={palette.accent} />
      <g
        fontFamily="Iowan Old Style, Palatino Linotype, Georgia, serif"
        fill={palette.ink}
        textAnchor="middle"
      >
        {lines.map((line, i) => (
          <text
            key={i}
            x="100"
            y={90 + i * (fontSize + 4)}
            fontSize={fontSize}
            fontWeight={600}
          >
            {line}
          </text>
        ))}
        {author && (
          <text
            x="100"
            y="240"
            fontSize="12"
            fontStyle="italic"
            fillOpacity="0.7"
          >
            {author}
          </text>
        )}
      </g>
      <line
        x1="40"
        x2="160"
        y1="270"
        y2="270"
        stroke={palette.accent}
        strokeWidth="1"
      />
      <line
        x1="40"
        x2="160"
        y1="274"
        y2="274"
        stroke={palette.accent}
        strokeWidth="0.5"
      />
    </svg>
  );
}

export const GeneratedCover = memo(
  GeneratedCoverImpl,
  (a, b) =>
    a.title === b.title && a.author === b.author && a.imageSrc === b.imageSrc,
);
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/Library/GeneratedCover.tsx
git commit -m "Add deterministic SVG GeneratedCover component"
```

---

## Task 28: `Library/EditMetadataModal.tsx`

**Goal:** Modal to edit title/author and (optionally) delete the book.

**Files:**
- Create: `src/screens/Library/EditMetadataModal.tsx`

- [ ] **Step 1: Create `src/screens/Library/EditMetadataModal.tsx`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/screens/Library/EditMetadataModal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppStore } from '../../store';
import type { Book } from '../../db/types';

interface Props {
  book: Book | null;
  open: boolean;
  onClose: () => void;
}

export function EditMetadataModal({ book, open, onClose }: Props) {
  const updateBookMetadata = useAppStore((s) => s.updateBookMetadata);
  const deleteBook = useAppStore((s) => s.deleteBook);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (book) {
      setTitle(book.title);
      setAuthor(book.author ?? '');
      setConfirmingDelete(false);
    }
  }, [book]);

  if (!book) return null;

  const handleSave = async () => {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      toast.error('Title cannot be empty.');
      return;
    }
    try {
      await updateBookMetadata(book.id, {
        title: trimmed,
        author: author.trim() === '' ? null : author.trim(),
      });
      toast.success('Updated.');
      onClose();
    } catch (err) {
      toast.error(`Could not save changes: ${(err as Error).message}`);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteBook(book.id);
      toast.success('Deleted.');
      onClose();
    } catch (err) {
      toast.error(`Could not delete: ${(err as Error).message}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit metadata</DialogTitle>
          <DialogDescription>
            Update the title and author for this book.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="emm-title">Title</Label>
            <Input
              id="emm-title"
              value={title}
              maxLength={300}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="emm-author">Author</Label>
            <Input
              id="emm-author"
              value={author}
              maxLength={300}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          {!confirmingDelete ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete book
            </Button>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span>
                Delete &ldquo;{book.title}&rdquo;? This removes the file and any
                notes.
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
              >
                Delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </Button>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/Library/EditMetadataModal.tsx
git commit -m "Add EditMetadataModal with title/author edit and delete confirm"
```

---

## Task 29: `Library/BookTile.tsx`

**Goal:** Single book tile with hover overflow menu (Edit metadata).

**Files:**
- Create: `src/screens/Library/BookTile.tsx`

- [ ] **Step 1: Create `src/screens/Library/BookTile.tsx`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/screens/Library/BookTile.tsx`:

```tsx
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import type { Book } from '../../db/types';
import { GeneratedCover } from './GeneratedCover';

interface Props {
  book: Book;
  onEdit: (book: Book) => void;
}

export function BookTile({ book, onEdit }: Props) {
  return (
    <div className="group flex flex-col gap-2">
      <button
        type="button"
        className="relative aspect-[2/3] w-full overflow-hidden rounded-md transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-accent-gold"
        onClick={() => {
          console.log('Open book', book.id);
          toast('Reader coming in the next phase.');
        }}
        aria-label={`Open ${book.title}`}
      >
        <GeneratedCover
          title={book.title}
          author={book.author}
          imageSrc={book.cover_image_path ?? undefined}
        />
        <div className="absolute right-1 top-1 opacity-0 transition group-hover:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="h-7 w-7 rounded-full bg-cream/90 backdrop-blur"
                aria-label="More actions"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem onSelect={() => onEdit(book)}>
                Edit metadata
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </button>
      <div className="space-y-0.5 px-1">
        <div className="font-serif text-sm leading-tight text-ink line-clamp-2">
          {book.title}
        </div>
        {book.author && (
          <div className="text-xs text-ink-muted">{book.author}</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/Library/BookTile.tsx
git commit -m "Add BookTile with hover overflow Edit metadata menu"
```

---

## Task 30: `Library/AddBookButton.tsx` (quill-and-inkwell)

**Goal:** The signature animated tile from spec §8.6 — same component for in-grid `+` and the empty-state CTA.

**Files:**
- Create: `src/screens/Library/AddBookButton.tsx`

- [ ] **Step 1: Create `src/screens/Library/AddBookButton.tsx`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/screens/Library/AddBookButton.tsx`:

```tsx
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { toast } from 'sonner';
import { copyUploadedFile } from '../../ipc/files';
import { titleFromFilename } from '../../lib/titleCase';
import { useAppStore } from '../../store';
import type { Book } from '../../db/types';
import { cn } from '../../lib/cn';

interface Props {
  variant: 'tile' | 'cta';
  onAdded?: (book: Book) => void;
}

export function AddBookButton({ variant, onAdded }: Props) {
  const insertBook = useAppStore((s) => s.insertBook);
  const [hovered, setHovered] = useState(false);

  const handleAdd = async () => {
    let selected: string | string[] | null = null;
    try {
      selected = await openDialog({
        multiple: false,
        filters: [{ name: 'Books', extensions: ['pdf', 'epub'] }],
      });
    } catch (err) {
      toast.error(`Could not open file picker: ${(err as Error).message}`);
      return;
    }
    if (!selected || Array.isArray(selected)) return;

    try {
      const { storedPath, fileType } = await copyUploadedFile(selected);
      const title = titleFromFilename(selected);
      const book = await insertBook({
        title,
        file_path: storedPath,
        file_type: fileType,
      });
      toast.success(`Added "${book.title}"`, {
        action: onAdded
          ? { label: 'Edit', onClick: () => onAdded(book) }
          : undefined,
      });
    } catch (err) {
      toast.error(
        `Could not save book. Try again or choose a different file. (${(err as Error).message})`,
      );
    }
  };

  const isCta = variant === 'cta';

  return (
    <button
      type="button"
      onClick={handleAdd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      aria-label="Add a book"
      className={cn(
        'group relative flex flex-col items-center justify-center rounded-md border border-dashed border-stone-300 bg-cream/50 transition focus:outline-none focus:ring-2 focus:ring-accent-gold',
        isCta ? 'aspect-[2/3] w-60' : 'aspect-[2/3] w-full',
      )}
    >
      <Quill hovered={hovered} />
      {isCta && (
        <div className="mt-4 font-serif text-base text-ink-muted">
          Begin a new study.
        </div>
      )}
    </button>
  );
}

function Quill({ hovered }: { hovered: boolean }) {
  return (
    <svg
      viewBox="0 0 200 300"
      className="h-full w-full"
      role="presentation"
      aria-hidden="true"
    >
      {/* Inkwell */}
      <motion.g
        initial={false}
        animate={hovered ? { scale: 1.02 } : { scale: 1 }}
        transition={{ duration: 0.4 }}
        style={{ transformOrigin: '100px 240px' }}
      >
        <ellipse cx="100" cy="245" rx="34" ry="8" fill="#E5DCC8" />
        <path
          d="M70 240 Q70 260 100 262 Q130 260 130 240 Z"
          fill="#F5EFE0"
          stroke="#A89880"
          strokeWidth="1"
        />
        <ellipse cx="100" cy="240" rx="30" ry="6" fill="#3A2A1A" />
      </motion.g>

      {/* Quill - drifts when idle, lifts on hover */}
      <motion.g
        initial={false}
        animate={
          hovered
            ? { rotate: -8, x: 10, y: -30 }
            : {
                rotate: [-2, 2, -2],
                x: [-1, 1, -1],
                y: [0, -1, 0],
              }
        }
        transition={
          hovered
            ? { duration: 0.25, ease: 'easeOut' }
            : { duration: 4, ease: 'easeInOut', repeat: Infinity }
        }
        style={{ transformOrigin: '100px 240px' }}
      >
        {/* Feather */}
        <path
          d="M120 80 Q140 130 130 200 Q120 220 110 230 Q108 215 115 200 Q120 150 118 100 Z"
          fill="#F4ECD8"
          stroke="#B8A98E"
          strokeWidth="0.8"
        />
        {/* Spine */}
        <line x1="120" y1="80" x2="110" y2="232" stroke="#7A6A52" strokeWidth="1.5" />
        {/* Nib */}
        <path
          d="M108 232 L112 232 L113 244 L107 244 Z"
          fill="#3A2A1A"
        />
        {/* Ink stain near nib */}
        <ellipse cx="110" cy="244" rx="2" ry="1.2" fill="#3A2A1A" />
      </motion.g>

      {/* Calligraphic flourish drawn on hover */}
      <AnimatePresence>
        {hovered && (
          <motion.path
            key="flourish"
            d="M50 130 C70 110, 130 110, 150 130 M95 110 L95 150 M75 130 L115 130"
            stroke="#B45A2B"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            transition={{ pathLength: { duration: 0.6, ease: 'easeInOut' } }}
          />
        )}
      </AnimatePresence>
    </svg>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/Library/AddBookButton.tsx
git commit -m "Add quill-and-inkwell AddBookButton with hover flourish animation"
```

---

## Task 31: `Library/BookGrid.tsx` and the two placeholders

**Goal:** Grid container handling empty state, plus the two reserved-space placeholders for Phase 4.

**Files:**
- Create: `src/screens/Library/BookGrid.tsx`
- Create: `src/screens/Library/BrainPlaceholder.tsx`
- Create: `src/screens/Library/ScrollStripPlaceholder.tsx`

- [ ] **Step 1: Create `src/screens/Library/BookGrid.tsx`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/screens/Library/BookGrid.tsx`:

```tsx
import type { Book } from '../../db/types';
import { BookTile } from './BookTile';
import { AddBookButton } from './AddBookButton';

interface Props {
  books: Book[];
  onEdit: (book: Book) => void;
  onAdded: (book: Book) => void;
}

export function BookGrid({ books, onEdit, onAdded }: Props) {
  if (books.length === 0) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center">
        <AddBookButton variant="cta" onAdded={onAdded} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-8">
      {books.map((b) => (
        <BookTile key={b.id} book={b} onEdit={onEdit} />
      ))}
      <AddBookButton variant="tile" onAdded={onAdded} />
    </div>
  );
}
```

- [ ] **Step 2: Create `src/screens/Library/BrainPlaceholder.tsx`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/screens/Library/BrainPlaceholder.tsx`:

```tsx
// DEFERRED: WebGL brain animation (Phase 4)
export function BrainPlaceholder() {
  return (
    <div
      aria-hidden="true"
      className="flex-[2] rounded-md border border-stone-200 bg-stone-100/40"
    />
  );
}
```

- [ ] **Step 3: Create `src/screens/Library/ScrollStripPlaceholder.tsx`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/screens/Library/ScrollStripPlaceholder.tsx`:

```tsx
// DEFERRED: scrolling vocab/notes/quotes strip (Phase 4)
export function ScrollStripPlaceholder() {
  return (
    <div
      aria-hidden="true"
      className="flex-[3] rounded-md border border-stone-200 bg-stone-100/40"
    />
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/screens/Library/BookGrid.tsx src/screens/Library/BrainPlaceholder.tsx src/screens/Library/ScrollStripPlaceholder.tsx
git commit -m "Add BookGrid and deferred-feature placeholders"
```

---

## Task 32: `Library/index.tsx` (composition + drag-and-drop)

**Goal:** Top-level Library screen tying header, banner, grid, and right-column placeholders together. Window-level drag-and-drop for `.pdf` / `.epub` files.

**Files:**
- Create: `src/screens/Library/index.tsx`

- [ ] **Step 1: Create `src/screens/Library/index.tsx`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/screens/Library/index.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useAppStore } from '../../store';
import { copyUploadedFile } from '../../ipc/files';
import { titleFromFilename } from '../../lib/titleCase';
import type { Book } from '../../db/types';
import { Header } from './Header';
import { ApiKeyBanner } from './ApiKeyBanner';
import { BookGrid } from './BookGrid';
import { BrainPlaceholder } from './BrainPlaceholder';
import { ScrollStripPlaceholder } from './ScrollStripPlaceholder';
import { EditMetadataModal } from './EditMetadataModal';

export function LibraryScreen() {
  const books = useAppStore((s) => s.books);
  const insertBook = useAppStore((s) => s.insertBook);
  const [editing, setEditing] = useState<Book | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    const setup = async () => {
      unlisten = await listen<{ paths: string[] }>(
        'tauri://drag-drop',
        async (event) => {
          const paths = event.payload.paths.filter((p) =>
            /\.(pdf|epub)$/i.test(p),
          );
          if (paths.length === 0) {
            toast.error('Only PDF and EPUB files are supported.');
            return;
          }
          for (const p of paths) {
            try {
              const { storedPath, fileType } = await copyUploadedFile(p);
              const title = titleFromFilename(p);
              const book = await insertBook({
                title,
                file_path: storedPath,
                file_type: fileType,
              });
              toast.success(`Added "${book.title}"`, {
                action: { label: 'Edit', onClick: () => setEditing(book) },
              });
            } catch (err) {
              toast.error(
                `Could not save dropped file: ${(err as Error).message}`,
              );
            }
          }
        },
      );
    };
    void setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, [insertBook]);

  return (
    <div className="grid h-full grid-cols-[1fr_20rem]">
      <main className="flex flex-col gap-6 overflow-y-auto px-12 py-8">
        <ApiKeyBanner />
        <Header />
        <BookGrid books={books} onEdit={setEditing} onAdded={setEditing} />
      </main>
      <aside className="flex flex-col gap-4 border-l border-stone-200 p-6">
        <BrainPlaceholder />
        <ScrollStripPlaceholder />
      </aside>
      <EditMetadataModal
        book={editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/Library/index.tsx
git commit -m "Compose LibraryScreen with header, banner, grid, placeholders, drag-drop"
```

---

## Task 33: `Settings/ApiKeyForm.tsx`

**Goal:** Masked API key input with Show/Save buttons, backed by the keychain.

**Files:**
- Create: `src/screens/Settings/ApiKeyForm.tsx`

- [ ] **Step 1: Create `src/screens/Settings/ApiKeyForm.tsx`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/screens/Settings/ApiKeyForm.tsx`:

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppStore } from '../../store';

export function ApiKeyForm() {
  const apiKey = useAppStore((s) => s.apiKey);
  const saveApiKey = useAppStore((s) => s.saveApiKey);
  const [revealed, setRevealed] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  // Render value: if user is editing (draft is set), show draft; otherwise
  // either dots (key set, masked) or empty (no key).
  const displayValue =
    draft !== null ? draft : revealed && apiKey !== null ? apiKey : apiKey ? '●●●●●●●●●●●●●●●●' : '';

  const handleShow = () => {
    setRevealed((r) => !r);
    if (draft === null && apiKey !== null) {
      // First show: copy current key into draft so the input is now editable.
      setDraft(apiKey);
    }
  };

  const handleSave = async () => {
    const value = draft ?? '';
    try {
      await saveApiKey(value);
      toast.success(value === '' ? 'API key cleared.' : 'API key saved.');
      setDraft(null);
      setRevealed(false);
    } catch (err) {
      toast.error(`Could not save API key: ${(err as Error).message}`);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
        Anthropic API Key
      </h2>
      <p className="text-sm text-ink-muted">
        Used by the AI study mentor. Stored in your OS keychain; never written
        to disk by Scholara.
      </p>
      <div className="flex gap-2">
        <Input
          type={revealed ? 'text' : 'password'}
          value={displayValue}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="sk-ant-..."
          className="font-mono"
        />
        <Button variant="ghost" onClick={handleShow}>
          {revealed ? 'Hide' : 'Show'}
        </Button>
        <Button onClick={handleSave} disabled={draft === null}>
          Save
        </Button>
      </div>
      <a
        href="https://console.anthropic.com"
        target="_blank"
        rel="noreferrer"
        className="text-sm text-accent-amber underline-offset-2 hover:underline"
      >
        Get a key at console.anthropic.com →
      </a>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/Settings/ApiKeyForm.tsx
git commit -m "Add Settings ApiKeyForm with masked input, Show, and Save"
```

---

## Task 34: `Settings/DataLocationPanel.tsx`

**Goal:** Display the app data dir path with platform-aware Reveal button.

**Files:**
- Create: `src/screens/Settings/DataLocationPanel.tsx`

- [ ] **Step 1: Create `src/screens/Settings/DataLocationPanel.tsx`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/screens/Settings/DataLocationPanel.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { appDataDirPath, revealInFileManager } from '../../ipc/files';
import { revealLabel } from '../../lib/platform';

export function DataLocationPanel() {
  const [path, setPath] = useState<string>('');

  useEffect(() => {
    appDataDirPath()
      .then(setPath)
      .catch((err) => toast.error(`Could not read data path: ${(err as Error).message}`));
  }, []);

  const handleReveal = async () => {
    if (!path) return;
    try {
      await revealInFileManager(path);
    } catch (err) {
      toast.error(`Could not reveal: ${(err as Error).message}`);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
        Your Library
      </h2>
      <p className="text-sm text-ink-muted">
        Your books and notes are stored locally at:
      </p>
      <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-sm text-ink select-all">
        {path || 'Loading…'}
      </div>
      <Button variant="outline" onClick={handleReveal} disabled={!path}>
        {revealLabel()}
      </Button>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/Settings/DataLocationPanel.tsx
git commit -m "Add DataLocationPanel with platform-aware Reveal button"
```

---

## Task 35: `Settings/index.tsx`

**Goal:** Settings screen layout with back link.

**Files:**
- Create: `src/screens/Settings/index.tsx`

- [ ] **Step 1: Create `src/screens/Settings/index.tsx`**

Create `/Users/creekrichmond/Documents/projects/scholara/src/screens/Settings/index.tsx`:

```tsx
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '../../store';
import { ApiKeyForm } from './ApiKeyForm';
import { DataLocationPanel } from './DataLocationPanel';

export function SettingsScreen() {
  const setView = useAppStore((s) => s.setView);
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-8 px-12 py-8 overflow-y-auto">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit"
        onClick={() => setView('library')}
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        Library
      </Button>
      <h1 className="font-serif text-3xl tracking-tight text-ink">Settings</h1>
      <hr className="border-stone-200" />
      <ApiKeyForm />
      <hr className="border-stone-200" />
      <DataLocationPanel />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/Settings/index.tsx
git commit -m "Compose SettingsScreen with API key form and data location panel"
```

---

## Task 36: First end-to-end build

**Goal:** Stage and commit `App.tsx` (held since Task 24), then verify the whole app boots and the dev loop works.

**Files:**
- Modify: `src/App.tsx` (already edited in Task 24, but uncommitted)
- Modify: `src/main.tsx` (already edited in Task 24, possibly uncommitted)

- [ ] **Step 1: Verify `src/App.tsx` matches Task 24's content**

Open `/Users/creekrichmond/Documents/projects/scholara/src/App.tsx` and confirm it imports `LibraryScreen` from `./screens/Library` and `SettingsScreen` from `./screens/Settings`.

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`

Expected: no errors. If errors appear, fix the import paths or missing exports they point to.

- [ ] **Step 3: Run `npm run tauri dev` and smoke-test the empty state**

Run: `npm run tauri dev`

Expected: window opens, displaying:
- "Scholara" wordmark in serif at the top-left.
- Settings gear at the top-right.
- Centered quill-and-inkwell empty-state CTA with "Begin a new study." beneath.
- Right-column placeholder rectangles (subtle stone fill) for the brain animation and scrolling strip.
- Amber API-key banner at the top (since no key has been saved yet).

Hover the quill: it lifts away from the inkwell and the orange flourish strokes onto the tile. Un-hover: flourish fades.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/main.tsx
git commit -m "Wire App shell with view switch, boot sequence, and Toaster"
```

---

## Task 37: Final verification (manual + automated)

**Goal:** Walk through every item in spec §13, the Foundation "done" checklist.

**Files:** none (verification only).

- [ ] **Step 1: Run automated tests**

Run: `npm test`

Expected: all tests pass — `tests/db/books.test.ts` (5 tests), `tests/lib/hash.test.ts` (5), `tests/lib/titleCase.test.ts` (7), `tests/lib/coverPalette.test.ts` (5). Total: 22 tests.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: zero errors. Warnings are acceptable but should be reviewed.

If lint fails on rules unrelated to actual problems, fix them. Common scaffolded-in lint issues: `react-refresh/only-export-components`, unused imports, missing dep arrays.

- [ ] **Step 3: Smoke-test against spec §13 item 1 — empty state on launch**

Run: `npm run tauri dev`

Verify: header, empty-state quill-and-inkwell CTA, right-column placeholders, amber banner all visible.

- [ ] **Step 4: Smoke-test §13 item 2 — Add a book via the picker**

Click the quill-and-inkwell CTA. Select a `.pdf` or `.epub` from your machine.

Verify: file is copied to the app data dir; tile appears in grid with generated cover, filename-derived title, no author. Toast: `Added "..."` with `Edit` action.

- [ ] **Step 5: Smoke-test §13 item 3 — Edit metadata**

Hover an existing tile. Click the `⋯` overflow → "Edit metadata". Modal opens with current title in the input. Edit title, add an author, click Save.

Verify: tile re-renders with new title/author. Inspect SQLite (in another terminal):

```bash
sqlite3 "$HOME/Library/Application Support/com.scholara.app/scholara.db" "SELECT title, author, metadata_source FROM books;"
```

(Or the appropriate path on Linux/Windows — see `app_data_dir_path` IPC.)

Expected output: row with the edited title, edited author, and `metadata_source = user`.

- [ ] **Step 6: Smoke-test §13 item 4 — Delete a book**

Open the Edit modal, click "Delete book", confirm. Tile disappears. Re-query SQLite — row gone.

- [ ] **Step 7: Smoke-test §13 item 5 — DB persistence**

Quit the app (Cmd-Q / Alt-F4 / equivalent). Re-launch with `npm run tauri dev`.

Verify: previously-uploaded books still appear.

- [ ] **Step 8: Smoke-test §13 item 6 — API key persistence via keychain**

Click Settings gear. Enter an API key (any non-empty string works for this smoke test). Click Save. Toast: "API key saved."

Quit. Re-launch.

Click Settings. The input shows masked dots. Click Show — actual key text appears.

- [ ] **Step 9: Smoke-test §13 item 7 — Banner behavior**

In Settings, clear the API key (empty input → Save → "API key cleared.") and return to Library.

Verify: amber banner appears.

Click "Later" — banner disappears for the session. Quit and re-launch — banner returns.

Click "Set up" on the banner — navigates to Settings. Save a key — return to Library — banner gone.

- [ ] **Step 10: Smoke-test §13 item 8 — Reveal in Finder**

Settings → "Reveal in Finder" (or platform-equivalent label).

Verify: OS file manager opens at the app data dir.

- [ ] **Step 11: Smoke-test §13 item 9 — Drag-and-drop**

Drag a `.pdf` or `.epub` from the OS file manager onto the app window.

Verify: same outcome as Add Book click — file copied, tile appears, toast shown.

Drag a non-supported file (e.g., `.txt`).

Verify: toast: "Only PDF and EPUB files are supported."

- [ ] **Step 12: Production build**

Quit dev mode. Run: `npm run tauri:build`

Expected: build completes; an installable bundle exists in `src-tauri/target/release/bundle/`. Inspect:
```bash
ls -lh src-tauri/target/release/bundle/
```

- [ ] **Step 13: Final commit (lint/typecheck fixes if any)**

If any tweaks were necessary during verification:

```bash
git add -A
git commit -m "Address verification fixes for Foundation"
```

If no fixes were needed, no commit — Foundation is done.

---

## Self-review checklist (already applied)

**Spec coverage:** every numbered "done" item in spec §13 has a verification step in Task 37; every section in spec §4–§11 has a corresponding implementation task.

**Placeholder scan:** no "TBD", "TODO", "implement later", or "appropriate error handling" sentinels in plan steps.

**Type consistency:** `Book`, `SqlExecutor`, `FileType`, store action names (`insertBook`, `updateBookMetadata`, `deleteBook`, `loadApiKey`, `saveApiKey`, `dismissApiKeyBanner`), and IPC function names (`copyUploadedFile`, `appDataDirPath`, `revealInFileManager`, `getApiKey`, `setApiKey`) are used identically across all tasks where they appear.

**Open-spec coverage gaps closed:** the spec mentions a `Toaster` (sonner) — wired in Task 24 / shadcn add in Task 6. Drag-drop event name (`tauri://drag-drop`) confirmed for Tauri 2 in Task 32.
