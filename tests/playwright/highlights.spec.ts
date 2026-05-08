import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SAMPLE_EPUB = readFileSync(
  fileURLToPath(new URL('../fixtures/sample.epub', import.meta.url)),
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript((bytes) => {
    (window as Window & { __SCHOLARA_FIXTURES__?: Record<string, number[]> }).__SCHOLARA_FIXTURES__ =
      { '/mock/sample.epub': bytes };
  }, Array.from(SAMPLE_EPUB));

  await page.goto('/');
  await page.waitForFunction(() => '__appTestHooks' in window);
});

test('range selection outside notes mode saves a quote-only highlight', async ({ page }) => {
  const seededBook = await seedEpub(page, 'Highlight EPUB');

  await page.getByRole('button', { name: 'Open Highlight EPUB' }).click();
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 10_000 });

  const currentPosition = await waitForCurrentPosition(page);
  await dispatchSelection(page, currentPosition, 'A highlighted passage');

  await page.getByRole('button', { name: 'Highlight text' }).click();

  await expect
    .poll(async () => listNotes(page, seededBook.id))
    .toMatchObject([
      {
        note_text: null,
        quote_text: 'A highlighted passage',
      },
    ]);

  await page.getByRole('tab', { name: 'Notes' }).click();
  await expect(page.getByText('A highlighted passage')).toBeVisible();
});

test('notes mode shows selected quote as a connected orange bubble', async ({ page }) => {
  const seededBook = await seedEpub(page, 'Bubble EPUB');

  await page.getByRole('button', { name: 'Open Bubble EPUB' }).click();
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 10_000 });

  await page.keyboard.press('n');
  const currentPosition = await waitForCurrentPosition(page);
  await dispatchSelection(page, currentPosition, 'A connected quote');

  const bubble = page.getByText('“A connected quote”');
  await expect(bubble).toBeVisible();
  await expect(bubble.locator('..')).toHaveClass(/text-accent-orange/);

  await page.getByPlaceholder('Add a note…').fill('This note is linked');
  await page.getByRole('button', { name: 'Save note' }).click();

  await expect
    .poll(async () => listNotes(page, seededBook.id))
    .toMatchObject([
      {
        note_text: 'This note is linked',
        quote_text: 'A connected quote',
      },
    ]);
});

async function seedEpub(page: Page, title: string) {
  return page.evaluate(async (bookTitle) => {
    return (window as Window & {
      __appTestHooks: {
        seedBook(input: {
          title: string;
          file_path: string;
          file_type: 'epub';
        }): Promise<{ id: number }>;
      };
    }).__appTestHooks.seedBook({
      title: bookTitle as string,
      file_path: '/mock/sample.epub',
      file_type: 'epub',
    });
  }, title);
}

async function waitForCurrentPosition(page: Page) {
  await expect
    .poll(async () => {
      return page.evaluate(() =>
        (window as Window & {
          __appTestHooks: { getCurrentPosition(): string | null };
        }).__appTestHooks.getCurrentPosition(),
      );
    })
    .not.toBeNull();

  return page.evaluate(() =>
    (window as Window & {
      __appTestHooks: { getCurrentPosition(): string | null };
    }).__appTestHooks.getCurrentPosition(),
  );
}

async function dispatchSelection(
  page: Page,
  rawPosition: string | null,
  text: string,
) {
  await page.evaluate(
    ({ positionJson, quoteText }) => {
      const position = JSON.parse(positionJson as string);
      window.dispatchEvent(
        new CustomEvent('scholara:selection', {
          detail: {
            kind: 'range',
            text: quoteText,
            range: {
              start: position,
              end: position,
            },
          },
        }),
      );
    },
    { positionJson: rawPosition, quoteText: text },
  );
}

async function listNotes(page: Page, bookId: number) {
  return page.evaluate(async (targetBookId) => {
    const rows = await (window as Window & {
      __appTestHooks: {
        listNotes(id: number): Promise<
          Array<{ note_text: string | null; quote_text: string | null }>
        >;
      };
    }).__appTestHooks.listNotes(targetBookId as number);

    return rows.map((row) => ({
      note_text: row.note_text,
      quote_text: row.quote_text,
    }));
  }, bookId);
}
