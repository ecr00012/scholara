import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SAMPLE_PDF = readFileSync(
  fileURLToPath(new URL('../fixtures/sample.pdf', import.meta.url)),
);
const CROSS_PAGE_PDF = readFileSync(
  fileURLToPath(new URL('../fixtures/cross-page.pdf', import.meta.url)),
);

test('body-only PDF notes show a page subscript count', async ({ page }) => {
  await page.addInitScript((bytes) => {
    (window as Window & { __SCHOLARA_FIXTURES__?: Record<string, number[]> }).__SCHOLARA_FIXTURES__ =
      { '/mock/sample.pdf': bytes };
  }, Array.from(SAMPLE_PDF));

  await page.goto('/');
  await page.waitForFunction(() => '__appTestHooks' in window);

  const seededBook = await page.evaluate(async () => {
    return (window as Window & {
      __appTestHooks: {
        seedBook(input: {
          title: string;
          file_path: string;
          file_type: 'pdf';
        }): Promise<{ id: number }>;
        seedNote(input: {
          book_id: number;
          page_or_position: string;
          note_text: string | null;
          quote_text: string | null;
        }): Promise<number>;
      };
    }).__appTestHooks.seedBook({
      title: 'Annotated PDF',
      file_path: '/mock/sample.pdf',
      file_type: 'pdf',
    });
  });

  await page.evaluate(async (bookId) => {
    await (window as Window & {
      __appTestHooks: {
        seedNote(input: {
          book_id: number;
          page_or_position: string;
          note_text: string | null;
          quote_text: string | null;
        }): Promise<number>;
      };
    }).__appTestHooks.seedNote({
      book_id: bookId as number,
      page_or_position: JSON.stringify({
        type: 'pdf',
        locator: 1,
        fraction: 0,
        label: 'Page 1',
      }),
      note_text: 'A body-only note',
      quote_text: null,
    });
  }, seededBook.id);

  await page.getByRole('button', { name: 'Open Annotated PDF' }).click();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-page="1"] .scholara-annotation')).toHaveText('1');
});

test('cross-page PDF quotes render underlines on both pages and a trailing subscript once', async ({
  page,
}) => {
  await page.addInitScript((bytes) => {
    (window as Window & { __SCHOLARA_FIXTURES__?: Record<string, number[]> }).__SCHOLARA_FIXTURES__ =
      { '/mock/cross-page.pdf': bytes };
  }, Array.from(CROSS_PAGE_PDF));

  await page.goto('/');
  await page.waitForFunction(() => '__appTestHooks' in window);

  const seededBook = await page.evaluate(async () => {
    return (window as Window & {
      __appTestHooks: {
        seedBook(input: {
          title: string;
          file_path: string;
          file_type: 'pdf';
        }): Promise<{ id: number }>;
      };
    }).__appTestHooks.seedBook({
      title: 'Cross Page PDF',
      file_path: '/mock/cross-page.pdf',
      file_type: 'pdf',
    });
  });

  await page.evaluate(async (bookId) => {
    await (window as Window & {
      __appTestHooks: {
        seedNote(input: {
          book_id: number;
          page_or_position: string;
          note_text: string | null;
          quote_text: string | null;
        }): Promise<number>;
      };
    }).__appTestHooks.seedNote({
      book_id: bookId as number,
      page_or_position: JSON.stringify({
        start: { type: 'pdf', locator: 1, fraction: 0.25, label: 'Page 1' },
        end: { type: 'pdf', locator: 2, fraction: 0.75, label: 'Page 2' },
        pages: [
          {
            page: 1,
            rects: [{ x: 72, y: 96, w: 128, h: 12 }],
          },
          {
            page: 2,
            rects: [{ x: 88, y: 112, w: 148, h: 12 }],
          },
        ],
      }),
      note_text: null,
      quote_text: 'A quote that spans two pages',
    });
  }, seededBook.id);

  await page.getByRole('button', { name: 'Open Cross Page PDF' }).click();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10_000 });

  await expect(page.locator('[data-page="1"] .scholara-quote-underline')).toHaveCount(1);
  await page.locator('[data-page="2"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-page="2"] .scholara-quote-underline')).toHaveCount(1);

  const pageTwoUnderline = page.locator('[data-page="2"] .scholara-quote-underline').first();
  expect(await pageTwoUnderline.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
    'rgb(200, 112, 44)',
  );

  await expect(
    page.locator('[data-page="1"] .scholara-annotation:not(.scholara-quote-underline)'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-page="2"] .scholara-annotation:not(.scholara-quote-underline)'),
  ).toHaveText('1');
});
