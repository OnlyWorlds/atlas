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
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
