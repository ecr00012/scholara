import { expect, type Page, test } from '@playwright/test';

const FRESHNESS_TTL_MS = 24 * 60 * 60 * 1000;

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

const NEXT_FAKE_BOOKS_RESPONSE = {
  results: FAKE_BOOKS_RESPONSE.results.map((book, index) => ({
    ...book,
    id: book.id + 10_000,
    title: `Next Gutenberg Pick ${index + 1}`,
    cover_image: `https://example.invalid/next-cover-${index + 1}.jpg`,
  })),
};

const CACHED_BOOKS = FAKE_BOOKS_RESPONSE.results.map((book, index) => ({
  ...book,
  id: book.id + 20_000,
  title: `Cached Gutenberg Pick ${index + 1}`,
  cover_image: `https://example.invalid/cached-cover-${index + 1}.jpg`,
}));

async function preloadSecrets(page: Page, secrets: Record<string, string>) {
  await page.addInitScript((preloaded) => {
    (window as Window & { __SCHOLARA_SECRETS__?: Record<string, string> }).__SCHOLARA_SECRETS__ =
      preloaded;
  }, secrets);
}

async function preloadSecretFailures(
  page: Page,
  failures: {
    get?: Record<string, string>;
    set?: Record<string, string>;
    confirm?: Record<string, string>;
  },
) {
  await page.addInitScript((preloaded) => {
    (
      window as Window & {
        __SCHOLARA_SECRET_FAILURES__?: typeof preloaded;
      }
    ).__SCHOLARA_SECRET_FAILURES__ = preloaded;
  }, failures);
}

async function waitForPanelReady(page: Page) {
  await expect(page.getByRole('button', { name: 'Open Pride and Prejudice' })).toBeVisible({
    timeout: 10_000,
  });
}

async function routeGutenbergBooks(
  page: Page,
  response: typeof FAKE_BOOKS_RESPONSE,
  offsets: number[],
) {
  await page.route(
    'https://project-gutenberg-free-books-api1.p.rapidapi.com/**',
    async (route, request) => {
      const url = new URL(request.url());
      if (url.searchParams.get('page_size') === '1') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ results: [response.results[0]] }),
        });
        return;
      }

      offsets.push(Number(url.searchParams.get('offset') ?? 0));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    },
  );
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

  test('panel renders fresh cached books without calling the Gutenberg books API', async ({
    page,
  }) => {
    const offsets: number[] = [];
    await routeGutenbergBooks(page, NEXT_FAKE_BOOKS_RESPONSE, offsets);
    await preloadSecrets(page, { gutenberg: 'fake-rapidapi-key' });
    await preloadGutenbergCache(page, {
      cursor: 4,
      lastFetchedAt: Date.now(),
      payload: CACHED_BOOKS,
    });

    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await expect(
      page.getByRole('button', { name: 'Open Cached Gutenberg Pick 1' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open Next Gutenberg Pick 1' }),
    ).toBeHidden();
    await page.waitForTimeout(250);
    expect(offsets).toEqual([]);
  });

  test('panel fetches the next 4 books when cached launch data is 24h old', async ({
    page,
  }) => {
    const offsets: number[] = [];
    await routeGutenbergBooks(page, NEXT_FAKE_BOOKS_RESPONSE, offsets);
    await preloadSecrets(page, { gutenberg: 'fake-rapidapi-key' });
    await preloadGutenbergCache(page, {
      cursor: 4,
      lastFetchedAt: Date.now() - FRESHNESS_TTL_MS,
      payload: CACHED_BOOKS,
    });

    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await expect(
      page.getByRole('button', { name: 'Open Next Gutenberg Pick 1' }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole('button', { name: 'Open Cached Gutenberg Pick 1' }),
    ).toBeHidden();
    expect(offsets).toEqual([4]);
  });

  test('panel refreshes automatically when a fresh cached set crosses 24h while open', async ({
    page,
  }) => {
    const now = 1_700_000_000_000;
    const offsets: number[] = [];
    await page.clock.install({ time: now });
    await routeGutenbergBooks(page, NEXT_FAKE_BOOKS_RESPONSE, offsets);
    await preloadSecrets(page, { gutenberg: 'fake-rapidapi-key' });
    await preloadGutenbergCache(page, {
      cursor: 8,
      lastFetchedAt: now - FRESHNESS_TTL_MS + 1_000,
      payload: CACHED_BOOKS,
    });

    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await expect(
      page.getByRole('button', { name: 'Open Cached Gutenberg Pick 1' }),
    ).toBeVisible();
    expect(offsets).toEqual([]);

    await page.clock.runFor(1_100);

    await expect(
      page.getByRole('button', { name: 'Open Next Gutenberg Pick 1' }),
    ).toBeVisible({ timeout: 10_000 });
    expect(offsets).toEqual([8]);
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

  test('panel shows a keychain save error when saving the Gutenberg key fails', async ({
    page,
  }) => {
    await preloadSecrets(page, {});
    await preloadSecretFailures(page, {
      set: { gutenberg: 'mock keychain write failed' },
    });
    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await page.locator('input[type="password"]').first().fill('fake-rapidapi-key');
    await page.getByRole('button', { name: 'Save' }).first().click();

    await expect(
      page.getByText(
        'Could not save your Project Gutenberg API key to the system keychain. mock keychain write failed',
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open Pride and Prejudice' }),
    ).toBeHidden();
  });

  test('panel shows a keychain load error when loading the Gutenberg key fails', async ({
    page,
  }) => {
    await preloadSecretFailures(page, {
      get: { gutenberg: 'mock keychain read failed' },
    });
    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await expect(
      page.getByText(
        'Could not load your Project Gutenberg API key from the system keychain. mock keychain read failed',
      ),
    ).toBeVisible();
  });

  test('panel shows a persistence error when the Gutenberg key is missing after save', async ({
    page,
  }) => {
    await preloadSecrets(page, {});
    await preloadSecretFailures(page, {
      confirm: { gutenberg: 'drop saved value before confirmation' },
    });
    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await page.locator('input[type="password"]').first().fill('fake-rapidapi-key');
    await page.getByRole('button', { name: 'Save' }).first().click();

    await expect(
      page.getByText(
        'Could not save your Project Gutenberg API key to the system keychain. The keychain entry was missing immediately after save.',
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open Pride and Prejudice' }),
    ).toBeHidden();
  });
});
