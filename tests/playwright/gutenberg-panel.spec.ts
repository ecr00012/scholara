import { expect, type Page, test } from '@playwright/test';

const FAKE_BOOKS_RESPONSE = {
  results: [
    {
      id: 1342,
      title: 'Pride and Prejudice',
      alternative_title: null,
      authors: [{ id: 68, name: 'Austen, Jane' }],
      subjects: ['Romance', 'England -- Fiction'],
      bookshelves: ['Best Books Ever Listings'],
      media_type: 'Text',
      download_count: 62904,
      issued: '1998-06-01',
      reading_ease_score: '69.20',
      cover_image: 'https://example.invalid/cover-1342.jpg',
    },
    {
      id: 11,
      title: "Alice's Adventures in Wonderland",
      alternative_title: null,
      authors: [{ id: 7, name: 'Carroll, Lewis' }],
      subjects: ['Fantasy'],
      bookshelves: [],
      media_type: 'Text',
      download_count: 30000,
      issued: '2008-06-27',
      reading_ease_score: '85.00',
      cover_image: 'https://example.invalid/cover-11.jpg',
    },
    {
      id: 84,
      title: 'Frankenstein',
      alternative_title: null,
      authors: [{ id: 41, name: 'Shelley, Mary' }],
      subjects: ['Horror'],
      bookshelves: [],
      media_type: 'Text',
      download_count: 25000,
      issued: '1993-10-01',
      reading_ease_score: '60.00',
      cover_image: 'https://example.invalid/cover-84.jpg',
    },
    {
      id: 74,
      title: 'The Adventures of Tom Sawyer',
      alternative_title: null,
      authors: [{ id: 53, name: 'Twain, Mark' }],
      subjects: ['Adventure'],
      bookshelves: [],
      media_type: 'Text',
      download_count: 20000,
      issued: '2004-07-01',
      reading_ease_score: '80.00',
      cover_image: 'https://example.invalid/cover-74.jpg',
    },
  ],
};

async function preloadSecrets(page: Page, secrets: Record<string, string>) {
  await page.addInitScript((preloaded) => {
    (window as Window & { __SCHOLARA_SECRETS__?: Record<string, string> }).__SCHOLARA_SECRETS__ =
      preloaded;
  }, secrets);
}

async function waitForPanelReady(page: Page) {
  await expect(page.getByRole('button', { name: 'Open Pride and Prejudice' })).toBeVisible({
    timeout: 10_000,
  });
}

async function preloadGutenbergCache(
  page: Page,
  input: {
    cursor: number;
    lastFetchedAt: number | null;
    payload: typeof FAKE_BOOKS_RESPONSE.results | null;
  },
) {
  await page.addInitScript((cache) => {
    (
      globalThis as typeof globalThis & {
        __SCHOLARA_DB_MOCK__?: unknown;
      }
    ).__SCHOLARA_DB_MOCK__ = {
      books: [],
      notes: [],
      vocabulary: [],
      gutenbergPanelState: {
        id: 1,
        cursor_offset: cache.cursor,
        last_fetched_at: cache.lastFetchedAt,
        payload_json:
          cache.payload === null ? null : JSON.stringify(cache.payload),
      },
      nextIds: {
        books: 1,
        notes: 1,
        vocabulary: 1,
      },
      clock: 0,
    };
  }, input);
}

test.describe('Gutenberg panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://example.invalid/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/gif',
        body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
      });
    });

    await page.route(
      'https://project-gutenberg-free-books-api1.p.rapidapi.com/**',
      async (route, request) => {
        const url = new URL(request.url());
        if (url.searchParams.get('page_size') === '1') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ results: [FAKE_BOOKS_RESPONSE.results[0]] }),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(FAKE_BOOKS_RESPONSE),
        });
      },
    );
  });

  test('panel shows inline form when no key is saved', async ({ page }) => {
    await preloadSecrets(page, {});
    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await expect(
      page.getByText('Enter your RapidAPI key to load books from Project Gutenberg.'),
    ).toBeVisible();
  });

  test('panel renders 4 covers after key is saved', async ({ page }) => {
    await preloadSecrets(page, {});
    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await page.locator('input[type="password"]').first().fill('fake-rapidapi-key');
    await page.getByRole('button', { name: 'Save' }).first().click();

    for (const book of FAKE_BOOKS_RESPONSE.results) {
      await expect(page.getByRole('button', { name: `Open ${book.title}` })).toBeVisible();
    }
  });

  test('clicking a tile opens the modal with full metadata', async ({ page }) => {
    await preloadSecrets(page, { gutenberg: 'fake-rapidapi-key' });
    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);
    await waitForPanelReady(page);

    await page.getByRole('button', { name: 'Open Pride and Prejudice' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Pride and Prejudice' }).last()).toBeVisible();
    await expect(dialog.getByText('Austen, Jane').last()).toBeVisible();
    await expect(dialog.getByText('Project Gutenberg').first()).toBeVisible();
    await expect(dialog.getByText('Romance')).toBeVisible();
  });

  test('Add-to-library imports the EPUB and the book appears in the main grid', async ({
    page,
  }) => {
    await preloadSecrets(page, { gutenberg: 'fake-rapidapi-key' });
    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);
    await waitForPanelReady(page);

    await page.getByRole('button', { name: 'Open Frankenstein' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Add to library' }).click();

    await expect(dialog).toBeHidden({ timeout: 5000 });
    await expect(page.locator('main').getByText('Frankenstein').first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('panel shows offline state when navigator goes offline', async ({ page }) => {
    await preloadSecrets(page, { gutenberg: 'fake-rapidapi-key' });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => false,
      });
    });

    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);
    await page.evaluate(() =>
      (
        window as unknown as Window & {
          __appTestHooks: { clearGutenbergCache(): Promise<void> };
        }
      ).__appTestHooks.clearGutenbergCache(),
    );

    await expect(
      page.getByText('Connect to the internet to access Project Gutenberg.'),
    ).toBeVisible({ timeout: 5000 });
  });

  test('panel renders fresh cached books when navigator reports offline', async ({ page }) => {
    await preloadSecrets(page, { gutenberg: 'fake-rapidapi-key' });
    await preloadGutenbergCache(page, {
      cursor: 4,
      lastFetchedAt: Date.now(),
      payload: FAKE_BOOKS_RESPONSE.results,
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => false,
      });
    });

    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await waitForPanelReady(page);
  });

  test('panel renders stale cached books when fetch fails while online', async ({ page }) => {
    await preloadSecrets(page, { gutenberg: 'fake-rapidapi-key' });
    await preloadGutenbergCache(page, {
      cursor: 4,
      lastFetchedAt: 1,
      payload: FAKE_BOOKS_RESPONSE.results,
    });
    await page.route(
      'https://project-gutenberg-free-books-api1.p.rapidapi.com/**',
      async (route) => route.abort(),
    );
    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await waitForPanelReady(page);
    await expect(
      page.getByText('Project Gutenberg is taking a long pause.'),
    ).toBeHidden();
    await expect(
      page.getByText('Connect to the internet to access Project Gutenberg.'),
    ).toBeHidden();
  });
});
