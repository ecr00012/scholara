import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SAMPLE_PDF = readFileSync(
  fileURLToPath(new URL('../fixtures/sample.pdf', import.meta.url)),
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript((bytes) => {
    (window as Window & { __SCHOLARA_FIXTURES__?: Record<string, number[]> }).__SCHOLARA_FIXTURES__ =
      { '/mock/sample.pdf': bytes };
  }, Array.from(SAMPLE_PDF));

  await page.goto('/');
  await page.waitForFunction(() => '__appTestHooks' in window);
});

test('opens a PDF and renders canvases', async ({ page }) => {
  await page.evaluate(async () => {
    await (window as Window & {
      __appTestHooks: {
        seedBook(input: {
          title: string;
          file_path: string;
          file_type: 'pdf';
        }): Promise<unknown>;
      };
    }).__appTestHooks.seedBook({
      title: 'Sample PDF',
      file_path: '/mock/sample.pdf',
      file_type: 'pdf',
    });
  });

  await page.getByRole('button', { name: 'Open Sample PDF' }).click();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () => page.locator('[data-page]').count())
    .toBeGreaterThan(1);
});

test('End updates the persisted PDF position', async ({ page }) => {
  await page.evaluate(async () => {
    await (window as Window & {
      __appTestHooks: {
        seedBook(input: {
          title: string;
          file_path: string;
          file_type: 'pdf';
        }): Promise<unknown>;
      };
    }).__appTestHooks.seedBook({
      title: 'Sample PDF',
      file_path: '/mock/sample.pdf',
      file_type: 'pdf',
    });
  });

  await page.getByRole('button', { name: 'Open Sample PDF' }).click();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10_000 });

  await page.keyboard.press('End');
  await expect
    .poll(async () => {
      const raw = await page.evaluate(() =>
        (window as Window & {
          __appTestHooks: { getCurrentPosition(): string | null };
        }).__appTestHooks.getCurrentPosition(),
      );
      return raw ? JSON.parse(raw) : null;
    })
    .toMatchObject({ type: 'pdf', locator: expect.any(Number) });

  const parsed = await page.evaluate(() => {
    const raw = (window as Window & {
      __appTestHooks: { getCurrentPosition(): string | null };
    }).__appTestHooks.getCurrentPosition();
    return raw ? JSON.parse(raw) : null;
  });

  expect(parsed?.locator).toBeGreaterThan(1);
  expect(parsed?.fraction).toBeGreaterThan(0);
});
