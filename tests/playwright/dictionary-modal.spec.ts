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

test('dictionary modal streams text and saves vocabulary on completion', async ({ page }) => {
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
      title: 'Dictionary EPUB',
      file_path: '/mock/sample.epub',
      file_type: 'epub',
    });
  });

  await page.getByRole('button', { name: 'Open Dictionary EPUB' }).click();
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 10_000 });

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('scholara:open-dictionary', { detail: 'ephemeral' }),
    );
  });

  const dialog = page.getByRole('dialog', { name: 'Dictionary' });
  await expect(dialog).toBeVisible();

  await page.waitForTimeout(180);
  const firstSample = (await dialog.textContent()) ?? '';
  await page.waitForTimeout(220);
  const secondSample = (await dialog.textContent()) ?? '';
  expect(secondSample.length).toBeGreaterThan(firstSample.length);

  await expect
    .poll(async () => {
      return page.evaluate(
        (bookId) =>
          (window as Window & {
            __appTestHooks: {
              listVocabulary(targetBookId: number): Promise<
                Array<{ word: string; definition: string }>
              >;
            };
          }).__appTestHooks.listVocabulary(bookId as number),
        seededBook.id,
      );
    }, { timeout: 10_000 })
    .toContainEqual(
      expect.objectContaining({
        word: 'ephemeral',
      }),
    );

  await dialog.click();
  await expect(dialog).toHaveCount(0);
});

test('clicking the dictionary modal mid-stream aborts without saving', async ({ page }) => {
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
      title: 'Abort EPUB',
      file_path: '/mock/sample.epub',
      file_type: 'epub',
    });
  });

  await page.getByRole('button', { name: 'Open Abort EPUB' }).click();
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 10_000 });

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('scholara:open-dictionary', { detail: 'transient' }),
    );
  });

  const dialog = page.getByRole('dialog', { name: 'Dictionary' });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(100);
  await dialog.click();
  await expect(dialog).toHaveCount(0);

  await page.waitForTimeout(250);
  await expect
    .poll(async () => {
      return page.evaluate(
        (bookId) =>
          (window as Window & {
            __appTestHooks: {
              listVocabulary(targetBookId: number): Promise<Array<{ word: string }>>;
            };
          }).__appTestHooks.listVocabulary(bookId as number),
        seededBook.id,
      );
    })
    .toEqual([]);
});
