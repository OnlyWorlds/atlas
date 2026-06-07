import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Files run in parallel across workers; tests WITHIN a file stay serial
  // (fullyParallel: false). Specs fresh-boot with isolated OPFS/localStorage,
  // so cross-file parallelism is safe. Validated session 236: full suite 2×
  // clean at 4 workers (~52s vs ~108s serial) + the load-sensitive writing
  // specs (split/autolink) stress-passed with --repeat-each=2. If a flake
  // class returns under load, drop back to workers: 1 and re-bisect.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 4,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3045',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3045',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
