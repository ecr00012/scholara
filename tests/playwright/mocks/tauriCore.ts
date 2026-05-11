type UnlistenFn = () => void;
type ListenCallback<T> = (event: { payload: T }) => void;

interface MockFixtureMap {
  [path: string]: ArrayBuffer | number[] | Uint8Array | undefined;
}

interface DragDropPayload {
  paths: string[];
}

interface ChatStreamScript {
  /** Plain-text chunks emitted as OpenAI-shape `delta.content` events, in order. */
  textChunks?: string[];
  /** Optional error message; if set, channel emits a single 'error' event. */
  error?: string;
  /** Per-chunk delay in ms. Defaults to 0 (synchronous-ish microtasks). */
  delayMs?: number;
}

interface ChatOneshotScript {
  text?: string;
  error?: string;
}

type InvokeOverride = (args: Record<string, unknown>) => unknown | Promise<unknown>;

const dragDropListeners = new Set<ListenCallback<DragDropPayload>>();
const savedSecrets = getSecrets();

/**
 * Lightweight stand-in for `Channel<T>` from `@tauri-apps/api/core`.
 * Real Tauri Channel: an opaque object that can be passed to invoke() and
 * later receives messages via `.onmessage`. For tests we only need the
 * `.onmessage` setter — the `chat_stream` mock writes events to it directly.
 */
export class Channel<T> {
  onmessage: ((msg: T) => void) | null = null;
  emit(msg: T): void {
    this.onmessage?.(msg);
  }
}

export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const overrides = getInvokeOverrides();
  const override = overrides[cmd];
  if (override) {
    return (await override(args)) as T;
  }

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
      const failures = getSecretFailures();
      if (failures.get[name]) {
        throw new Error(failures.get[name]);
      }
      return (savedSecrets[name] ?? null) as T;
    }
    case 'set_secret': {
      const name = String(args.name ?? '');
      const failures = getSecretFailures();
      if (failures.set[name]) {
        throw new Error(failures.set[name]);
      }
      const value = typeof args.value === 'string' ? args.value : '';
      if (value === '') {
        delete savedSecrets[name];
      } else {
        if (failures.confirm[name]) {
          delete savedSecrets[name];
        } else {
          savedSecrets[name] = value;
        }
      }
      return null as T;
    }
    case 'diagnose_secret': {
      const name = String(args.name ?? '');
      const failures = getSecretFailures();
      if (failures.get[name]) {
        return {
          service: 'scholara',
          account: `${name}_api_key`,
          diagnostic_account: `${name}_diagnostic_api_key`,
          existing_entry: false,
          status: 'real_load_failed',
          error: failures.get[name],
        } as T;
      }
      if (failures.set[name]) {
        return {
          service: 'scholara',
          account: `${name}_api_key`,
          diagnostic_account: `${name}_diagnostic_api_key`,
          existing_entry: savedSecrets[name] !== undefined,
          status: 'diagnostic_save_failed',
          error: failures.set[name],
        } as T;
      }
      return {
        service: 'scholara',
        account: `${name}_api_key`,
        diagnostic_account: `${name}_diagnostic_api_key`,
        existing_entry: savedSecrets[name] !== undefined,
        status: 'ok',
        error: null,
      } as T;
    }
    case 'download_gutenberg_epub': {
      const bookId = Number(args.bookId ?? 0);
      return {
        stored_path: `/mock/books/gutenberg-${bookId}.epub`,
        file_type: 'epub',
      } as T;
    }
    case 'fetch_gutendex_page':
      return { books: [] } as T;
    case 'chat_stream': {
      const channel = args.onEvent as Channel<ChatStreamEvent> | undefined;
      const script = getChatStreamScript();
      if (!channel) {
        throw new Error('chat_stream mock invoked without onEvent channel');
      }
      if (script.error) {
        channel.emit({ kind: 'error', message: script.error });
        throw new Error(script.error);
      }
      const chunks = script.textChunks ?? ['Hello from the mocked OpenRouter stream.'];
      const delay = script.delayMs ?? 0;

      const emitChunk = async (i: number) => {
        if (i >= chunks.length) {
          channel.emit({ kind: 'done' });
          return;
        }
        // OpenAI-shape delta: { choices: [{ delta: { content } }] }
        channel.emit({
          kind: 'event',
          event: 'message',
          data: { choices: [{ delta: { content: chunks[i] } }] },
        });
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
        await emitChunk(i + 1);
      };
      // Fire-and-forget; the real `chat_stream` invoke resolves only after
      // the Rust side finishes streaming, so we mirror that by awaiting.
      await emitChunk(0);
      return undefined as T;
    }
    case 'chat_oneshot': {
      const script = getChatOneshotScript();
      if (script.error) {
        throw new Error(script.error);
      }
      return {
        choices: [{ message: { role: 'assistant', content: script.text ?? '' } }],
      } as T;
    }
    default:
      throw new Error(`Unhandled mock IPC command: ${cmd}`);
  }
}

type ChatStreamEvent =
  | { kind: 'event'; event: string; data: unknown }
  | { kind: 'error'; message: string }
  | { kind: 'done' };

function getChatStreamScript(): ChatStreamScript {
  const target = globalThis as typeof globalThis & {
    __SCHOLARA_CHAT_STREAM__?: ChatStreamScript;
  };
  return target.__SCHOLARA_CHAT_STREAM__ ?? {};
}

function getChatOneshotScript(): ChatOneshotScript {
  const target = globalThis as typeof globalThis & {
    __SCHOLARA_CHAT_ONESHOT__?: ChatOneshotScript;
  };
  return target.__SCHOLARA_CHAT_ONESHOT__ ?? { text: '' };
}

function getInvokeOverrides(): Record<string, InvokeOverride | undefined> {
  const target = globalThis as typeof globalThis & {
    __SCHOLARA_INVOKE_OVERRIDES__?: Record<string, InvokeOverride | undefined>;
  };
  return target.__SCHOLARA_INVOKE_OVERRIDES__ ?? {};
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
  };

  if (!target.__SCHOLARA_SECRETS__) {
    target.__SCHOLARA_SECRETS__ = {};
  }
  return target.__SCHOLARA_SECRETS__;
}

function getSecretFailures(): {
  get: Record<string, string | undefined>;
  set: Record<string, string | undefined>;
  confirm: Record<string, string | undefined>;
} {
  const target = globalThis as typeof globalThis & {
    __SCHOLARA_SECRET_FAILURES__?: {
      get?: Record<string, string | undefined>;
      set?: Record<string, string | undefined>;
      confirm?: Record<string, string | undefined>;
    };
  };

  return {
    get: target.__SCHOLARA_SECRET_FAILURES__?.get ?? {},
    set: target.__SCHOLARA_SECRET_FAILURES__?.set ?? {},
    confirm: target.__SCHOLARA_SECRET_FAILURES__?.confirm ?? {},
  };
}

function bytesToNumberArray(value: ArrayBuffer | number[] | Uint8Array | undefined): number[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Uint8Array) return Array.from(value);
  return Array.from(new Uint8Array(value));
}
