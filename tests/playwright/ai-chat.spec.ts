import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Reuse the existing EPUB fixture — Worker F decision: do not add new binaries.
const SAMPLE_EPUB = readFileSync(
  fileURLToPath(new URL('../fixtures/sample.epub', import.meta.url)),
);

interface ChatTestHooks {
  seedBook(input: {
    title: string;
    file_path: string;
    file_type: 'epub';
  }): Promise<{ id: number }>;
  seedChatIndex(input: {
    book_id: number;
    chunks?: string[];
    positionMarkers?: string[];
  }): Promise<void>;
}

declare global {
  interface Window {
    __appTestHooks: ChatTestHooks;
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((bytes) => {
    (
      window as Window & { __SCHOLARA_FIXTURES__?: Record<string, number[]> }
    ).__SCHOLARA_FIXTURES__ = { '/mock/sample.epub': bytes };

    // Default chat_stream script — overridable per-test by reassigning before send.
    (
      window as Window & {
        __SCHOLARA_CHAT_STREAM__?: { textChunks?: string[]; delayMs?: number };
      }
    ).__SCHOLARA_CHAT_STREAM__ = {
      textChunks: ['Hello from the ', 'mocked OpenRouter ', 'stream.'],
      delayMs: 0,
    };

    // chat_oneshot is invoked by the auto-titler / profile updater. They are
    // gated behind turn-count thresholds so they will not actually fire on
    // the first turn, but we still provide a stub to make the mock loud-fail
    // safe rather than silent.
    (
      window as Window & {
        __SCHOLARA_CHAT_ONESHOT__?: { text?: string };
      }
    ).__SCHOLARA_CHAT_ONESHOT__ = { text: '' };
  }, Array.from(SAMPLE_EPUB));

  await page.goto('/');
  await page.waitForFunction(() => '__appTestHooks' in window);
});

test('AI Chat tab streams a mocked assistant turn end-to-end', async ({ page }) => {
  // Seed a book and pre-fill the chat index so the tab opens straight into
  // the chat UI (no real transformers.js / extractText pipeline).
  const seededBook = await page.evaluate(async () => {
    const book = await window.__appTestHooks.seedBook({
      title: 'Chat EPUB',
      file_path: '/mock/sample.epub',
      file_type: 'epub',
    });
    await window.__appTestHooks.seedChatIndex({
      book_id: book.id,
      chunks: ['First stub chunk.', 'Second stub chunk.', 'Third stub chunk.'],
    });
    return book;
  });
  expect(seededBook.id).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Open Chat EPUB' }).click();
  // Reader iframe loads — confirms we are in Agent Display mode where the
  // panel (and AI Chat as the default tab) is mounted.
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 10_000 });

  const composer = page.getByPlaceholder('Ask about this book…');
  await expect(composer).toBeVisible();

  // The empty state copy is rendered before the user sends anything.
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();

  await composer.fill('What is this chapter about?');
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
  await page.getByRole('button', { name: 'Send' }).click();

  // User bubble appears.
  await expect(page.getByText('What is this chapter about?')).toBeVisible();

  // Assistant streams the mocked text. After all deltas, the composer
  // returns to its enabled (send) state. The assertion below also verifies
  // that the streaming text is actually rendered in the message list.
  await expect(
    page.getByText('Hello from the mocked OpenRouter stream.'),
  ).toBeVisible({ timeout: 5_000 });

  // After streaming finishes, the Send button replaces the Cancel/Stop one.
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({
    timeout: 5_000,
  });
});

test('Settings model picker shows free default and persists across reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click();

  const select = page.getByRole('combobox').first();
  await expect(select).toBeVisible({ timeout: 5_000 });

  // Default is the first MODELS entry, which is a free Llama tier; the label
  // must include "(free)" to match the curated model list.
  const initialValue = await select.inputValue();
  expect(initialValue).toContain(':free');

  const selected = await page
    .locator('option', { hasText: '(free)' })
    .first()
    .innerText();
  expect(selected).toMatch(/\(free\)/);

  // Switch to a different free model and verify it persists across reload.
  await select.selectOption('openai/gpt-oss-120b:free');
  await expect(select).toHaveValue('openai/gpt-oss-120b:free');

  await page.reload();
  await page.waitForFunction(() => '__appTestHooks' in window);
  await page.getByRole('button', { name: 'Settings' }).click();

  const reloadedSelect = page.getByRole('combobox').first();
  await expect(reloadedSelect).toHaveValue('openai/gpt-oss-120b:free', {
    timeout: 5_000,
  });
});
