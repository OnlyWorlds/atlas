import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // The PWA plugin's register module exists only in a build; tests get a
    // stub that records the options Atlas passes (S366 gate A5).
    alias: {
      'virtual:pwa-register': fileURLToPath(new URL('./tests/fixtures/pwa-register-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    // Each file in a fork of its own (Vitest's default since 4, which dropped
    // `singleFork`): no file's window, storage or module state reaches the
    // next. One fork shared by every file without per-file modules reds
    // about 150 tests that expect a fresh module.
    pool: 'forks',
    // 15 s, not vitest's 5: on a shared machine the one fork stalls for
    // seconds at moments the machine chooses (S458: gate A's file 0.9 s in one
    // run and 8.9 s in the next, same order and neighbours, 0.8 s alone), and
    // a 5 s line reddened a different test each night. A real hang is still red.
    testTimeout: 15000,
  },
});
