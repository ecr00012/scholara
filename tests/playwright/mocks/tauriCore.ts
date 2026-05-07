type UnlistenFn = () => void;
type ListenCallback<T> = (event: { payload: T }) => void;

interface MockFixtureMap {
  [path: string]: ArrayBuffer | number[] | Uint8Array | undefined;
}

interface DragDropPayload {
  paths: string[];
}

const dragDropListeners = new Set<ListenCallback<DragDropPayload>>();
const savedSecrets = getSecrets();

export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const fixtures = getFixtures();

  switch (cmd) {
    case 'read_book_bytes':
      return bytesToNumberArray(fixtures[String(args.path)]) as T;
    case 'save_cover_bytes':
      return '/mock/cover.png' as T;
    case 'delete_book_files':
      return null as T;
    case 'copy_uploaded_file': {
      const sourcePath = String(args.sourcePath ?? '');
      return {
        stored_path: sourcePath,
        file_type: sourcePath.endsWith('.epub') ? 'epub' : 'pdf',
      } as T;
    }
    case 'app_data_dir_path':
      return '/mock/app-data' as T;
    case 'reveal_in_file_manager':
      return null as T;
    case 'get_secret': {
      const name = String(args.name ?? '');
      return (savedSecrets[name] ?? null) as T;
    }
    case 'set_secret': {
      const name = String(args.name ?? '');
      const value = typeof args.value === 'string' ? args.value : '';
      if (value === '') {
        delete savedSecrets[name];
      } else {
        savedSecrets[name] = value;
      }
      return null as T;
    }
    case 'download_gutenberg_epub': {
      const bookId = Number(args.bookId ?? 0);
      return {
        stored_path: `/mock/books/gutenberg-${bookId}.epub`,
        file_type: 'epub',
      } as T;
    }
    default:
      throw new Error(`Unhandled mock IPC command: ${cmd}`);
  }
}

export function convertFileSrc(path: string): string {
  return `file://${path}`;
}

export async function listen<T>(
  eventName: string,
  callback: ListenCallback<T>,
): Promise<UnlistenFn> {
  if (eventName === 'tauri://drag-drop') {
    dragDropListeners.add(callback as ListenCallback<DragDropPayload>);
    return () => {
      dragDropListeners.delete(callback as ListenCallback<DragDropPayload>);
    };
  }

  return () => {};
}

export async function open(): Promise<string | string[] | null> {
  return null;
}

export function emitMockDragDrop(paths: string[]): void {
  for (const callback of dragDropListeners) {
    callback({ payload: { paths } });
  }
}

function getFixtures(): MockFixtureMap {
  return (
    (
      globalThis as typeof globalThis & {
        __SCHOLARA_FIXTURES__?: MockFixtureMap;
      }
    ).__SCHOLARA_FIXTURES__ ?? {}
  );
}

function getSecrets(): Record<string, string> {
  const target = globalThis as typeof globalThis & {
    __SCHOLARA_SECRETS__?: Record<string, string>;
    __SCHOLARA_GUTENBERG_KEY__?: string;
  };

  if (!target.__SCHOLARA_SECRETS__) {
    target.__SCHOLARA_SECRETS__ = {};
  }
  if (typeof target.__SCHOLARA_GUTENBERG_KEY__ === 'string') {
    target.__SCHOLARA_SECRETS__.gutenberg = target.__SCHOLARA_GUTENBERG_KEY__;
  }
  return target.__SCHOLARA_SECRETS__;
}

function bytesToNumberArray(value: ArrayBuffer | number[] | Uint8Array | undefined): number[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Uint8Array) return Array.from(value);
  return Array.from(new Uint8Array(value));
}
