import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const isE2E = process.env.VITE_E2E === '1';

export default defineConfig(async () => ({
  plugins: [react()],

  // transformers.js ships an onnxruntime-web worker chunk that breaks esbuild's
  // pre-bundling; opt out so Vite serves it as-is.
  optimizeDeps: {
    exclude: ['@xenova/transformers'],
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      ...(isE2E
        ? {
            '@tauri-apps/api/core': path.resolve(
              __dirname,
              './tests/playwright/mocks/tauriCore.ts',
            ),
            '@tauri-apps/api/event': path.resolve(
              __dirname,
              './tests/playwright/mocks/tauriCore.ts',
            ),
            '@tauri-apps/plugin-dialog': path.resolve(
              __dirname,
              './tests/playwright/mocks/tauriCore.ts',
            ),
            '@tauri-apps/plugin-sql': path.resolve(
              __dirname,
              './tests/playwright/mocks/db.ts',
            ),
          }
        : {}),
    },
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
}));
