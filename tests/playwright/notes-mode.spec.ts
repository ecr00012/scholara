import { expect, test } from '@playwright/test';
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

test('notes mode toggles orange and saves a quote-backed note', async ({ page }) => {
  const seededBook = await page.evaluate(async () => {
    return (window as Window & {
      __appTestHooks: {
        seedBook(input: {
          title: string;
          file_path: string;
          file_type: 'epub';
        }): Promise<{ id: number }>;
      };
    }).__appTestHooks.seedBook({
      title: 'Notes EPUB',
      file_path: '/mock/sample.epub',
      file_type: 'epub',
    });
  });

  await page.getByRole('button', { name: 'Open Notes EPUB' }).click();
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 10_000 });

  await page.keyboard.press('n');

  const quillFill = await page
    .getByRole('button', { name: 'Take a note (n)' })
    .locator('svg')
    .evaluate((node) => getComputedStyle(node).fill);
  expect(quillFill).toBe('rgb(200, 112, 44)');

  await expect
    .poll(async () => {
      return page.evaluate(() =>
        (window as Window & {
          __appTestHooks: { getCurrentPosition(): string | null };
        }).__appTestHooks.getCurrentPosition(),
      );
    })
    .not.toBeNull();

  const currentPosition = await page.evaluate(() =>
    (window as Window & {
      __appTestHooks: { getCurrentPosition(): string | null };
    }).__appTestHooks.getCurrentPosition(),
  );

  await page.evaluate((rawPosition) => {
    const position = JSON.parse(rawPosition as string);
    window.dispatchEvent(
      new CustomEvent('scholara:set-quote', {
        detail: {
          text: 'A quoted passage',
          range: {
            start: position,
            end: position,
          },
        },
      }),
    );
  }, currentPosition);

  await page.getByPlaceholder('Add a note…').fill('A saved note from Playwright');
  await page.getByRole('button', { name: 'Save note' }).click();

  await expect
    .poll(async () => {
      return page.evaluate(
        async (bookId) => {
          const rows = await (window as Window & {
            __appTestHooks: {
              listNotes(targetBookId: number): Promise<
                Array<{ note_text: string | null; quote_text: string | null }>
              >;
            };
          }).__appTestHooks.listNotes(bookId as number);
          return rows.map((row) => ({
            note_text: row.note_text,
            quote_text: row.quote_text,
          }));
        },
        seededBook.id,
      );
    })
    .toEqual([
      {
        note_text: 'A saved note from Playwright',
        quote_text: 'A quoted passage',
      },
    ]);
});

test('EPUB notes scope control starts at All Notes and omits Filter wording', async ({
  page,
}) => {
  await page.evaluate(async () => {
    await (window as Window & {
      __appTestHooks: {
        seedBook(input: {
          title: string;
          file_path: string;
          file_type: 'epub';
        }): Promise<{ id: number }>;
      };
    }).__appTestHooks.seedBook({
      title: 'Scoped Notes EPUB',
      file_path: '/mock/sample.epub',
      file_type: 'epub',
    });
  });

  await page.getByRole('button', { name: 'Open Scoped Notes EPUB' }).click();
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole('tab', { name: 'Notes' }).click();
  await expect(page.getByRole('button', { name: 'Choose notes scope' })).toContainText(
    'All Notes',
  );
  await expect(page.getByText('Filter')).toHaveCount(0);
});
