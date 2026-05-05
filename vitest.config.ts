import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Some node-env tests interop with CJS-from-ESM modules (e.g. jsdom's
    // html-encoding-sniffer). Node 22's experimental flag enables that.
    execArgv: ['--experimental-require-module'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
