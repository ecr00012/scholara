import { expect, type Page, test } from '@playwright/test';

const FRESHNESS_TTL_MS = 24 * 60 * 60 * 1000;

interface GutenbergBookFixture {
  id: number;
  title: string;
  authors: Array<{ name: string }>;
  subjects: string[];
  bookshelves: string[];
  download_count: number;
  issued: string | null;
  reading_ease_score: string | null;
  cover_image: string | null;
}

const FAKE_BOOKS: GutenbergBookFixture[] = [
  {
    id: 1342,
    title: 'Pride and Prejudice',
    authors: [{ name: 'Austen, Jane' }],
    subjects: ['Romance', 'England -- Fiction'],
    bookshelves: ['Best Books Ever Listings'],
    download_count: 62904,
    issued: '1998-06-01',
    reading_ease_score: '69.20',
    cover_image: 'https://example.invalid/cover-1342.jpg',
  },
  {
    id: 11,
    title: "Alice's Adventures in Wonderland",
    authors: [{ name: 'Carroll, Lewis' }],
    subjects: ['Fantasy'],
    bookshelves: [],
    download_count: 30000,
    issued: '2008-06-27',
    reading_ease_score: '85.00',
    cover_image: 'https://example.invalid/cover-11.jpg',
  },
  {
    id: 84,
    title: 'Frankenstein',
    authors: [{ name: 'Shelley, Mary' }],
    subjects: ['Horror'],
    bookshelves: [],
    download_count: 25000,
    issued: '1993-10-01',
    reading_ease_score: '60.00',
    cover_image: 'https://example.invalid/cover-84.jpg',
  },
  {
    id: 74,
    title: 'The Adventures of Tom Sawyer',
    authors: [{ name: 'Twain, Mark' }],
    subjects: ['Adventure'],
    bookshelves: [],
    download_count: 20000,
    issued: '2004-07-01',
    reading_ease_score: '80.00',
    cover_image: 'https://example.invalid/cover-74.jpg',
  },
];

const NEXT_FAKE_BOOKS = FAKE_BOOKS.map((book, index) => ({
  ...book,
  id: book.id + 10_000,
  title: `Next Gutenberg Pick ${index + 1}`,
  cover_image: `https://example.invalid/next-cover-${index + 1}.jpg`,
}));

const CACHED_BOOKS = FAKE_BOOKS.map((book, index) => ({
  ...book,
  id: book.id + 20_000,
  title: `Cached Gutenberg Pick ${index + 1}`,
  cover_image: `https://example.invalid/cached-cover-${index + 1}.jpg`,
}));

function placeholderBook(index: number): GutenbergBookFixture {
  return {
    id: 90_000 + index,
    title: `Earlier Gutenberg Pick ${index}`,
    authors: [{ name: 'Archive, Project' }],
    subjects: [],
    bookshelves: [],
    download_count: 10_000 - index,
    issued: null,
    reading_ease_score: null,
    cover_image: `https://example.invalid/earlier-cover-${index}.jpg`,
  };
}

function gutendexPageWithWindowAt(
  cursor: number,
  books: GutenbergBookFixture[],
): GutenbergBookFixture[] {
  return [...Array.from({ length: cursor }, (_, index) => placeholderBook(index + 1)), ...books];
}

async function waitForPanelReady(page: Page) {
  await expect(page.getByRole('button', { name: 'Open Pride and Prejudice' })).toBeVisible({
    timeout: 10_000,
  });
}

async function mockGutendexPage(page: Page, books: GutenbergBookFixture[], fail = false) {
  await page.addInitScript(
    ({ mockedBooks, shouldFail }) => {
      (
        globalThis as typeof globalThis & {
          __SCHOLARA_INVOKE_OVERRIDES__?: Record<
            string,
            (args: Record<string, unknown>) => unknown
          >;
          __SCHOLARA_REQUESTED_GUTENDEX_PAGES__?: number[];
        }
      ).__SCHOLARA_REQUESTED_GUTENDEX_PAGES__ = [];

      (
        globalThis as typeof globalThis & {
          __SCHOLARA_INVOKE_OVERRIDES__?: Record<
            string,
            (args: Record<string, unknown>) => unknown
          >;
          __SCHOLARA_REQUESTED_GUTENDEX_PAGES__?: number[];
        }
      ).__SCHOLARA_INVOKE_OVERRIDES__ = {
        fetch_gutendex_page: (args) => {
          const pageNumber = Number(args.page ?? 0);
          (
            globalThis as typeof globalThis & {
              __SCHOLARA_REQUESTED_GUTENDEX_PAGES__?: number[];
            }
          ).__SCHOLARA_REQUESTED_GUTENDEX_PAGES__?.push(pageNumber);
          if (shouldFail) {
            throw new Error('mock Gutendex unavailable');
          }
          return { books: mockedBooks };
        },
      };
    },
    { mockedBooks: books, shouldFail: fail },
  );
}

async function getRequestedGutendexPages(page: Page): Promise<number[]> {
  return page.evaluate(
    () =>
      (
        window as unknown as Window & {
          __SCHOLARA_REQUESTED_GUTENDEX_PAGES__?: number[];
        }
      ).__SCHOLARA_REQUESTED_GUTENDEX_PAGES__ ?? [],
  );
}

async function preloadGutenbergCache(
  page: Page,
  input: {
    cursor: number;
    lastFetchedAt: number | null;
    payload: GutenbergBookFixture[] | null;
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
        payload_json: cache.payload === null ? null : JSON.stringify(cache.payload),
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
    await mockGutendexPage(page, FAKE_BOOKS);

    await page.route('https://example.invalid/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/gif',
        body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
      });
    });
  });

  test('panel renders 4 covers from Gutendex', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    for (const book of FAKE_BOOKS) {
      await expect(page.getByRole('button', { name: `Open ${book.title}` })).toBeVisible();
    }
  });

  test('clicking a tile opens the modal with full metadata', async ({ page }) => {
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
    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);
    await waitForPanelReady(page);

    await page.getByRole('button', { name: 'Open Frankenstein' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Add to library' }).click();

    await expect(page.locator('main').getByText('Frankenstein').first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('panel shows offline state when navigator goes offline', async ({ page }) => {
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
    await preloadGutenbergCache(page, {
      cursor: 4,
      lastFetchedAt: Date.now(),
      payload: FAKE_BOOKS,
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
    await mockGutendexPage(page, gutendexPageWithWindowAt(4, NEXT_FAKE_BOOKS));
    await preloadGutenbergCache(page, {
      cursor: 4,
      lastFetchedAt: Date.now(),
      payload: CACHED_BOOKS,
    });

    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await expect(page.getByRole('button', { name: 'Open Cached Gutenberg Pick 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Next Gutenberg Pick 1' })).toBeHidden();
    await page.waitForTimeout(250);
    expect(await getRequestedGutendexPages(page)).toEqual([]);
  });

  test('manual refresh bypasses fresh cache and fetches new picks', async ({ page }) => {
    await mockGutendexPage(page, gutendexPageWithWindowAt(4, NEXT_FAKE_BOOKS));
    await preloadGutenbergCache(page, {
      cursor: 4,
      lastFetchedAt: Date.now(),
      payload: CACHED_BOOKS,
    });

    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await expect(page.getByRole('button', { name: 'Open Cached Gutenberg Pick 1' })).toBeVisible();
    expect(await getRequestedGutendexPages(page)).toEqual([]);

    await page.getByRole('button', { name: 'Refresh Project Gutenberg picks' }).click();

    await expect(page.getByRole('button', { name: 'Open Next Gutenberg Pick 1' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: 'Open Cached Gutenberg Pick 1' })).toBeHidden();
    expect(await getRequestedGutendexPages(page)).toEqual([1]);
  });

  test('panel fetches the next 4 books when cached launch data is 24h old', async ({ page }) => {
    await mockGutendexPage(page, gutendexPageWithWindowAt(4, NEXT_FAKE_BOOKS));
    await preloadGutenbergCache(page, {
      cursor: 4,
      lastFetchedAt: Date.now() - FRESHNESS_TTL_MS,
      payload: CACHED_BOOKS,
    });

    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await expect(page.getByRole('button', { name: 'Open Next Gutenberg Pick 1' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: 'Open Cached Gutenberg Pick 1' })).toBeHidden();
    expect(await getRequestedGutendexPages(page)).toEqual([1]);
  });

  test('panel refreshes automatically when a fresh cached set crosses 24h while open', async ({
    page,
  }) => {
    const now = 1_700_000_000_000;
    await page.clock.install({ time: now });
    await mockGutendexPage(page, gutendexPageWithWindowAt(8, NEXT_FAKE_BOOKS));
    await preloadGutenbergCache(page, {
      cursor: 8,
      lastFetchedAt: now - FRESHNESS_TTL_MS + 1_000,
      payload: CACHED_BOOKS,
    });

    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await expect(page.getByRole('button', { name: 'Open Cached Gutenberg Pick 1' })).toBeVisible();
    expect(await getRequestedGutendexPages(page)).toEqual([]);

    await page.clock.runFor(1_100);

    await expect(page.getByRole('button', { name: 'Open Next Gutenberg Pick 1' })).toBeVisible({
      timeout: 10_000,
    });
    expect(await getRequestedGutendexPages(page)).toEqual([1]);
  });

  test('panel renders stale cached books when fetch fails while online', async ({ page }) => {
    await mockGutendexPage(page, FAKE_BOOKS, true);
    await preloadGutenbergCache(page, {
      cursor: 4,
      lastFetchedAt: 1,
      payload: FAKE_BOOKS,
    });
    await page.goto('/');
    await page.waitForFunction(() => '__appTestHooks' in window);

    await waitForPanelReady(page);
    await expect(page.getByText('Project Gutenberg is taking a long pause.')).toBeHidden();
    await expect(
      page.getByText('Connect to the internet to access Project Gutenberg.'),
    ).toBeHidden();
    expect(await getRequestedGutendexPages(page)).toEqual([1]);
  });
});
