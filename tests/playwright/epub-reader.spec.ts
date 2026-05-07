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

test('opens an EPUB and renders its iframe reader', async ({ page }) => {
  await page.evaluate(async () => {
    await (window as Window & {
      __appTestHooks: {
        seedBook(input: {
          title: string;
          file_path: string;
          file_type: 'epub';
        }): Promise<unknown>;
      };
    }).__appTestHooks.seedBook({
      title: 'Sample Book',
      file_path: '/mock/sample.epub',
      file_type: 'epub',
    });
  });

  await page.getByRole('button', { name: 'Open Sample Book' }).click();
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 10_000 });
});

test('ArrowRight advances an EPUB and persists current_position', async ({ page }) => {
  await page.evaluate(async () => {
    await (window as Window & {
      __appTestHooks: {
        seedBook(input: {
          title: string;
          file_path: string;
          file_type: 'epub';
        }): Promise<unknown>;
      };
    }).__appTestHooks.seedBook({
      title: 'Sample Book',
      file_path: '/mock/sample.epub',
      file_type: 'epub',
    });
  });

  await page.getByRole('button', { name: 'Open Sample Book' }).click();
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 10_000 });

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(800);

  const currentPosition = await page.evaluate(() =>
    (window as Window & {
      __appTestHooks: { getCurrentPosition(): string | null };
    }).__appTestHooks.getCurrentPosition(),
  );

  expect(currentPosition).toBeTruthy();
  const parsed = JSON.parse(currentPosition ?? 'null') as {
    type: string;
    locator: string;
  };
  expect(parsed.type).toBe('epub');
  expect(parsed.locator).toBeTruthy();
});

test('applies EPUB text preferences from reader chrome', async ({ page }) => {
  await page.evaluate(async () => {
    await (window as Window & {
      __appTestHooks: {
        seedBook(input: {
          title: string;
          file_path: string;
          file_type: 'epub';
        }): Promise<unknown>;
      };
    }).__appTestHooks.seedBook({
      title: 'Sample Book',
      file_path: '/mock/sample.epub',
      file_type: 'epub',
    });
  });

  await page.getByRole('button', { name: 'Open Sample Book' }).click();
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Reading text preferences' }).click();
  await expect(page.getByRole('heading', { name: 'Reading Text' })).toBeVisible();
  await page.getByRole('button', { name: 'Increase text size' }).click();
  await page.getByRole('button', { name: 'Georgia' }).click();

  const prefs = await page.waitForFunction(() => {
    return (
      window as Window & {
        __SCHOLARA_READER_PREFS__?: {
          fontFamily: string;
          fontScale: number;
        };
      }
    ).__SCHOLARA_READER_PREFS__;
  });

  expect(await prefs.jsonValue()).toMatchObject({
    fontFamily: 'georgia',
    fontScale: 105,
  });
});
